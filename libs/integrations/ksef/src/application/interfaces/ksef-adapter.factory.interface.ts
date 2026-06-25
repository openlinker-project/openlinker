/**
 * KSeF Adapter Factory Interface
 *
 * Contract for the single per-connection construction seam of the KSeF plugin:
 * resolve a connection's credentials + environment and build the capability
 * adapters. Mirrors the `IErliAdapterFactory` / `IAllegroAdapterFactory`
 * precedent so consumers depend on the abstraction rather than the concrete
 * factory class.
 *
 * C2 builds only the `Invoicing` capability (stub). C3 adds the concrete HTTP
 * client; C4 fills in the issuance mechanics. The signature stays stable across
 * those phases.
 *
 * @module libs/integrations/ksef/src/application/interfaces
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { InvoicingPort } from '@openlinker/core/invoicing';

/** Per-connection KSeF capability adapters resolved by `createAdapters`. */
export interface KsefAdapters {
  invoicing: InvoicingPort;
}

export interface IKsefAdapterFactory {
  /**
   * Build the per-connection capability adapters. `identifierMapping` is kept on
   * the signature (unused by the C2 stub) so later phases extend behaviour
   * without churning this contract or the plugin's dispatch call site — mirrors
   * the Allegro/Erli precedent.
   */
  createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<KsefAdapters>;
}
