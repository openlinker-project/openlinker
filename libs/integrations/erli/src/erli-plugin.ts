/**
 * Erli Plugin Descriptor (#980)
 *
 * Framework-neutral `AdapterPlugin` describing the Erli Shop API v1
 * integration. Currently a registration-only skeleton: the manifest is
 * registered in both hosts, but `supportedCapabilities` stays EMPTY until the
 * adapters land. A registered manifest must declare only capabilities its
 * factory can deliver — `IntegrationsService.listCapabilityAdapters` treats
 * any non-`AdapterNotFoundException` factory error as fatal, so a
 * declared-but-unbuilt capability on one active Erli connection would abort
 * capability enumeration for every platform. #993 adds `'OrderSource'` and
 * #984 adds `'OfferManager'` together with the adapters that deliver them
 * (the platform-level capability roadmap lives in the #978 spec and ADR-025).
 * Side-registrations (connection tester, shape validators) arrive with #982.
 *
 * Erli needs no plugin-specific NestJS providers, so the host wires it via
 * `createNestAdapterModule` — see `erli-integration.module.ts`.
 *
 * @module libs/integrations/erli/src
 * @see {@link erliAdapterManifest} for the static manifest (#575 pattern)
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';

/** Human-readable plugin identifier surfaced in dispatch errors (#573). */
const ERLI_BRAND = 'Erli';

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
  // Empty while the skeleton ships no adapters — an empty-capability platform
  // is inert by construction (every IntegrationsService gate filters it out
  // before the factory runs). Each capability is added by the PR that ships
  // its adapter, alongside a dispatch-table entry below: #993 → 'OrderSource',
  // #984 → 'OfferManager' (ingestion before listing, mirroring the Allegro
  // manifest's ordering).
  supportedCapabilities: [],
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
      // Empty dispatch table while no adapters exist — #984 / #993 add their
      // entries (and the matching manifest capability) when they ship. Until
      // then every request gets the SDK's uniform unsupported-capability
      // error; the try/reject wrapper keeps the synchronous throw on the
      // promise channel the `AdapterFactoryPort` shim expects.
      try {
        return Promise.resolve(dispatchCapability<T>(capability, {}, ERLI_BRAND));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}
