/**
 * PrestaShop Connection Tester Adapter
 *
 * Implements ConnectionTesterPort for PrestaShop connections. Performs a cheap
 * authenticated probe against `GET /api/products?limit=1` to validate that the
 * configured base URL + webservice API key still work.
 *
 * Never throws — all failures are translated into a structured
 * `ConnectionTestResult` with `success: false`.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {ConnectionTesterPort}
 */
import type {
  ConnectionTesterPort,
  ConnectionTestResult,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type { Connection, ConnectionRateLimit } from '@openlinker/core/identifier-mapping';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { PrestashopWebserviceClient } from '../http/prestashop-webservice.client';
import type { PrestashopCredentials } from '../../domain/types/prestashop-credentials.types';
import type { PrestashopConnectionConfig } from '../../domain/types/prestashop-config.types';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { PrestashopCountryResolver } from '../provisioners/prestashop-country-resolver';
import { PrestashopSalesCountryResolver } from '../provisioners/prestashop-sales-country.resolver';

export class PrestashopConnectionTesterAdapter implements ConnectionTesterPort {
  constructor(
    private readonly httpTransportFactory: HttpTransportFactoryPort,
    // The plugin manifest's `defaultRateLimit` (#1810) — passed in by the
    // registration call site (`prestashop-plugin.ts`) rather than imported
    // back from it, which would create a module-load cycle
    // (prestashop-plugin.ts -> this file -> prestashop-plugin.ts).
    private readonly defaultRateLimit?: ConnectionRateLimit
  ) {}

  async test(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort
  ): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const baseUrl = (connection.config as Record<string, unknown>).baseUrl;
      if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
        return {
          success: false,
          message: 'Connection config is missing baseUrl',
          latencyMs: Date.now() - startedAt,
        };
      }

      const credentials = await credentialsResolver.get<PrestashopCredentials>(
        connection.credentialsRef
      );

      const config: PrestashopConnectionConfig = {
        baseUrl,
        timeoutMs: 5000,
        pageSize: 1,
        langId: 1,
        responseFormat: 'auto',
      };

      // Connection-bound outbound transport (#1810) — a "Test connection"
      // click is operator-triggered and can be repeated in quick succession;
      // it must go through the same rate limiter as every other PS call
      // site, not a bare globalThis.fetch.
      const fetchImpl = this.httpTransportFactory.forConnection(connection, this.defaultRateLimit);

      const client = new PrestashopWebserviceClient(baseUrl, credentials, config, {
        retryConfig: {
          maxRetries: 0,
          initialDelayMs: 0,
          maxDelayMs: 0,
          backoffMultiplier: 1,
        },
        fetchImpl,
      });

      await client.listResources('products', undefined, 1);

      return {
        success: true,
        status: 200,
        message: `OK. ${await this.describeSalesCountry(connection, client)}`,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const err = error as { name?: string; statusCode?: number; message?: string };
      let status: number | undefined;
      if (typeof err.statusCode === 'number') {
        status = err.statusCode;
      } else if (err.name === 'PrestashopAuthenticationException') {
        status = 401;
      } else if (err.name === 'PrestashopResourceNotFoundException') {
        status = 404;
      }
      return {
        success: false,
        status,
        message: err.message ?? 'PrestaShop probe failed',
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * One sentence on the country catalogue prices are read for (ADR-077) - the
   * operator-facing place a wrong one shows up. Without a country, or with a
   * country no tax rule names, products in taxed groups report no price, and
   * the product master only says so in the worker log.
   *
   * Best-effort: the connection itself already proved to work, so a failure
   * here only weakens the note, never the result.
   */
  private async describeSalesCountry(
    connection: Connection,
    client: IPrestashopWebserviceClient
  ): Promise<string> {
    try {
      const configured = (connection.config as Record<string, unknown>).salesCountryIso2;
      const country = await new PrestashopSalesCountryResolver(
        new PrestashopCountryResolver()
      ).resolve(
        connection.id,
        typeof configured === 'string' && configured.trim().length > 0 ? configured : undefined,
        client
      );
      if (country === null) {
        return (
          'Warning: no sales country could be resolved, so catalogue prices will be unavailable. ' +
          'Set "salesCountryIso2" on the connection (for example PL).'
        );
      }
      const source = country.source === 'setting' ? 'connection setting' : 'shop default country';
      if (!country.taxesEnabled) {
        return `Prices are read for ${country.iso2} (${source}); taxes are switched off in the shop.`;
      }
      const rules = await client.listResources(
        'tax_rules',
        { custom: { id_country: country.countryId } },
        1
      );
      if (rules.length === 0) {
        return (
          `Warning: prices are read for ${country.iso2} (${source}), but no tax rule in the shop ` +
          `names ${country.iso2}, so taxed products will report no price. Set "salesCountryIso2" ` +
          `to the country you sell in.`
        );
      }
      return `Prices are read for ${country.iso2} (${source}).`;
    } catch {
      return 'The sales country could not be checked.';
    }
  }
}
