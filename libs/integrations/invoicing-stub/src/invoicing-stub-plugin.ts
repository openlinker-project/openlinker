/**
 * Invoicing-stub Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` for the perf-lab invoicing stub (#3006).
 * Capability: `'Invoicing'`. `requiresCredentials: false` (ADR-055's
 * credential-less connection pattern, the same one `@openlinker/oms` uses):
 * this adapter authenticates nothing — it talks to a stub process on the
 * lab's own docker network — so there is no secret to store and no
 * credential-shape validator to register.
 *
 * `register(host)` is deliberately absent (the OMS-plugin shape): this
 * plugin has no connection tester, no scheduler task, no webhook translator,
 * and no config/credentials shape validator to register. `config.apiBaseUrl`
 * is validated defensively inside `createCapabilityAdapter` instead (thrown
 * as `InvoicingStubConfigException` when absent), since there is no
 * dedicated validator registry entry for it.
 *
 * @module libs/integrations/invoicing-stub/src
 */
import { dispatchCapability, type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';

import {
  INVOICING_STUB_ADAPTER_KEY,
  INVOICING_STUB_BRAND,
  INVOICING_STUB_PLATFORM_TYPE,
} from './invoicing-stub.constants';
import {
  InvoicingStubConfigException,
  InvoicingStubInvoicingAdapter,
} from './infrastructure/adapters/invoicing-stub-invoicing.adapter';

/**
 * Static plugin manifest (#575). `createInvoicingStubPlugin().manifest`
 * returns this same reference, so the static and runtime views cannot drift.
 */
export const invoicingStubAdapterManifest: AdapterMetadata = {
  adapterKey: INVOICING_STUB_ADAPTER_KEY,
  platformType: INVOICING_STUB_PLATFORM_TYPE,
  supportedCapabilities: ['Invoicing'],
  displayName: INVOICING_STUB_BRAND,
  version: '0.1.0',
  isDefault: true,
  requiresCredentials: false,
};

interface InvoicingStubConnectionConfig {
  apiBaseUrl?: unknown;
}

export function createInvoicingStubPlugin(): AdapterPlugin {
  return {
    manifest: invoicingStubAdapterManifest,

    // eslint-disable-next-line @typescript-eslint/require-await -- AdapterPlugin.createCapabilityAdapter returns a Promise by contract; this factory is synchronous
    async createCapabilityAdapter<T>(
      connection: Connection,
      capability: string,
      host: HostServices,
    ): Promise<T> {
      const config = (connection.config ?? {}) as InvoicingStubConnectionConfig;
      const apiBaseUrl = typeof config.apiBaseUrl === 'string' ? config.apiBaseUrl.trim() : '';
      if (!apiBaseUrl) {
        throw new InvoicingStubConfigException(
          `invoicing-stub connection ${connection.id} has no config.apiBaseUrl - point it at the ` +
            `perf-lab stub, e.g. http://invoicing-stub:19082`,
        );
      }

      const logger = host.logger(`InvoicingStub:${connection.id}`);
      const adapter = new InvoicingStubInvoicingAdapter(
        connection.id,
        apiBaseUrl,
        // Connection-bound outbound transport (#1810). No manifest default
        // rate limit — the lab stub is the ceiling this measurement studies,
        // never OL's own outbound pacing.
        host.http.forConnection(connection),
        logger,
      );
      return dispatchCapability<T>(capability, { Invoicing: () => adapter }, INVOICING_STUB_BRAND);
    },
  };
}
