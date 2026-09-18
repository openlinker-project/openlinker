/**
 * eparagony.pl Adapter Factory Port
 *
 * Contract for turning a `Connection` into this plugin's working capability
 * adapters. Kept as an interface so the plugin descriptor codes against a shape
 * rather than a class, per engineering-standards § Interface and Implementation
 * Separation.
 *
 * ONE method returning a BAG, not one method per capability (#3192, the
 * `IPrestashopAdapterFactory` / `IKsefAdapterFactory` shape). That is
 * load-bearing rather than cosmetic: both adapters must ride ONE
 * `EparagonyHttpClient`. The client owns the OAuth token cache and collapses a
 * burst of concurrent callers into a single in-flight token request, and the
 * vendor rate-limits `/auth/token` per IP and tells integrators not to fetch a
 * token per request. A second construction method would hand the second
 * capability its own client, its own empty token cache and its own token
 * round-trip - doubling this connection's traffic against the one endpoint that
 * answers `429` for the whole plugin.
 *
 * @module libs/integrations/eparagony/src/application/interfaces
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';

import type { EparagonyFiscalizationAdapter } from '../../infrastructure/adapters/eparagony-fiscalization.adapter';
import type { EparagonyInvoicingAdapter } from '../../infrastructure/adapters/eparagony-invoicing.adapter';

/**
 * The connection's capability adapters, built together over one HTTP client.
 *
 * BOTH are always built, whatever capability the caller asked for. Which lanes
 * an operator actually enabled is the host's question - it gates on
 * `enabledCapabilities` before it ever reaches this plugin - and building the
 * unasked-for one costs a single object and no I/O, while branching on the
 * requested capability would mean two code paths through the same client
 * construction. A receipts-only connection therefore carries an invoicing
 * adapter nothing resolves; if one ever did, that adapter refuses pre-call on
 * its own absent seller configuration rather than sending anything.
 */
export interface EparagonyAdapters {
  fiscalization: EparagonyFiscalizationAdapter;
  invoicing: EparagonyInvoicingAdapter;
}

export interface IEparagonyAdapterFactory {
  /**
   * Resolve credentials + config and construct this connection's capability
   * adapters over a single shared transport. `fetchImpl` is the host's
   * connection-bound transport (#1810) and is required, so the client can never
   * be wired to an unrated `globalThis.fetch`.
   */
  createAdapters(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    logger: LoggerPort,
    fetchImpl: FetchLike,
  ): Promise<EparagonyAdapters>;
}
