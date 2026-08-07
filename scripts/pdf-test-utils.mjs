import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);

export async function validatePdfBuffer(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('The response does not have a valid PDF signature.');
  }
  const document = await PDFDocument.load(buffer, { updateMetadata: false });
  const pages = document.getPages();
  if (pages.length < 1) throw new Error('The PDF contains no pages.');
  return {
    bytes: buffer.length,
    pageCount: pages.length,
    pageDimensions: pages.map((page) => {
      const { width, height } = page.getSize();
      return { widthPoints: round(width), heightPoints: round(height) };
    }),
    sha256: createHash('sha256').update(buffer).digest('hex'),
    title: document.getTitle() ?? null,
    author: metadataValue(() => document.getAuthor()),
    subject: metadataValue(() => document.getSubject()),
    keywords: metadataValue(() => document.getKeywords()),
    creator: metadataValue(() => document.getCreator()),
    producer: metadataValue(() => document.getProducer()),
    creationDateIso: metadataValue(() => document.getCreationDate(), dateToIso),
    modificationDateIso: metadataValue(() => document.getModificationDate(), dateToIso)
  };
}

export async function extractTextFromBytes(bytes) {
  const directory = await mkdtemp(join(tmpdir(), 'pdf-creator-text-'));
  const pdfPath = join(directory, 'document.pdf');
  try {
    await writeFile(pdfPath, bytes);
    return await extractPdfText(pdfPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function extractPdfText(pdfPath) {
  const executable = await resolveExecutable('pdftotext', 'PDFTOTEXT_PATH');
  const { stdout } = await execFileAsync(executable, [pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 20_000_000,
    windowsHide: true
  });
  return stdout.replace(/\r\n/g, '\n');
}

export async function extractPdfTextByPage(pdfPath, pageCount) {
  const count = pageCount ?? (await inspectPdfWithPoppler(pdfPath)).pageCount;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('pageCount must be a positive integer.');
  }

  const executable = await resolveExecutable('pdftotext', 'PDFTOTEXT_PATH');
  const pages = [];
  for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
    const { stdout } = await execFileAsync(
      executable,
      ['-f', String(pageNumber), '-l', String(pageNumber), pdfPath, '-'],
      { encoding: 'utf8', maxBuffer: 20_000_000, windowsHide: true }
    );
    pages.push({
      pageNumber,
      text: stdout.replace(/\r\n/g, '\n').replace(/\f+$/, '')
    });
  }
  return pages;
}

export async function inspectPdfWithPoppler(pdfPath) {
  const executable = await resolveExecutable('pdfinfo', 'PDFINFO_PATH');
  const base = await runPdfInfo(executable, ['-box', pdfPath]);
  const baseFields = parsePdfInfoFields(base);
  const pageCount = parseInteger(baseFields.Pages);
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error('pdfinfo did not report a positive page count.');
  }

  const detailed = await runPdfInfo(executable, [
    '-box',
    '-f',
    '1',
    '-l',
    String(pageCount),
    pdfPath
  ]);
  const pages = parsePdfInfoPages(detailed, pageCount);

  return {
    executable,
    pageCount,
    pageDimensions: pages.map(({ widthPoints, heightPoints }) => ({
      widthPoints,
      heightPoints
    })),
    pages,
    encrypted: parseYesNo(baseFields.Encrypted),
    tagged: parseYesNo(baseFields.Tagged),
    optimized: parseYesNo(baseFields.Optimized),
    javascript: parseYesNo(baseFields.JavaScript),
    suspects: parseYesNo(baseFields.Suspects),
    form: baseFields.Form ?? null,
    pdfVersion: baseFields['PDF version'] ?? null,
    fileSizeBytes: parseFileSize(baseFields['File size']),
    fields: baseFields,
    raw: detailed
  };
}

export async function renderPdfPages(pdfPath, outputPrefix) {
  const executable = await resolveExecutable('pdftoppm', 'PDFTOPPM_PATH');
  await execFileAsync(executable, ['-png', '-r', '120', pdfPath, outputPrefix], {
    maxBuffer: 20_000_000,
    windowsHide: true
  });
  const directory = join(outputPrefix, '..');
  const prefix = outputPrefix.slice(Math.max(outputPrefix.lastIndexOf('/'), outputPrefix.lastIndexOf('\\')) + 1);
  return (await readdir(directory))
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.png'))
    .sort()
    .map((name) => join(directory, name));
}

export function latencySummary(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return {
    medianMs: median(ordered),
    p95Ms: percentile(ordered, 95),
    p99Ms: percentile(ordered, 99),
    maxMs: ordered.length ? ordered.at(-1) : null
  };
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function runTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function busyRetryDelayMs(retryNumber, randomValue = Math.random()) {
  if (!Number.isInteger(retryNumber) || retryNumber < 1) throw new Error('invalid-retry-number');
  if (typeof randomValue !== 'number' || randomValue < 0 || randomValue > 1) throw new Error('invalid-random-value');
  const jitterCeilingMs = Math.min(4_000, (2 ** (retryNumber - 1)) * 1_000);
  return Math.max(1_000, Math.floor(randomValue * jitterCeilingMs));
}

export function canStartAdmissionRetry(nowMs, delayMs, deadlineMs) {
  return nowMs < deadlineMs && nowMs + delayMs < deadlineMs;
}

export async function resolveExecutable(name, environmentName) {
  if (environmentName && process.env[environmentName]) return process.env[environmentName];
  if (process.platform !== 'win32') return name;
  try {
    const { stdout } = await execFileAsync('where.exe', [`${name}.exe`], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true
    });
    const executable = stdout.split(/\r?\n/).map((value) => value.trim()).find((value) => value.toLowerCase().endsWith('.exe'));
    if (executable) return executable;
  } catch { /* reported by the eventual executable call */ }
  return name;
}

