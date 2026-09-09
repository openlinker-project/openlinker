/**
 * Shipping-stub Integration - Public API
 *
 * Barrel for `@openlinker/integrations-shipping-stub` (#3043). LAB-ONLY - see
 * the package README and `apps/{api,worker}/src/plugins.ts`'s
 * `OL_SHIPPING_STUB_ENABLED` gate. No label this package "buys" is a real
 * carrier waybill.
 *
 * @module libs/integrations/shipping-stub/src
 */
export { createShippingStubPlugin, shippingStubAdapterManifest } from './shipping-stub-plugin';
export { ShippingStubIntegrationModule } from './shipping-stub-integration.module';

export {
  SHIPPING_STUB_ADAPTER_KEY,
  SHIPPING_STUB_BRAND,
  SHIPPING_STUB_PLATFORM_TYPE,
} from './shipping-stub.constants';

export {
  ShippingStubConfigException,
  ShippingStubShippingAdapter,
} from './infrastructure/adapters/shipping-stub-shipping.adapter';
