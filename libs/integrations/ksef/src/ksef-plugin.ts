/**
 * KSeF Plugin Descriptor (#1144 / C2)
 *
 * Framework-neutral `AdapterPlugin` describing the KSeF Public API v2 invoicing
 * integration. `supportedCapabilities` lists `Invoicing` in lockstep with the
 * adapter the factory constructs — a registered manifest must declare only
 * capabilities its factory can build.
 *
 * Side-registrations land in `register(host)` (`createNestAdapterModule`
 * invokes it): the connection config + credentials shape validators (C2). These
 * reject malformed payloads before a connection is persisted, so C3+ never sees
 * a connection with an invalid environment or an unresolvable credential.
 *
 * KSeF needs no plugin-specific NestJS providers in C2, so the host wires it via
 * `createNestAdapterModule` — see `ksef-integration.module.ts`. If a later phase
 * needs plugin-scoped providers (cert store, scheduler), the validator
 * registration is unchanged: the descriptor still calls the same registry
 * methods from `register(host)`.
 *
 * @module libs/integrations/ksef/src
 * @see {@link ksefAdapterManifest} for the static manifest (#575 pattern)
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { KsefAdapterFactory } from './application/factories/ksef-adapter.factory';
import { KSEF_ADAPTER_KEY, KSEF_BRAND } from './ksef.constants';
import { KsefConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/ksef-connection-config-shape-validator.adapter';
import { KsefConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/ksef-connection-credentials-shape-validator.adapter';

/**
 * Static plugin manifest (#575).
 *
 * Exported as a top-level `const` so host-side tooling can read
 * `adapterKey` / `supportedCapabilities` / `version` without instantiating the
 * plugin. `createKsefPlugin().manifest` returns this same reference, so static
 * and runtime views can't drift.
 */
export const ksefAdapterManifest: AdapterMetadata = {
  adapterKey: KSEF_ADAPTER_KEY,
  platformType: 'ksef',
  supportedCapabilities: ['Invoicing'],
  displayName: 'KSeF Public API v2',
  version: '1.0.0',
  // isDefault marks the canonical adapter for the ksef.publicapi.v2 API version.
  // Future major API versions (v3+) ship as separate plugins with their own
  // adapterKey and isDefault flag.
  isDefault: true,
};

export function createKsefPlugin(): AdapterPlugin {
  return {
    manifest: ksefAdapterManifest,

    register(host: HostServices): void {
      host.connectionConfigShapeValidatorRegistry.register(
        KSEF_ADAPTER_KEY,
        new KsefConnectionConfigShapeValidatorAdapter(KSEF_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        KSEF_ADAPTER_KEY,
        new KsefConnectionCredentialsShapeValidatorAdapter(KSEF_BRAND),
      );
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const factory = new KsefAdapterFactory(host.cache);
      const adapters = await factory.createAdapters(
        connection,
        host.identifierMapping,
        host.credentialsResolver,
      );
      return dispatchCapability<T>(
        capability,
        {
          Invoicing: () => adapters.invoicing,
        },
        KSEF_BRAND,
      );
    },
  };
}
