export interface AuditRate {
  numerator: number;
  denominator: number;
  value: number | null;
  percentage: number | null;
}

export interface AuditFinding {
  code: string;
  severity: string;
  cause: string;
  message: string;
  affectsCorrectness: boolean;
}

export interface AuditExecutionPlan {
  executionId: string;
  ordinal: number;
  profileName: string;
  lane: 'local' | 'preview';
  caseId: string;
  canonicalFixtureId: string;
  sourceCaseId: string;
  category: string;
  expectedClass: string;
  profileRepetition: number;
  scenarioIndex: number | null;
  scenarioType: string | null;
}

export interface AuditExecutionResult extends AuditExecutionPlan {
  attempted: boolean;
  executed: boolean;
  requestAttempts: number;
  status: number | null;
  responseContentType: string | null;
  durationMs: number | null;
  pdfProduced: boolean;
  structurallyValid: boolean;
  correctlyRendered: boolean;
  incorrectlyRendered: boolean;
  failedPdfGeneration: boolean;
  intentionalRejection: boolean;
  unsupported: boolean;
  unavailable: boolean;
  expectationsMet: boolean;
  findings: AuditFinding[];
  evidence: Record<string, unknown>;
}

export interface AuditCategoryMetrics {
  fixtureCategory: string;
  uniqueFixturesAttempted: number;
  uniqueFixturesExecuted: number;
  uniqueFixturesNotExecuted: number;
  uniqueFixturesMeetingAllRequiredExpectations: number;
  uniqueFixturesFailingOneOrMoreRequiredExpectations: number;
  pdfsProduced: number;
  structurallyValidPdfs: number;
  correctlyRenderedPdfs: number;
  incorrectlyRenderedPdfs: number;
  failedPdfGenerations: number;
  unsupportedFixtures: number;
  intentionallyRejectedFixtures: number;
  environmentalLimitationFixtures: number;
  auditToolLimitationFixtures: number;
  unavailableFixtures: number;
  productionRate: AuditRate;
  structuralValidityRate: AuditRate;
  correctRenderingRate: AuditRate;
  findingsBySeverity: Record<string, number>;
  findingsByCause: Record<string, number>;
  mainReasons: string[];
  uniqueAffectedFixtures: number;
  affectedFixtures: Array<{
    fixtureId: string;
    resultLabels: string[];
    reasons: string[];
  }>;
}

export interface AuditMetrics {
  uniqueFixtureResults: number;
  totalExecutions: number;
  totalRequestAttempts: number;
  overall: AuditCategoryMetrics;
  categories: Record<string, AuditCategoryMetrics>;
  supportedBasic: AuditCategoryMetrics;
  qualityScore: AuditRate & { label: string };
  capabilityCoverage: AuditRate & {
    label: string;
    testedCapabilityIds: string[];
    untestedCapabilityIds: string[];
  };
  evidenceCoverage: AuditRate & {
    label: string;
    coreRequired?: AuditRate;
    optionalToolEvidence?: AuditRate;
    collectedUnits: string[];
    unavailableUnits: string[];
    optionalEvidence: Array<{
      id: string;
      collected: boolean;
      reason: string;
    }>;
  };
}

export interface AuditManifest {
  schemaVersion: number;
  fixtureVersion: string;
  title: string;
  profiles: Record<string, {
    lane: 'local' | 'preview';
    maximumConcurrency: number;
    maximumGetRequests: number;
    maximumPostRequests: number;
    startSpacingMs?: number;
    groups: Array<{ caseIds: string[]; repetitions: number }>;
  }>;
  cases: Array<Record<string, unknown> & {
    id: string;
    category: string;
    expectedClass: string;
    capabilityIds?: string[];
  }>;
}

export interface AuditTransportResponse {
  status: number;
  headers?: Headers | Record<string, string>;
  body: Uint8Array | Buffer;
  durationMs?: number;
  requestAttempts?: number;
}

export interface AuditResult {
  schemaVersion: 1;
  kind: 'pdf-quality-audit';
  runId: string;
  profileName: string;
  lane: 'local' | 'preview';
  completionStatus: string;
  releaseAssessment: 'not-performed';
  requestCounts: { get: number; post: number; total: number };
  executions: AuditExecutionResult[];
  metrics: AuditMetrics;
  [key: string]: unknown;
}

export function loadAuditManifest(options?: {
  rootDir?: string;
  manifestPath?: string;
  schemaPath?: string;
}): Promise<{
  manifest: AuditManifest;
  schema: Record<string, unknown>;
  manifestPath: string;
  schemaPath: string;
  manifestSha256: string;
  schemaSha256: string;
  sourceFiles: Array<{ path: string; sha256: string; bytes: number }>;
}>;

export function buildExecutionPlan(manifest: AuditManifest, profileName: string): AuditExecutionPlan[];

export function executeAuditPlan(options: {
  manifest: AuditManifest;
  profileName: string;
  transport: (input: {
    execution: AuditExecutionPlan;
    payload: Record<string, unknown>;
  }) => Promise<AuditTransportResponse>;
  rootDir?: string;
  artifactDir?: string;
  preflight?: unknown;
  runId?: string;
  startedAt?: string;
}): Promise<AuditResult>;

export function aggregateMetrics(
  executions: Array<Partial<AuditExecutionResult> & {
    executionId: string;
    caseId: string;
    canonicalFixtureId: string;
    category: string;
    expectedClass: string;
  }>,
  manifest: AuditManifest
): AuditMetrics;

export function formatRate(numerator: number, denominator: number): AuditRate;
export function classifyOperationalStop(reason: string): boolean;
export function sanitizeForEvidence<T>(value: T): unknown;
export function validateAuditResult(
  result: unknown,
  schema?: Record<string, unknown>
): { valid: boolean; errors: string[] };
export function collectToolPreflight(options?: { rootDir?: string }): Promise<Record<string, unknown>>;
export function createHttpTransport(options: {
  baseUrl: string;
  expectedHostSha256: string;
  bearerKey: string;
  bypassSecret?: string;
  timeoutMs?: number;
  maximumInputBytes?: number;
  maximumPdfBytes?: number;
  maximumJsonBytes?: number;
}): (
  input: { execution: AuditExecutionPlan; payload: Record<string, unknown> }
) => Promise<AuditTransportResponse>;
export function generateMarkdownReport(result: AuditResult): string;
export function writeMarkdownReport(reportPath: string, result: AuditResult): Promise<void>;
export function validatePreviewOrigin(value: string, expectedHostSha256: string): string;
