/**
 * InPost Plugin Descriptor (#593)
 *
 * Framework-neutral `AdapterPlugin` for the InPost ShipX v1 integration. Holds
 * the static manifest, the config-shape validator side-registration, and the
 * per-connection `createCapabilityAdapter` factory (which resolves credentials
 * + builds the shipping adapter, then dispatches by capability name).
 *
 * InPost needs no plugin-specific NestJS providers (no repository, no
 * token-refresh service), so the host wires it via `createNestAdapterModule`
 * — see `inpost-integration.module.ts`.
 *
 * @module libs/integrations/inpost/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { createInpostShippingAdapter } from './application/inpost-adapter.factory';
import { InpostConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/inpost-connection-config-shape-validator.adapter';

/**
 * Static plugin manifest (#575). Exported as a top-level `const` so host-side
 * tooling can read `adapterKey` / `supportedCapabilities` / `version` without
 * instantiating the plugin. `createInpostPlugin().manifest` returns the same
 * reference, so static and runtime views can't drift.
 */
export const inpostAdapterManifest: AdapterMetadata = {
  adapterKey: 'inpost.shipx.v1',
  platformType: 'inpost',
  supportedCapabilities: ['ShippingProviderManager'],
  displayName: 'InPost ShipX v1',
  version: '1.0.0',
  isDefault: true,
};

/** Short brand label for domain-exception prefixes (manifest.displayName is too long). */
const INPOST_BRAND = 'InPost';

export function createInpostPlugin(): AdapterPlugin {
  return {
    manifest: inpostAdapterManifest,

    register(host: HostServices): void {
      host.connectionConfigShapeValidatorRegistry.register(
        inpostAdapterManifest.adapterKey,
        new InpostConnectionConfigShapeValidatorAdapter(INPOST_BRAND),
      );
      // No credentials-shape validator: the `{ apiToken }` shape is enforced
      // at adapter construction time by the factory (deeper than this boundary).
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const adapter = await createInpostShippingAdapter(connection, host.credentialsResolver);
      return dispatchCapability<T>(
        capability,
        { ShippingProviderManager: () => adapter },
        INPOST_BRAND,
      );
    },
  };
}
