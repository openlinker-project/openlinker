/**
 * Shipping-stub Integration Module
 *
 * Host wiring for the perf-lab shipping stub plugin (#3043). The plugin has
 * no NestJS providers of its own, so it uses the SDK's
 * `createNestAdapterModule` directly, exactly as
 * `InvoicingStubIntegrationModule` does.
 *
 * Wired into `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`,
 * gated behind `OL_SHIPPING_STUB_ENABLED === 'true'` - see both files for
 * why this must never be unconditional.
 *
 * @module libs/integrations/shipping-stub/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';

import { createShippingStubPlugin } from './shipping-stub-plugin';

export const ShippingStubIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createShippingStubPlugin(),
});
