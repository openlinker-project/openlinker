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
import { SubiektAuthFailureClassifierAdapter } from './infrastructure/adapters/subiekt-auth-failure-classifier.adapter';
import { SubiektAdapterFactory } from './application/subiekt-adapter.factory';
import { buildSubiektSchedulerTasks } from './infrastructure/scheduler/subiekt-scheduler-tasks';

/**
 * Static plugin manifest. Exported as a top-level `const` so host tooling can
 * read it without instantiating the plugin; `createSubiektPlugin().manifest`
 * returns this same reference so static and runtime views cannot drift.
 */
export const subiektAdapterManifest: AdapterMetadata = {
  adapterKey: 'subiekt.invoicing.v1',
  platformType: 'subiekt',
  // Fiscalization is listed unconditionally, matching the OFFER/OFFER-nothing
  // convention every other capability list here follows — it degrades to
  // "not supported" per-connection (dispatchCapability) when the connection
  // config carries no drukarkaFiskalnaId, rather than the manifest itself
  // being connection-aware, which it cannot be.
  supportedCapabilities: [
    'Invoicing',
    'ProductMaster',
    'InventoryMaster',
    'OrderSource',
    'OrderProcessorManager',
    'Fiscalization',
  ],
  // Driving Subiekt GT (InsERT GT product line) via the classic COM "Sfera GT"
  // automation surface (ProgID InsERT.GT) — NOT Subiekt nexo, which is a
  // different InsERT product with its own, unrelated .NET Sfera API
  // (InsERT.Moria.Sfera). Corrected from an earlier, factually wrong label —
  // the installed product was confirmed live this session (InsERT GT 1.89 SP1).
  displayName: 'Subiekt GT (Sfera bridge)',
  version: '1.0.0',
  isDefault: true,
  // #1810 §1 — the Sfera bridge runs on the operator's own machine (not a
  // borrowed number — Subiekt genuinely fits the merchant-hosted rationale,
  // unlike a carrier/marketplace platform). Both call sites already pass this
  // to `host.http.forConnection` (see `createCapabilityAdapter` below and
  // `SubiektConnectionTesterAdapter`, injected via constructor — never via an
  // import of this module, which would cycle back into it).
  //
  // maxConcurrent: 1 (#3367 audit finding, corrected from 4). Sfera GT drives
  // every write through ONE dedicated STA COM worker thread with a single
  // internal job queue (`Sfera.cs` — confirmed by reading the bridge source,
  // not inferred) — the bridge itself never processes more than one request
  // at a time regardless of how many OL sends concurrently. Its per-call
  // server-side timeouts (60-120s for writes) already exceed every OL client
  // timeout (15-30s), and that server-side wait is NOT tied to the HTTP
  // request's cancellation — a queued call that OL gives up on keeps running
  // and commits later. Allowing >1 concurrent request just makes it more
  // likely that a slow call (a NIP-whitelist lookup, a cold COM re-attach)
  // pushes its queue-mates past their own short timeout before even being
  // dequeued — a client-side "unreachable" that is really "still queued,"
  // indistinguishable from a genuine outage and, on the order-create path,
  // risking exactly the duplicate-ZK/duplicate-kontrahent failure mode #3369
  // fixes. At maxConcurrent=1, a slow call still delays its neighbours, but
  // it does so through OL's own rate limiter (a controlled, observable wait)
  // rather than manufacturing a spurious transport failure inside the
  // bridge's queue. Revisit only once the bridge gets its own idempotency
  // and/or a queue-depth signal OL could back off on.
  defaultRateLimit: { requestsPerMinute: 60, maxConcurrent: 1 },
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
        new SubiektConnectionTesterAdapter(host.http, subiektAdapterManifest.defaultRateLimit),
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
      // #3358: before this the plugin registered no AuthFailureClassifierPort
      // at all, so a bad/missing bridge token produced no connection-status
      // signal whatsoever — an operator would only discover it by reading raw
      // sync_jobs. A bridge outage (unreachable, not a 401/403) still
      // produces no signal here by design; that's a different failure class
      // (see the scheduled reachability sweep, subiekt-reachability-sweep
      // scheduler task) with a different remedy than re-entering credentials.
      host.authFailureClassifierRegistry.register(
        subiektAdapterManifest.adapterKey,
        new SubiektAuthFailureClassifierAdapter(),
      );
      // #3358: periodic reachability sweep — see subiekt-scheduler-tasks.ts
      // and subiekt-bridge-reachability-sweep.handler.ts.
      for (const task of buildSubiektSchedulerTasks()) {
        host.schedulerTaskRegistry.register(task);
      }
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
          host.http.forConnection(connection, subiektAdapterManifest.defaultRateLimit),
          host.identifierMapping,
        );
        // Fiscalization's table entry is OMITTED (not merely undefined-valued)
        // when the connection has no drukarkaFiskalnaId configured —
        // dispatchCapability only checks key PRESENCE (Object.hasOwn), so an
        // unconditional `Fiscalization: () => adapters.fiscalization` would
        // silently hand a caller `undefined as T` instead of the clear
        // "capability not supported" error this omission produces.
        const table: Record<string, () => unknown> = {
          Invoicing: () => adapters.invoicing,
          ProductMaster: () => adapters.productMaster,
          InventoryMaster: () => adapters.inventoryMaster,
          OrderSource: () => adapters.orderSource,
          OrderProcessorManager: () => adapters.orderProcessor,
        };
        if (adapters.fiscalization) {
          table.Fiscalization = (): unknown => adapters.fiscalization;
        }
        return dispatchCapability<T>(capability, table, SUBIEKT_BRAND);
      } catch (err) {
        return Promise.reject(err as Error);
      }
    },
  };
}
