import { PdfServiceError } from '@/lib/pdf/errors';

const CALLER_STORAGE_PREFIXES: Readonly<Record<string, string>> = {
  econplanner: 'EconPlanner',
  pathfinder: 'PathFinder',
  jobsearch: 'JobSearch',
  treeservice: 'TreeService',
  test: 'Test'
};

export function callerStoragePrefix(callerId: string): string {
  const prefix = CALLER_STORAGE_PREFIXES[callerId];
  if (!prefix) {
    throw new PdfServiceError('service_unavailable', 503, 'The caller storage configuration is unavailable.');
  }
  return prefix;
}
