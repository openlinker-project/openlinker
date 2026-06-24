/**
 * Subiekt Plugin Descriptor (#753)
 *
 * Framework-neutral `AdapterPlugin` for the Subiekt nexo (Sfera bridge)
 * invoicing integration. Holds the static manifest (capability `'Invoicing'`),
 * the side-registrations the host wires at boot (config-shape validator,
 * connection tester, retry classifier), and the per-connection
 * `createCapabilityAdapter` factory.
 *
 * Subiekt needs no plugin-specific NestJS providers, so the host wires it via
 * `createNestAdapterModule` — see `subiekt-integration.module.ts`.
 *
 * DIVERGENCE FROM WooCommerce: `createCapabilityAdapter` MUST NOT reject an
 * empty `credentialsRef` — the bridge token is optional (LAN service). It calls
 * `host.credentialsResolver.get` only when `credentialsRef` is truthy, and wraps
 * its body in try/catch so a `SubiektConfigException` (bad / IMDS `bridgeBaseUrl`)
 * surfaces as a clean `Promise.reject`, never an unhandled throw.
 *
 * @module libs/integrations/subiekt/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { SubiektConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/subiekt-connection-config-shape-validator.adapter';
import { SubiektConnectionTesterAdapter } from './infrastructure/adapters/subiekt-connection-tester.adapter';
import { SubiektRetryClassifierAdapter } from './infrastructure/adapters/subiekt-retry-classifier.adapter';
import { SubiektAdapterFactory } from './application/subiekt-adapter.factory';

/**
 * Static plugin manifest. Exported as a top-level `const` so host tooling can
 * read it without instantiating the plugin; `createSubiektPlugin().manifest`
 * returns this same reference so static and runtime views cannot drift.
 */
export const subiektAdapterManifest: AdapterMetadata = {
  adapterKey: 'subiekt.invoicing.v1',
  platformType: 'subiekt',
  supportedCapabilities: ['Invoicing'],
  displayName: 'Subiekt nexo (Sfera bridge)',
  version: '1.0.0',
  isDefault: true,
};

/** Short brand label for domain-exception / dispatch error prefixes. */
const SUBIEKT_BRAND = 'Subiekt';

export function createSubiektPlugin(): AdapterPlugin {
  return {
    manifest: subiektAdapterManifest,

    register(host: HostServices): void {
      host.connectionConfigShapeValidatorRegistry.register(
        subiektAdapterManifest.adapterKey,
        new SubiektConnectionConfigShapeValidatorAdapter(SUBIEKT_BRAND),
      );
      host.connectionTesterRegistry.register(
        subiektAdapterManifest.adapterKey,
        new SubiektConnectionTesterAdapter(),
      );
      // Retry classifier (fiscal-safety pivot). The runner dispatches classifiers
      // OR-across-all holding the raw error (not an adapterKey), so the key is a
      // bookkeeping label; safe because this classifier only recognises Subiekt's
      // own exceptions. Without it the runner's default is "retryable", which
      // would auto-retry an 'indeterminate' SubiektBridgeTransportError and risk
      // double-issuing a fiscal document — see SubiektBridgeTransportError and
      // SubiektRetryClassifierAdapter docblocks (#752).
      host.retryClassifierRegistry.register(
        subiektAdapterManifest.adapterKey,
        new SubiektRetryClassifierAdapter(),
      );
    },

    // DIVERGENCE FROM WooCommerce: does NOT reject an empty credentialsRef — the
    // bridge token is optional (LAN service). The factory resolves credentials
    // only when credentialsRef is truthy. Wrapped so a SubiektConfigException
    // (bad / IMDS bridgeBaseUrl) surfaces as a clean Promise.reject.
    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      try {
        const logger = new Logger(`Subiekt:${connection.id}`);
        const factory = new SubiektAdapterFactory();
        const adapters = await factory.createAdapters(
          connection,
          host.credentialsResolver,
          logger,
        );
        return dispatchCapability<T>(
          capability,
          {
            Invoicing: () => adapters.invoicing,
          },
          SUBIEKT_BRAND,
        );
      } catch (err) {
        return Promise.reject(err as Error);
      }
    },
  };
}
