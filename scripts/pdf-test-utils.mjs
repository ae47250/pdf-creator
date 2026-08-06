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
    title: document.getTitle() ?? null
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

async function resolveExecutable(name, environmentName) {
  if (process.env[environmentName]) return process.env[environmentName];
  if (process.platform !== 'win32') return name;
  try {
    const { stdout } = await execFileAsync('where.exe', [`${name}.exe`], { encoding: 'utf8', windowsHide: true });
    const executable = stdout.split(/\r?\n/).map((value) => value.trim()).find((value) => value.toLowerCase().endsWith('.exe'));
    if (executable) return executable;
  } catch { /* reported by the eventual executable call */ }
  return name;
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
