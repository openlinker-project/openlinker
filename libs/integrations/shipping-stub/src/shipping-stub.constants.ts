/**
 * Shipping-stub Constants
 *
 * Lab-only plugin (#3043) - see the package README for why this exists and
 * what it does and does not measure. Never enabled by default: both host
 * apps register `ShippingStubIntegrationModule` only when
 * `OL_SHIPPING_STUB_ENABLED === 'true'` (`apps/api/src/plugins.ts` /
 * `apps/worker/src/plugins.ts`), mirroring `InvoicingStubIntegrationModule`'s
 * gate.
 *
 * @module libs/integrations/shipping-stub/src
 */
export const SHIPPING_STUB_ADAPTER_KEY = 'shipping-stub.fake.v1';
export const SHIPPING_STUB_PLATFORM_TYPE = 'shipping-stub';
export const SHIPPING_STUB_BRAND = 'Shipping Stub (perf lab, #3043)';
