/**
 * Shipping-stub Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the perf-lab shipping stub (#3043).
 * Capability: `'ShippingProviderManager'`. `requiresCredentials: false`
 * (ADR-055's credential-less connection pattern, the same one
 * `@openlinker/oms` and `@openlinker/integrations-invoicing-stub` use): this
 * adapter authenticates nothing - it talks to a stub process on the lab's
 * own docker network - so there is no secret to store and no
 * credential-shape validator to register.
 *
 * `register(host)` is deliberately absent (the invoicing-stub/OMS-plugin
 * shape): no connection tester, no scheduler task, no webhook translator, no
 * config/credentials shape validator. `config.apiBaseUrl` is validated
 * defensively inside `createCapabilityAdapter` instead, thrown as
 * `ShippingStubConfigException` when absent.
 *
 * @module libs/integrations/shipping-stub/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';

import {
  SHIPPING_STUB_ADAPTER_KEY,
  SHIPPING_STUB_BRAND,
  SHIPPING_STUB_PLATFORM_TYPE,
} from './shipping-stub.constants';
import {
  ShippingStubConfigException,
  ShippingStubShippingAdapter,
} from './infrastructure/adapters/shipping-stub-shipping.adapter';

/**
 * Static plugin manifest (#575). `createShippingStubPlugin().manifest`
 * returns this same reference, so the static and runtime views cannot drift.
 */
export const shippingStubAdapterManifest: AdapterMetadata = {
  adapterKey: SHIPPING_STUB_ADAPTER_KEY,
  platformType: SHIPPING_STUB_PLATFORM_TYPE,
  supportedCapabilities: ['ShippingProviderManager'],
  displayName: SHIPPING_STUB_BRAND,
  version: '0.1.0',
  isDefault: true,
  requiresCredentials: false,
};

interface ShippingStubConnectionConfig {
  apiBaseUrl?: unknown;
}

export function createShippingStubPlugin(): AdapterPlugin {
  return {
    manifest: shippingStubAdapterManifest,

    // eslint-disable-next-line @typescript-eslint/require-await -- AdapterPlugin.createCapabilityAdapter returns a Promise by contract; this factory is synchronous
    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const config = (connection.config ?? {}) as ShippingStubConnectionConfig;
      const apiBaseUrl = typeof config.apiBaseUrl === 'string' ? config.apiBaseUrl.trim() : '';
      if (!apiBaseUrl) {
        throw new ShippingStubConfigException(
          `shipping-stub connection ${connection.id} has no config.apiBaseUrl - point it at the ` +
            `perf-lab stub, e.g. http://shipping-stub:19086`,
        );
      }

      const logger = host.logger(`ShippingStub:${connection.id}`);
      const adapter = new ShippingStubShippingAdapter(
        connection.id,
        apiBaseUrl,
        host.http.forConnection(connection),
        logger,
      );
      return dispatchCapability<T>(
        capability,
        { ShippingProviderManager: () => adapter },
        SHIPPING_STUB_BRAND,
      );
    },
  };
}
