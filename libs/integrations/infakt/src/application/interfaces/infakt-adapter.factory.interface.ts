/**
 * Infakt Adapter Factory Interface
 *
 * Contract for the single per-connection construction seam of the Infakt
 * plugin: resolve a connection's credentials and build the `Invoicing`
 * capability adapter. Mirrors the `IKsefAdapterFactory` / `IErliAdapterFactory`
 * precedent so consumers depend on the abstraction rather than the concrete
 * factory class.
 *
 * @module libs/integrations/infakt/src/application/interfaces
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { InfaktInvoicingAdapter } from '../../infrastructure/adapters/infakt-invoicing.adapter';

export interface IInfaktAdapterFactory {
  createInvoicingAdapter(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    logger: LoggerPort,
  ): Promise<InfaktInvoicingAdapter>;
}
