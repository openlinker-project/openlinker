/**
 * InPost ShipX SDK — public barrel + default-wiring factory.
 *
 * @module index
 */

import { InpostShipXClient } from './application/inpost-shipx.client.ts';
import { FetchHttpClientAdapter } from './adapters/fetch-http-client.adapter.ts';
import { ConsoleLoggerAdapter } from './adapters/console-logger.adapter.ts';
import { StaticTokenProviderAdapter } from './adapters/static-token-provider.adapter.ts';
import type { HttpClientPort } from './domain/ports/http-client.port.ts';
import type { LoggerPort, LogLevel } from './domain/ports/logger.port.ts';
import type { TokenProviderPort } from './domain/ports/token-provider.port.ts';

export const INPOST_SHIPX_SANDBOX_BASE_URL = 'https://sandbox-api-shipx-pl.easypack24.net/v1';
export const INPOST_SHIPX_PRODUCTION_BASE_URL = 'https://api-shipx-pl.easypack24.net/v1';

export interface CreateInpostShipXClientOptions {
  /** A bearer token string, or a custom `TokenProviderPort`. */
  readonly token: string | TokenProviderPort;
  /** Defaults to the sandbox base URL. */
  readonly baseUrl?: string;
  readonly organizationId?: number | string;
  /** Inject a custom transport; defaults to fetch. */
  readonly httpClient?: HttpClientPort;
  /** Inject a logger, or pass a level to use the bundled console logger. */
  readonly logger?: LoggerPort;
  readonly logLevel?: LogLevel;
}

/**
 * Wires the default adapters (fetch + console logger + static token) while
 * leaving every seam overridable. This is the only place concrete adapters are
 * chosen — the client itself stays adapter-agnostic.
 */
export function createInpostShipXClient(options: CreateInpostShipXClientOptions): InpostShipXClient {
  const tokenProvider =
    typeof options.token === 'string' ? new StaticTokenProviderAdapter(options.token) : options.token;

  return new InpostShipXClient({
    baseUrl: options.baseUrl ?? INPOST_SHIPX_SANDBOX_BASE_URL,
    httpClient: options.httpClient ?? new FetchHttpClientAdapter(),
    tokenProvider,
    logger: options.logger ?? new ConsoleLoggerAdapter(options.logLevel ?? 'info'),
    organizationId: options.organizationId,
  });
}

export { InpostShipXClient } from './application/inpost-shipx.client.ts';
export type {
  InpostShipXClientDeps,
  WaitOptions,
} from './application/inpost-shipx.client.ts';

export { FetchHttpClientAdapter } from './adapters/fetch-http-client.adapter.ts';
export { ConsoleLoggerAdapter, NoopLoggerAdapter } from './adapters/console-logger.adapter.ts';
export { StaticTokenProviderAdapter } from './adapters/static-token-provider.adapter.ts';

export { InpostApiError } from './domain/errors/inpost-api.error.ts';
export { SHIPMENT_STATUS } from './domain/types/shipment.types.ts';

export type { HttpClientPort, HttpRequest, HttpResponse, HttpMethod, HttpResponseType } from './domain/ports/http-client.port.ts';
export type { LoggerPort, LogLevel } from './domain/ports/logger.port.ts';
export type { TokenProviderPort } from './domain/ports/token-provider.port.ts';
export type { Paged, Address, MonetaryAmount } from './domain/types/common.types.ts';
export type { Organization } from './domain/types/organization.types.ts';
export type { Point, PointsQuery, PointAddress, PointAddressDetails } from './domain/types/point.types.ts';
export type {
  CreateShipmentCommand,
  Shipment,
  ShipmentOffer,
  OfferCarrierRef,
  ShipmentTransaction,
  ShipmentStatus,
  ShipmentCustomAttributes,
  Contact,
  Parcel,
  ParcelTemplate,
  ParcelDimensions,
  ParcelWeight,
  LabelOptions,
  TrackingStatus,
  TrackingDetail,
} from './domain/types/shipment.types.ts';
