/**
 * Subiekt Adapter Factory (#753)
 *
 * Builds per-connection Subiekt adapters from a `Connection`. Validates and
 * parses `connection.config` into `SubiektConnectionConfig`, resolves the
 * OPTIONAL bridge token ONLY when `connection.credentialsRef` is truthy
 * (`CredentialsResolverPort.get` must never be called with `''`), constructs the
 * `SubiektBridgeHttpClient` (whose construction may throw `SubiektConfigException`
 * for a bad / IMDS URL — propagated to the caller), and wraps it in a
 * `SubiektInvoicingAdapter`. Pure construction, no Nest decorators.
 *
 * @module libs/integrations/subiekt/src/application
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import type {
  SubiektConnectionConfig,
  SubiektPaymentMethod,
} from '../domain/types/subiekt-connection-config.types';
import { SubiektPaymentMethodValues } from '../domain/types/subiekt-connection-config.types';
import type { SubiektBridgeCredentials } from '../domain/types/subiekt-credentials.types';
import { SubiektConfigException } from '../domain/exceptions/subiekt-config.exception';
import { SubiektInvoicingAdapter } from '../infrastructure/adapters/subiekt-invoicing.adapter';
import { SubiektBridgeHttpClient } from '../infrastructure/http/subiekt-bridge-http.client';
import { SubiektProductMasterAdapter } from '../infrastructure/adapters/subiekt-product-master.adapter';
import { SubiektInventoryMasterAdapter } from '../infrastructure/adapters/subiekt-inventory-master.adapter';
import { SubiektInventoryBridgeClient } from '../infrastructure/http/subiekt-inventory-bridge.client';
import { SubiektOrderSourceAdapter } from '../infrastructure/adapters/subiekt-order-source.adapter';
import { SubiektOrderProcessorAdapter } from '../infrastructure/adapters/subiekt-order-processor.adapter';
import { SubiektOrdersBridgeClient } from '../bridge/subiekt-orders-bridge.client';
import { SubiektFiscalizationAdapter } from '../infrastructure/adapters/subiekt-fiscalization.adapter';

/**
 * The capability adapters this factory builds for a connection.
 *
 * `fiscalization` is OPTIONAL — built only when `config.drukarkaFiskalnaId`
 * is set (#3192). A connection with no configured fiscal printer legitimately
 * has no Fiscalization capability; `dispatchCapability` degrades to a clean
 * "capability not supported" rather than the factory guessing a device id.
 */
export interface SubiektAdapters {
  invoicing: SubiektInvoicingAdapter;
  productMaster: SubiektProductMasterAdapter;
  inventoryMaster: SubiektInventoryMasterAdapter;
  orderSource: SubiektOrderSourceAdapter;
  orderProcessor: SubiektOrderProcessorAdapter;
  fiscalization?: SubiektFiscalizationAdapter;
}

export class SubiektAdapterFactory {
  async createAdapters(
    connection: Connection,
    credentialsResolver: CredentialsResolverPort,
    logger: LoggerPort,
    fetchImpl: FetchLike,
    identifierMapping: IdentifierMappingPort,
  ): Promise<SubiektAdapters> {
    const config = this.validateAndParseConfig(
      (connection.config ?? {}) as Record<string, unknown>,
    );

    // The bridge token is OPTIONAL — resolve only when credentialsRef is
    // truthy. Never call credentialsResolver.get('').
    let token: string | undefined;
    if (connection.credentialsRef) {
      const credentials = await credentialsResolver.get<SubiektBridgeCredentials>(
        connection.credentialsRef,
      );
      token = credentials.bridgeToken;
    }

    // Construction may throw SubiektConfigException for a bad / IMDS URL —
    // propagated to the caller.
    const client = new SubiektBridgeHttpClient(config.bridgeBaseUrl, {
      token,
      timeoutMs: config.timeoutMs,
      fetchImpl,
    });

    const inventoryClient = new SubiektInventoryBridgeClient(config.bridgeBaseUrl, {
      token,
      timeoutMs: config.timeoutMs,
      fetchImpl,
    });

    const ordersClient = new SubiektOrdersBridgeClient(config.bridgeBaseUrl, {
      token,
      timeoutMs: config.timeoutMs,
      fetchImpl,
    });

    const adapters: SubiektAdapters = {
      invoicing: new SubiektInvoicingAdapter(client, connection.id, logger, config),
      productMaster: new SubiektProductMasterAdapter(config.bridgeBaseUrl, identifierMapping, connection, {
        token,
        timeoutMs: config.timeoutMs,
        fetchImpl,
        logger,
      }),
      inventoryMaster: new SubiektInventoryMasterAdapter(
        inventoryClient,
        identifierMapping,
        connection.id,
        logger,
      ),
      orderSource: new SubiektOrderSourceAdapter(ordersClient, logger),
      orderProcessor: new SubiektOrderProcessorAdapter(ordersClient, logger),
    };

    if (config.drukarkaFiskalnaId !== undefined) {
      adapters.fiscalization = new SubiektFiscalizationAdapter(
        config.bridgeBaseUrl,
        {
          drukarkaFiskalnaId: config.drukarkaFiskalnaId,
          stanowiskoKasoweId: config.defaultStanowiskoKasoweId,
        },
        logger,
        fetchImpl,
        token,
        config.timeoutMs,
      );
    }

    return adapters;
  }

