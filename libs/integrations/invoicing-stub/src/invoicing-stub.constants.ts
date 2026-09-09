/**
 * Invoicing-stub Constants
 *
 * Lab-only plugin (#3006) - see the package README for why this exists and
 * what it does and does not measure. Never enabled by default: both host
 * apps register `InvoicingStubIntegrationModule` only when
 * `OL_INVOICING_STUB_ENABLED === 'true'` (`apps/api/src/plugins.ts` /
 * `apps/worker/src/plugins.ts`).
 *
 * @module libs/integrations/invoicing-stub/src
 */
export const INVOICING_STUB_ADAPTER_KEY = 'invoicing-stub.fake.v1';
export const INVOICING_STUB_PLATFORM_TYPE = 'invoicing-stub';
export const INVOICING_STUB_BRAND = 'Invoicing Stub (perf lab, #3006)';
