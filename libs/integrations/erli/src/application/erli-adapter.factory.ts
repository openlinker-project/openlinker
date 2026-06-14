/**
 * Erli Adapter Factory
 *
 * Single per-connection construction seam for the Erli plugin: resolves the
 * connection's static API key + base URL and builds a configured
 * `ErliHttpClient`. The #982 connection tester and the future #984 (offers) /
 * #993 (orders) capability adapters all route through here so credential and
 * base-URL resolution lives in one place.
 *
 * Not `@Injectable` — a plain class; the client it builds closes over one
 * connection's API key (ADR-025 static-key model, never a DI singleton).
 *
 * @module libs/integrations/erli/src/application
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type {
  OfferCreator,
  OfferFieldUpdater,
  OfferManagerPort,
} from '@openlinker/core/listings';
import { ErliConfigException } from '../domain/exceptions/erli-config.exception';
import { isAllowedErliBaseUrl } from '../domain/policies/erli-base-url.policy';
import {
  ERLI_DEFAULT_BASE_URL,
  type ErliConnectionConfig,
  type ErliCredentials,
} from '../domain/types/erli-connection.types';
import { ERLI_ADAPTER_KEY } from '../erli.constants';
import { ErliOfferManagerAdapter } from '../infrastructure/adapters/erli-offer-manager.adapter';
import { ErliHttpClient } from '../infrastructure/http/erli-http-client';
import type { IErliHttpClient } from '../infrastructure/http/erli-http-client.interface';
import type { RetryConfig } from '../infrastructure/http/erli-http-client.types';
import type { IErliAdapterFactory } from './interfaces/erli-adapter.factory.interface';

/** Per-connection Erli capability adapters resolved by the factory (#984). */
export interface ErliAdapters {
  offerManager: OfferManagerPort & OfferCreator & OfferFieldUpdater;
}

export class ErliAdapterFactory implements IErliAdapterFactory {
  /**
   * Build the per-connection capability adapters. Mirrors Allegro's
   * `createAdapters(connection, identifierMapping, credentialsResolver)`
   * signature — `identifierMapping` is unused by the seller-keyed-id offer
   * adapter today but kept so #985/#986/#988 extend behaviour without churning
   * this signature or the plugin's dispatch call site (Allegro pays the same
   * unused-dep cost deliberately).
   */
  async createAdapters(
    connection: Connection,
    _identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ErliAdapters> {
    const httpClient = await this.createHttpClient(connection, credentialsResolver);
    return {
      offerManager: new ErliOfferManagerAdapter(connection.id, ERLI_ADAPTER_KEY, httpClient),
    };
  }

  /**
   * Build a per-connection Erli HTTP client. Pass `retryConfig` to override the
   * default retry budget — the connection tester passes a no-retry config so a
   * probe fails fast.
   */
  async createHttpClient(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    retryConfig?: Partial<RetryConfig>,
  ): Promise<IErliHttpClient> {
    const { apiKey } = await this.resolveCredentials(connection, credentialsResolver);
    const baseUrl = this.resolveBaseUrl(connection);
    return new ErliHttpClient(connection.id, baseUrl, apiKey, retryConfig);
  }

  private async resolveCredentials(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
  ): Promise<ErliCredentials> {
    if (!connection.credentialsRef) {
      throw new ErliConfigException(
        `Erli connection ${connection.id} is missing credentialsRef`,
        connection.id,
      );
    }
    const credentials = await credentialsResolver.get<ErliCredentials>(connection.credentialsRef);
    if (typeof credentials?.apiKey !== 'string' || credentials.apiKey.trim().length === 0) {
      throw new ErliConfigException(
        `Erli connection ${connection.id} credentials are missing a non-empty apiKey`,
        connection.id,
      );
    }
    return credentials;
  }

  private resolveBaseUrl(connection: Connection): string {
    const config = (connection.config ?? {}) as ErliConnectionConfig;
    const override = config.baseUrl?.trim();
    if (!override || override.length === 0) {
      return ERLI_DEFAULT_BASE_URL;
    }
    // Defense-in-depth: the config-shape validator enforces the https + Erli-host
    // allowlist at create/update, but a pre-existing or externally-written row
    // could carry a plain-http or off-host baseUrl — which would send the bearer
    // key over cleartext or to an attacker-controlled host (SSRF). Re-check here
    // so the property doesn't rest solely on create-time validation (PR1057-TECH-03).
    if (!isAllowedErliBaseUrl(override)) {
      throw new ErliConfigException(
        `Erli connection ${connection.id} has a disallowed baseUrl (must be https and an Erli-owned host)`,
        connection.id,
      );
    }
    return override;
  }
}
