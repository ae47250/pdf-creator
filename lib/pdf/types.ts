export type PageFormat = 'Letter' | 'A4' | 'Legal';
export type PageOrientation = 'portrait' | 'landscape';
export type RetentionDays = 1 | 7 | 30;

export interface PageSettings {
  format: PageFormat;
  orientation: PageOrientation;
  marginsInches: { top: number; right: number; bottom: number; left: number };
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
}

export interface PdfCreationRequest {
  html: string;
  filename: string;
  storeResult: boolean;
  storeHtml: boolean;
  page: PageSettings;
  expectedPageCount?: number;
  metadata?: PdfMetadata;
  retentionDays?: RetentionDays;
  idempotencyKey?: string;
  correlationId?: string;
}

export interface Caller {
  id: string;
  mayStore: boolean;
  maxRetentionDays: RetentionDays;
  rateLimitPerMinute: number;
}

export interface PageDimension {
  widthPoints: number;
  heightPoints: number;
}

export interface RenderResult {
  pdf: Uint8Array;
  renderedHtml: string;
  pageCount: number;
  pageDimensions: PageDimension[];
  sha256: string;
  markerCount: number;
}
