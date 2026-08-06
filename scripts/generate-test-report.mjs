import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(process.cwd(), 'test-artifacts', 'pdf-regression');
const summaries = await findSummaries(root);
const records = [];
for (const path of summaries) {
  try {
    records.push({ path, modified: (await stat(path)).mtimeMs, value: JSON.parse(await readFile(path, 'utf8')) });
  } catch { /* ignore incomplete artifacts */ }
}

const latestLocal = records.filter((record) => record.value.kind === 'local-visual-regression').sort(byNewest)[0];
const latestLive = records.filter((record) => record.value.kind === 'controlled-live-reliability').sort(byNewest)[0];
const lines = [
  '# Generated PDF Service Test Summary',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  'This is a reproducible artifact summary. The reviewed production decision remains in `docs/testing/pdf-service-test-report.md`.',
  '',
  '## Latest local visual run',
  '',
  ...(latestLocal ? localLines(latestLocal.value) : ['No local visual summary was found.']),
  '',
  '## Latest controlled live run',
  '',
  ...(latestLive ? liveLines(latestLive.value) : ['No controlled live summary was found.']),
  ''
];

await mkdir(root, { recursive: true });
const output = join(root, 'generated-test-summary.md');
await writeFile(output, lines.join('\n'), 'utf8');
console.log(output);

function localLines(summary) {
  return [
    '| Fixture | Status | Bytes | Pages | Text | Rendered PNG pages |',
    '|---|---:|---:|---:|---:|---:|',
    ...summary.results.map((result) => `| ${result.id} | ${result.status} | ${result.bytes} | ${result.pageCount} | ${result.textValid ? 'pass' : 'fail'} | ${result.renderedPageCount} |`)
  ];
}

function liveLines(summary) {
  const rows = summary.stages?.map((stage) => {
    const durations = stage.results.map((result) => result.durationMs).sort((left, right) => left - right);
    return `| ${stage.concurrency} | ${stage.requestCount} | ${formatRate(stage.successRate)} | ${median(durations)} | ${stage.p95Ms} | ${stage.maxMs} | ${formatRate(stage.httpErrorRate)} | ${formatRate(stage.corruptionRate)} | ${stage.contamination ? 'yes' : 'no'} |`;
  }) ?? [];
  return [
    `Stopped early: ${summary.stoppedEarly ? 'yes' : 'no'}. Reason: ${summary.stopReason ?? 'none'}.`,
    '',
    '| Concurrency | Requests | Success | Median ms | P95 ms | Max ms | HTTP errors | Corruption | Contamination |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows
  ];
}

async function findSummaries(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? findSummaries(join(directory, entry.name)) : Promise.resolve(entry.name === 'summary.json' ? [join(directory, entry.name)] : [])));
    return nested.flat();
  } catch { return []; }
}

function byNewest(left, right) { return right.modified - left.modified; }
function formatRate(value) { return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'n/a'; }
function median(values) {
  if (!values.length) return 'n/a';
  const midpoint = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? Math.round((values[midpoint - 1] + values[midpoint]) / 2) : values[midpoint];
}
