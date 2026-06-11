/**
 * Erli Plugin Descriptor (#980)
 *
 * Framework-neutral `AdapterPlugin` describing the Erli Shop API v1
 * integration. Currently a registration-only skeleton: the static manifest
 * declares the capabilities the integration will provide (`OfferManager`,
 * `OrderSource` — see the product spec for #978 and ADR-025), while the
 * per-connection `createCapabilityAdapter` factory rejects with a typed
 * exception until the adapters land (#984 / #993). Side-registrations
 * (connection tester, shape validators) arrive with #982.
 *
 * Erli needs no plugin-specific NestJS providers, so the host wires it via
 * `createNestAdapterModule` — see `erli-integration.module.ts`.
 *
 * @module libs/integrations/erli/src
 * @see {@link erliAdapterManifest} for the static manifest (#575 pattern)
 */
import type { AdapterPlugin, HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ErliCapabilityNotImplementedException } from './domain/exceptions/erli-capability-not-implemented.exception';

/**
 * Static plugin manifest (#575).
 *
 * Exported as a top-level `const` so host-side tooling can read
 * `adapterKey` / `supportedCapabilities` / `version` without instantiating
 * the plugin. `createErliPlugin().manifest` returns this same reference, so
 * static and runtime views can't drift.
 */
export const erliAdapterManifest: AdapterMetadata = {
  adapterKey: 'erli.shopapi.v1',
  platformType: 'erli',
  // Order mirrors the Allegro manifest (the analogous marketplace): ingestion
  // (OrderSource) before listing (OfferManager). Kept consistent so the
  // capability-matrix reads uniformly across marketplace plugins.
  supportedCapabilities: ['OrderSource', 'OfferManager'],
  displayName: 'Erli Shop API v1',
  version: '1.0.0',
  isDefault: true,
};

export function createErliPlugin(): AdapterPlugin {
  return {
    manifest: erliAdapterManifest,

    createCapabilityAdapter<T>(
      _connection: Connection,
      capability: string,
      _host: HostServices,
    ): Promise<T> {
      // Skeleton phase: capabilities are declared on the manifest but unbuilt —
      // #984 (OfferManager) / #993 (OrderSource) replace this with real dispatch.
      // Reject with the typed exception so callers can tell "supported but
      // unbuilt" apart from the SDK's "unsupported capability" error.
      return Promise.reject(new ErliCapabilityNotImplementedException(capability));
    },
  };
}
