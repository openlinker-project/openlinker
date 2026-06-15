/**
 * DPD Polska Plugin Descriptor (#593)
 *
 * Framework-neutral `AdapterPlugin` for the DPD Polska DPDServices REST
 * integration. Holds the static manifest, the config-shape validator
 * side-registration, and the per-connection `createCapabilityAdapter` factory
 * (which resolves credentials + builds the shipping adapter, then dispatches by
 * capability name).
 *
 * DPD needs no plugin-specific NestJS providers (no repository, no token
 * refresh), so the host wires it via `createNestAdapterModule` — see
 * `dpd-integration.module.ts`.
 *
 * @module libs/integrations/dpd-polska/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { createDpdShippingAdapter } from './application/dpd-adapter.factory';
import { DpdConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/dpd-connection-config-shape-validator.adapter';
import { buildDpdSchedulerTasks } from './infrastructure/scheduler/dpd-scheduler-tasks';

/**
 * Static plugin manifest (#575). Exported as a top-level `const` so host-side
 * tooling can read `adapterKey` / `supportedCapabilities` / `version` without
 * instantiating the plugin. `createDpdPlugin().manifest` returns the same
 * reference, so static and runtime views can't drift.
 */
export const dpdAdapterManifest: AdapterMetadata = {
  adapterKey: 'dpd.polska.rest.v1',
  platformType: 'dpd',
  supportedCapabilities: ['ShippingProviderManager'],
  displayName: 'DPD Polska REST v1',
  version: '1.0.0',
  isDefault: true,
};

/** Short brand label for the config-validator's error prefix. */
const DPD_BRAND = 'DPD Polska';

export function createDpdPlugin(): AdapterPlugin {
  return {
    manifest: dpdAdapterManifest,

    register(host: HostServices): void {
      host.connectionConfigShapeValidatorRegistry.register(
        dpdAdapterManifest.adapterKey,
        new DpdConnectionConfigShapeValidatorAdapter(DPD_BRAND),
      );
      // No credentials-shape validator: the `{ login, password }` shape is
      // enforced at adapter construction time by the factory.

      // Shipment-status poll (#965, ADR-022) — the only DPD tracking path
      // (no DPD webhook). Env-gated; takes effect worker-side via the scheduler.
      for (const task of buildDpdSchedulerTasks()) {
        host.schedulerTaskRegistry.register(task);
      }
    },

    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const adapter = await createDpdShippingAdapter(connection, host.credentialsResolver);
      return dispatchCapability<T>(capability, { ShippingProviderManager: () => adapter }, DPD_BRAND);
    },
  };
}
