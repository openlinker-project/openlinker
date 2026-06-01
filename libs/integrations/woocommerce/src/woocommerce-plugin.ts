/**
 * WooCommerce Plugin Descriptor (#593)
 *
 * Framework-neutral `AdapterPlugin` describing the WooCommerce REST API v3
 * integration. Holds the static manifest, the side-registrations the host
 * wires into its registries at boot (connection tester, config shape
 * validator, credentials shape validator), and the per-connection
 * `createCapabilityAdapter` factory.
 *
 * At scaffold stage (#873), `supportedCapabilities` is empty — connections
 * can be created and tested but no capability adapter is available yet.
 * Capability adapters are added in #874–#879; each issue adds its capability
 * to the manifest and dispatch table without changing this file's signature.
 *
 * WooCommerce needs no plugin-specific NestJS providers (no repository, no
 * token-refresh service), so the host wires it via `createNestAdapterModule`
 * — see `woocommerce-integration.module.ts`.
 *
 * @module libs/integrations/woocommerce/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { WooCommerceConnectionTesterAdapter } from './infrastructure/adapters/woocommerce-connection-tester.adapter';
import { WooCommerceConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/woocommerce-connection-config-shape-validator.adapter';
import { WooCommerceConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/woocommerce-connection-credentials-shape-validator.adapter';

/**
 * Static plugin manifest (#575).
 *
 * Exported as a top-level `const` so host-side tooling (manifest-diff CLIs,
 * capability-matrix dashboards, compatibility checks at boot) can read
 * `adapterKey` / `supportedCapabilities` / `version` without instantiating
 * the plugin. `createWooCommercePlugin().manifest` returns this same
 * reference, so static and runtime views can't drift.
 */
export const woocommerceAdapterManifest: AdapterMetadata = {
  adapterKey: 'woocommerce.restapi.v3',
  platformType: 'woocommerce',
  supportedCapabilities: [], // populated by #874–#879
  displayName: 'WooCommerce REST API v3',
  version: '1.0.0',
  isDefault: true,
};

/** Short brand label for domain-exception prefixes (manifest.displayName is too long). */
const WOOCOMMERCE_BRAND = 'WooCommerce';

export function createWooCommercePlugin(): AdapterPlugin {
  return {
    manifest: woocommerceAdapterManifest,

    register(host: HostServices): void {
      host.connectionTesterRegistry.register(
        woocommerceAdapterManifest.adapterKey,
        new WooCommerceConnectionTesterAdapter(),
      );
      host.connectionConfigShapeValidatorRegistry.register(
        woocommerceAdapterManifest.adapterKey,
        new WooCommerceConnectionConfigShapeValidatorAdapter(WOOCOMMERCE_BRAND),
      );
      host.connectionCredentialsShapeValidatorRegistry.register(
        woocommerceAdapterManifest.adapterKey,
        new WooCommerceConnectionCredentialsShapeValidatorAdapter(WOOCOMMERCE_BRAND),
      );
    },

    createCapabilityAdapter<T>(
      _connection: Connection,
      capability: string,
      _host: HostServices,
    ): Promise<T> {
      // Empty dispatch table — rejects with "WooCommerce adapter does not support
      // capability: X. Supported capabilities: " until #874+ land.
      // dispatchCapability throws synchronously; try/catch converts it to a
      // rejected promise so callers can use await / .catch uniformly.
      try {
        return Promise.resolve(dispatchCapability<T>(capability, {}, WOOCOMMERCE_BRAND));
      } catch (err) {
        return Promise.reject(err as Error);
      }
    },
  };
}