  /**
   * Validate and parse the raw `connection.config` blob.
   * @throws SubiektConfigException on a missing / malformed `bridgeBaseUrl`,
   *   out-of-range `timeoutMs`, an invalid `defaultPaymentMethod`, or a
   *   non-positive-integer `bankAccountId` / `defaultStanowiskoKasoweId`.
   */
  private validateAndParseConfig(config: Record<string, unknown>): SubiektConnectionConfig {
    const bridgeBaseUrl = config.bridgeBaseUrl;
    if (typeof bridgeBaseUrl !== 'string' || bridgeBaseUrl.length === 0) {
      throw new SubiektConfigException(
        'bridgeBaseUrl is required and must be a non-empty string',
        'bridgeBaseUrl',
        bridgeBaseUrl,
      );
    }

    let timeoutMs: number | undefined;
    if (config.timeoutMs !== undefined) {
      const raw = config.timeoutMs;
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1000 || raw > 120000) {
        throw new SubiektConfigException(
          'timeoutMs must be an integer between 1000 and 120000',
          'timeoutMs',
          raw,
        );
      }
      timeoutMs = raw;
    }

    let defaultPaymentMethod: SubiektPaymentMethod | undefined;
    if (config.defaultPaymentMethod !== undefined) {
      const raw = config.defaultPaymentMethod;
      if (
        typeof raw !== 'string' ||
        !SubiektPaymentMethodValues.includes(raw as SubiektPaymentMethod)
      ) {
        throw new SubiektConfigException(
          `defaultPaymentMethod must be one of: ${SubiektPaymentMethodValues.join(', ')}`,
          'defaultPaymentMethod',
          raw,
        );
      }
      defaultPaymentMethod = raw as SubiektPaymentMethod;
    }

    const bankAccountId = this.parsePositiveIntField(config.bankAccountId, 'bankAccountId');
    const defaultStanowiskoKasoweId = this.parsePositiveIntField(
      config.defaultStanowiskoKasoweId,
      'defaultStanowiskoKasoweId',
    );
    const drukarkaFiskalnaId = this.parsePositiveIntField(
      config.drukarkaFiskalnaId,
      'drukarkaFiskalnaId',
    );

    const parsed: SubiektConnectionConfig = { bridgeBaseUrl };
    if (timeoutMs !== undefined) parsed.timeoutMs = timeoutMs;
    if (defaultPaymentMethod !== undefined) parsed.defaultPaymentMethod = defaultPaymentMethod;
    if (bankAccountId !== undefined) parsed.bankAccountId = bankAccountId;
    if (defaultStanowiskoKasoweId !== undefined) {
      parsed.defaultStanowiskoKasoweId = defaultStanowiskoKasoweId;
    }
    if (drukarkaFiskalnaId !== undefined) parsed.drukarkaFiskalnaId = drukarkaFiskalnaId;
    return parsed;
  }

  /**
   * Parse an OPTIONAL bridge-native positive-integer id field. Returns
   * `undefined` when absent; throws `SubiektConfigException` when present but
   * not a positive integer.
   */
  private parsePositiveIntField(raw: unknown, field: string): number | undefined {
    if (raw === undefined) return undefined;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
      throw new SubiektConfigException(
        `${field} must be a positive integer`,
        field,
        raw,
      );
    }
    return raw;
  }
}
