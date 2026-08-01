import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '@/contracts/manifest.schema.json';
import { PdfServiceError } from '@/lib/pdf/errors';
import type { PageDimension, PageSettings, PdfMetadata, RetentionDays } from '@/lib/pdf/types';

export interface StoredObjectRecord {
  key: string;
  contentType: string;
  bytes: number;
  sha256: string;
}

export interface ReportManifest {
  version: 1;
  reportId: string;
  caller: string;
  filename: string;
  createdAt: string;
  expiresAt: string;
  pdf: StoredObjectRecord;
  html?: StoredObjectRecord;
  submittedHtmlBytes: number;
  submittedHtmlSha256: string;
  renderedHtmlSha256: string;
  page: PageSettings;
  pageCount: number;
  pageDimensions: PageDimension[];
  metadata: PdfMetadata;
  versions: { service: string; node: string; puppeteer: string; chromium: string };
  requestHash: string;
  idempotencyHash?: string;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

export function parseManifest(value: unknown): ReportManifest {
  if (!validate(value)) {
    throw new PdfServiceError('storage_failed', 502, 'A stored report manifest is invalid.');
  }
  return value as unknown as ReportManifest;
}

export function reportLocation(reportId: string): { retentionDays: RetentionDays; uuid: string; prefix: string } | null {
  const match = reportId.match(/^r(1|7|30)_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  if (!match) return null;
  const retentionDays = Number(match[1]) as RetentionDays;
  const uuid = match[2].toLowerCase();
  return { retentionDays, uuid, prefix: `reports/retention-${retentionDays}/${uuid}` };
}
