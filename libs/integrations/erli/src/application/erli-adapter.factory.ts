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
 * Allegro category-catalog wiring (#1382/#1383, ADR-031): when the resolved
 * credentials carry BOTH `allegroClientId` and `allegroClientSecret`,
 * `createAdapters` also builds an `AllegroCategoryCatalogClient` (environment
 * from `config.allegroEnvironment ?? 'production'`) and passes it into the
 * offer-manager constructor, which wires `fetchCategories`/
 * `fetchCategoryParameters` as per-instance properties. Absent or partial
 * credentials → `undefined` is passed instead, leaving those properties unset
 * for this connection (never a static, connection-independent capability).
 *
 * @module libs/integrations/erli/src/application
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { IInventoryQueryService } from '@openlinker/core/inventory';
import type { CachePort } from '@openlinker/shared';
import { ErliConfigException } from '../domain/exceptions/erli-config.exception';
import { isAllowedErliBaseUrl } from '../domain/policies/erli-base-url.policy';
import {
  ERLI_DEFAULT_BASE_URL,
  type ErliConnectionConfig,
  type ErliCredentials,
} from '../domain/types/erli-connection.types';
import { ERLI_ADAPTER_KEY } from '../erli.constants';
import { AllegroCategoryCatalogClient } from '../infrastructure/http/allegro-category-catalog-client';
import { ErliOfferManagerAdapter } from '../infrastructure/adapters/erli-offer-manager.adapter';
import { ErliOrderSourceAdapter } from '../infrastructure/adapters/erli-order-source.adapter';
import { ErliHttpClient } from '../infrastructure/http/erli-http-client';
import type { IErliHttpClient } from '../infrastructure/http/erli-http-client.interface';
import type { RetryConfig } from '../infrastructure/http/erli-http-client.types';
import type {
  ErliAdapters,
  IErliAdapterFactory,
} from './interfaces/erli-adapter.factory.interface';

export type { ErliAdapters };

export class ErliAdapterFactory implements IErliAdapterFactory {
  /**
   * Build the per-connection capability adapters. Mirrors Allegro's
   * `createAdapters(connection, identifierMapping, credentialsResolver)`
   * signature — `identifierMapping` is unused by the seller-keyed-id offer
   * adapter today but kept so #985/#986/#988 extend behaviour without churning
   * this signature or the plugin's dispatch call site (Allegro pays the same
   * unused-dep cost deliberately).
   *
   * `cache` is the host-provided distributed cache (`host.cache`); the offer
   * adapter uses it for the #1066 frozen-stock flag. Optional — when absent the
   * adapter fails open (pushes stock) exactly as before. Threaded through this
   * method (rather than the constructor as Allegro does) because Erli's factory
   * is constructed argument-less inside `createCapabilityAdapter` — an Erli-local
   * choice; the cache still arrives from `host.cache` either way.
   *
   * `inventoryQuery` enables the #1198 `OrderStatusWriteback` `cancelled`
   * stock-restore path in `ErliOrderSourceAdapter`. Optional — absent means that
   * path reports `unsupported` (same fail-open posture as `cache`).
   */
  async createAdapters(
    connection: Connection,
    _identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
    cache?: CachePort,
    inventoryQuery?: IInventoryQueryService,
  ): Promise<ErliAdapters> {
    const httpClient = await this.createHttpClient(connection, credentialsResolver);
    const config = (connection.config ?? {}) as ErliConnectionConfig;
    // Resolved again here (createHttpClient above already resolved it for the
    // apiKey) so the factory can inspect the optional Allegro credential pair —
    // credentialsResolver reads are cheap per-connection-resolution, not
    // per-request, so the second resolve is not a hot-path cost.
    const credentials = await this.resolveCredentials(connection, credentialsResolver);
    const allegroCategoryCatalog = this.buildAllegroCategoryCatalog(credentials, config);
    // Construct the offer manager first so its reference can be shared with the
    // order-source adapter (which needs it for the `cancelled` stock-restore path).
    const offerManager = new ErliOfferManagerAdapter(
      connection.id,
      ERLI_ADAPTER_KEY,
      httpClient,
      config.defaultDispatchTime,
      cache,
      allegroCategoryCatalog,
    );
    return {
      offerManager,
      // Shares the one per-connection HTTP client with the offer adapter, exactly
      // as Allegro shares one client across its order-source + offer adapters.
      // Also shares the offer-manager reference for the stock-restore writeback.
      orderSource: new ErliOrderSourceAdapter(
        connection.id,
        httpClient,
        offerManager,
        inventoryQuery,
      ),
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

  /**
   * Build the optional Allegro category-catalog client (#1382/#1383, ADR-031).
   * Requires BOTH `allegroClientId` and `allegroClientSecret` — re-checked here
   * as defense-in-depth alongside `ErliConnectionCredentialsShapeValidatorAdapter`
   * (a pre-existing or externally-written credentials row could carry exactly
   * one). Absent or partial credentials return `undefined`, which the offer
   * adapter treats as "no category browsing wired for this connection" —
   * never a static, connection-independent capability.
   */
  private buildAllegroCategoryCatalog(
    credentials: ErliCredentials,
    config: ErliConnectionConfig,
  ): AllegroCategoryCatalogClient | undefined {
    const clientId = credentials.allegroClientId?.trim();
    const clientSecret = credentials.allegroClientSecret?.trim();
    if (!clientId || !clientSecret) {
      return undefined;
    }
    return new AllegroCategoryCatalogClient(
      clientId,
      clientSecret,
      config.allegroEnvironment ?? 'production',
    );
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
