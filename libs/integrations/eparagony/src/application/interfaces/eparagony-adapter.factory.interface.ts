/**
 * eparagony.pl Adapter Factory Port
 *
 * Contract for turning a `Connection` into a working capability adapter. Kept as
 * an interface so the plugin descriptor codes against a shape rather than a
 * class, per engineering-standards § Interface and Implementation Separation.
 *
 * @module libs/integrations/eparagony/src/application/interfaces
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';

import type { EparagonyFiscalizationAdapter } from '../../infrastructure/adapters/eparagony-fiscalization.adapter';

export interface IEparagonyAdapterFactory {
  /**
   * Resolve credentials + config and construct the connection's fiscalization
   * adapter. `fetchImpl` is the host's connection-bound transport (#1810) and is
   * required, so the client can never be wired to an unrated `globalThis.fetch`.
   */
  createFiscalizationAdapter(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    logger: LoggerPort,
    fetchImpl: FetchLike,
  ): Promise<EparagonyFiscalizationAdapter>;
}
