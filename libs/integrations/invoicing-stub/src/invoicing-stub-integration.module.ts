/**
 * Invoicing-stub Integration Module
 *
 * Host wiring for the perf-lab invoicing stub plugin (#3006). The plugin has
 * no NestJS providers of its own, so it uses the SDK's
 * `createNestAdapterModule` directly, exactly as `EparagonyIntegrationModule`
 * / `OmsModule` do.
 *
 * Wired into `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`,
 * gated behind `OL_INVOICING_STUB_ENABLED === 'true'` — see both files for
 * why this must never be unconditional.
 *
 * @module libs/integrations/invoicing-stub/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';

import { createInvoicingStubPlugin } from './invoicing-stub-plugin';

export const InvoicingStubIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createInvoicingStubPlugin(),
});
