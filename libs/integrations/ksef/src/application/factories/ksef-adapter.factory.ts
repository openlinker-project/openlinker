/**
 * KSeF Adapter Factory
 *
 * Single per-connection construction seam for the KSeF plugin. C2 builds the
 * stub `Invoicing` capability adapter; C3 resolves the connection's credentials
 * via the host `CredentialsResolverPort` and builds the concrete `KsefHttpClient`
 * (auth header injection, retry/backoff), and C4 wires the issuance mechanics.
 * Routing all construction through here keeps credential + environment
 * resolution in one place (the Allegro/Erli precedent).
 *
 * Not `@Injectable` — a plain class; the client it builds (C3) closes over one
 * connection's resolved secret, never a DI singleton.
 *
 * @module libs/integrations/ksef/src/application/factories
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { KsefInvoicingAdapter } from '../../infrastructure/adapters/ksef-invoicing.adapter';
import type { IKsefHttpClient } from '../../infrastructure/http/ksef-http-client.interface';
import type { IKsefAdapterFactory, KsefAdapters } from '../interfaces/ksef-adapter.factory.interface';

export type { KsefAdapters };

export class KsefAdapterFactory implements IKsefAdapterFactory {
  createAdapters(
    connection: Connection,
    // identifierMapping, credentialsResolver unused in the C2 stub; kept on the
    // signature so later phases extend behaviour without changing the factory
    // contract (mirrors the Allegro/Erli precedent).
    _identifierMapping: IdentifierMappingPort,
    _credentialsResolver: CredentialsResolverPort,
  ): Promise<KsefAdapters> {
    // C3 replaces this placeholder with a credentials-resolved KsefHttpClient.
    // The stub adapter never issues a request, so no secret is resolved in C2 —
    // credentials are deliberately NOT read from connection.config (ADR-003).
    const httpClient = this.createStubHttpClient();
    return Promise.resolve({
      invoicing: new KsefInvoicingAdapter(connection.id, httpClient),
    });
  }

  /**
   * Placeholder transport for C2. Every method rejects so a stray call surfaces
   * loudly rather than returning undefined; C3 swaps in the concrete client.
   */
  private createStubHttpClient(): IKsefHttpClient {
    const notWired = (): Promise<never> =>
      Promise.reject(new Error('KSeF HTTP client is not wired until C3'));
    return {
      get: notWired,
      post: notWired,
    };
  }
}
