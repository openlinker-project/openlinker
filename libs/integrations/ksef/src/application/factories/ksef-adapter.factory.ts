/**
 * KSeF Adapter Factory
 *
 * Single per-connection construction seam for the KSeF plugin. Resolves the
 * connection's credentials via the host `CredentialsResolverPort`, validates
 * the config + credential shape, and builds the concrete `KsefHttpClient` (auth
 * header injection, retry/backoff, token lifecycle) wired to the per-connection
 * capability adapters. C4 wires the issuance mechanics onto the same client.
 * Routing all construction through here keeps credential + environment
 * resolution in one place (the Allegro/Erli precedent).
 *
 * Not `@Injectable` — a plain class; the client it builds closes over one
 * connection's resolved secret, never a DI singleton.
 *
 * SECURITY: the resolved token is handed straight into the client's token
 * material and never logged. A missing `credentialsRef`, unresolvable secret, or
 * malformed credential shape fails fast with `KsefConfigException` before any
 * request leaves the client (ADR-003).
 *
 * Qualified-seal (X.509) connections are not constructable until C4 — they
 * throw `KsefConfigException` here so the connection fails loudly rather than
 * half-wiring an unusable client.
 *
 * @module libs/integrations/ksef/src/application/factories
 */
import type { CachePort } from '@openlinker/shared/cache';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { KsefInvoicingAdapter } from '../../infrastructure/adapters/ksef-invoicing.adapter';
import { createKsefHttpClient } from '../../infrastructure/http/ksef-http-client.factory';
import { KsefSessionCryptoService } from '../../infrastructure/crypto/ksef-session-crypto.service';
import { Fa3WithValidationBuilder } from '../../infrastructure/fa3/builders/fa3-with-validation.builder';
import type { SellerProfile } from '../../infrastructure/fa3/domain/fa3-xml.types';
import type { KsefTokenAuthMaterial } from '../../infrastructure/http/auth/ksef-auth-handshake.service';
import type {
  KsefConnectionConfig,
  KsefCredentials,
  KsefEnvironment,
  KsefSellerConfig,
} from '../../domain/types/ksef-connection.types';
import { KsefEnvironmentValues } from '../../domain/types/ksef-connection.types';
import { KsefConfigException } from '../../domain/exceptions/ksef-config.exception';
import type { IKsefAdapterFactory, KsefAdapters } from '../interfaces/ksef-adapter.factory.interface';

export type { KsefAdapters };

/** Resolved ksef-token secret shape behind `secretRef` (host-decrypted). */
interface KsefResolvedTokenSecret {
  token: string;
  contextNip: string;
}

export class KsefAdapterFactory implements IKsefAdapterFactory {
  constructor(private readonly cache?: CachePort) {}

  async createAdapters(
    connection: Connection,
    _identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<KsefAdapters> {
    const env = this.resolveEnvironment(connection);
    const credentials = await this.resolveCredentials(connection, credentialsResolver);
    const authMaterial = await this.resolveAuthMaterial(connection, credentials, credentialsResolver);

    const seller = this.resolveSeller(connection);

    const { httpClient, publicKeyCache } = createKsefHttpClient({
      connectionId: connection.id,
      env,
      authMaterial,
      cache: this.cache,
    });

    // C5 issuance dependencies: the session-crypto service (shares the same
    // MF public-key cache as the transport) + the FA(3) build/validate pipeline.
    const sessionCrypto = new KsefSessionCryptoService(publicKeyCache);
    const fa3Builder = new Fa3WithValidationBuilder();

    return {
      invoicing: new KsefInvoicingAdapter(
        connection.id,
        httpClient,
        sessionCrypto,
        fa3Builder,
        seller,
      ),
    };
  }

  private resolveEnvironment(connection: Connection): KsefEnvironment {
    const config = connection.config as Partial<KsefConnectionConfig> | undefined;
    const env = config?.env;
    if (!env || !KsefEnvironmentValues.includes(env)) {
      throw new KsefConfigException(`KSeF connection has no valid environment`, connection.id);
    }
    return env;
  }

  /**
   * Resolve the seller profile (Podmiot1) from the connection config. This is
   * system configuration — never a per-invoice input, never a credential — so it
   * lives on the connection row. A connection that lacks a well-formed seller
   * fails fast here rather than producing an FA(3) the XSD would reject.
   */
  private resolveSeller(connection: Connection): SellerProfile {
    const config = connection.config as Partial<KsefConnectionConfig> | undefined;
    const seller: KsefSellerConfig | undefined = config?.seller;
    const address = seller?.address;
    if (
      !seller ||
      typeof seller.nip !== 'string' ||
      seller.nip.trim().length === 0 ||
      typeof seller.name !== 'string' ||
      seller.name.trim().length === 0 ||
      !address ||
      typeof address.line1 !== 'string' ||
      typeof address.city !== 'string' ||
      typeof address.postalCode !== 'string' ||
      typeof address.countryIso2 !== 'string'
    ) {
      throw new KsefConfigException(
        'KSeF connection has no valid seller profile (nip/name/address required for issuance)',
        connection.id,
      );
    }
    return {
      nip: seller.nip,
      name: seller.name,
      address: {
        line1: address.line1,
        line2: address.line2 ?? null,
        city: address.city,
        postalCode: address.postalCode,
        countryIso2: address.countryIso2,
      },
    };
  }

  private async resolveCredentials(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<KsefCredentials> {
    if (!connection.credentialsRef) {
      throw new KsefConfigException('KSeF connection has no credentialsRef', connection.id);
    }
    const credentials = await credentialsResolver.get<KsefCredentials>(connection.credentialsRef);
    if (!credentials?.authType || !credentials?.secretRef) {
      throw new KsefConfigException('KSeF credentials missing authType or secretRef', connection.id);
    }
    return credentials;
  }

  private async resolveAuthMaterial(
    connection: Connection,
    credentials: KsefCredentials,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<KsefTokenAuthMaterial> {
    if (credentials.authType !== 'ksef-token') {
      // Qualified-seal needs real X.509/HSM material — deferred to C4.
      throw new KsefConfigException(
        `KSeF authType '${credentials.authType}' is not constructable until C4 (qualified-seal)`,
        connection.id,
      );
    }
    const secret = await credentialsResolver.get<KsefResolvedTokenSecret>(credentials.secretRef);
    if (!secret?.token || !secret?.contextNip) {
      throw new KsefConfigException('KSeF token secret missing token or contextNip', connection.id);
    }
    return { authType: 'ksef-token', token: secret.token, contextNip: secret.contextNip };
  }
}