export async function probeExecutable(name, options = {}) {
  const {
    environmentName,
    versionArgs = ['-v']
  } = options;
  if (
    !Array.isArray(versionArgs)
    || versionArgs.length !== 1
    || !['-v', '--version', '-version'].includes(versionArgs[0])
  ) {
    throw new Error('versionArgs must contain one read-only version flag.');
  }

  const executable = await resolveExecutable(name, environmentName);
  try {
    const { stdout, stderr } = await execFileAsync(executable, versionArgs, {
      encoding: 'utf8',
      maxBuffer: 1_000_000,
      timeout: 5_000,
      windowsHide: true
    });
    return {
      name,
      available: true,
      executable,
      version: versionOutput(stdout, stderr),
      probeSucceeded: true,
      errorCode: null
    };
  } catch (error) {
    const version = versionOutput(error?.stdout, error?.stderr);
    const unavailable = error?.code === 'ENOENT' || error?.code === 'EACCES';
    return {
      name,
      available: !unavailable,
      executable,
      version,
      probeSucceeded: false,
      errorCode: typeof error?.code === 'string' ? error.code : null
    };
  }
}

async function runPdfInfo(executable, args) {
  const { stdout } = await execFileAsync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 20_000_000,
    windowsHide: true
  });
  return stdout.replace(/\r\n/g, '\n');
}

function parsePdfInfoFields(output) {
  const fields = {};
  for (const line of output.split('\n')) {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match || /^Page(?:\s+\d+)?\s/.test(match[1])) continue;
    fields[match[1].trim()] = match[2].trim();
  }
  return fields;
}

function parsePdfInfoPages(output, pageCount) {
  const pages = Array.from({ length: pageCount }, (_, index) => ({
    pageNumber: index + 1,
    widthPoints: null,
    heightPoints: null,
    rotationDegrees: null,
    mediaBox: null,
    cropBox: null,
    bleedBox: null,
    trimBox: null,
    artBox: null
  }));

  for (const line of output.split('\n')) {
    const size = /^Page\s+(\d+)\s+size:\s*([-+\d.]+)\s+x\s+([-+\d.]+)\s+pts\b/i.exec(line);
    if (size) {
      const page = pages[Number(size[1]) - 1];
      if (page) {
        page.widthPoints = round(Number(size[2]));
        page.heightPoints = round(Number(size[3]));
      }
      continue;
    }

    const rotation = /^Page\s+(\d+)\s+rot:\s*(-?\d+)\b/i.exec(line);
    if (rotation) {
      const page = pages[Number(rotation[1]) - 1];
      if (page) page.rotationDegrees = Number(rotation[2]);
      continue;
    }

    const box = /^Page\s+(\d+)\s+(MediaBox|CropBox|BleedBox|TrimBox|ArtBox):\s*(.*)$/i.exec(line);
    if (box) {
      const page = pages[Number(box[1]) - 1];
      if (page) page[`${box[2][0].toLowerCase()}${box[2].slice(1)}`] = parseBox(box[3]);
    }
  }
  return pages;
}

function parseBox(value) {
  const numbers = value.trim().split(/\s+/).map(Number);
  return numbers.length === 4 && numbers.every(Number.isFinite) ? numbers.map(round) : null;
}

function parseInteger(value) {
  if (!/^\d+$/.test(value ?? '')) return null;
  return Number(value);
}

function parseFileSize(value) {
  const match = /^(\d+)\s+bytes\b/i.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

function parseYesNo(value) {
  if (/^yes$/i.test(value ?? '')) return true;
  if (/^no$/i.test(value ?? '')) return false;
  return null;
}

function dateToIso(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function metadataValue(reader, transform = (value) => value) {
  try {
    const value = reader();
    return value === undefined || value === null ? null : transform(value);
  } catch {
    return null;
  }
}

function versionOutput(stdout, stderr) {
  const value = `${stdout ?? ''}\n${stderr ?? ''}`.trim().replace(/\r\n/g, '\n');
  return value ? value.slice(0, 2_000) : null;
}

function percentile(ordered, target) {
  if (!ordered.length) return null;
  const index = Math.max(0, Math.ceil((target / 100) * ordered.length) - 1);
  return ordered[index];
}

function median(ordered) {
  if (!ordered.length) return null;
  const midpoint = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? Math.round((ordered[midpoint - 1] + ordered[midpoint]) / 2)
    : ordered[midpoint];
}

function round(value) {
  return Math.round(value * 100) / 100;
}
