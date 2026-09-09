/**
 * Invoicing-stub Integration - Public API
 *
 * Barrel for `@openlinker/integrations-invoicing-stub` (#3006). LAB-ONLY —
 * see the package README and `apps/{api,worker}/src/plugins.ts`'s
 * `OL_INVOICING_STUB_ENABLED` gate. Nothing this package issues is a real
 * fiscal document.
 *
 * @module libs/integrations/invoicing-stub/src
 */
export { createInvoicingStubPlugin, invoicingStubAdapterManifest } from './invoicing-stub-plugin';
export { InvoicingStubIntegrationModule } from './invoicing-stub-integration.module';

export {
  INVOICING_STUB_ADAPTER_KEY,
  INVOICING_STUB_BRAND,
  INVOICING_STUB_PLATFORM_TYPE,
} from './invoicing-stub.constants';

export {
  InvoicingStubConfigException,
  InvoicingStubInvoicingAdapter,
} from './infrastructure/adapters/invoicing-stub-invoicing.adapter';
