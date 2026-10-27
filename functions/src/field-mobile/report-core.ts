import { createRequire } from 'node:module';
// The deployment bundle copies this exact desktop module; no second catalog.
export const reportCore = createRequire(import.meta.url)('../../../desktop-crm/src/work-report-core.js') as {
  itemCatalogFor(kind: string): {key: string; label: string; detail: string; optional?: boolean}[];
  normalizeReport(input: unknown): Record<string, any>;
  validateReport(input: unknown): {ok: boolean; error?: string; report?: Record<string, any>};
  NOTICES: string[];
};
