/**
 * Allegro Delivery Shipping Adapter (#833)
 *
 * Adapter implementing the core `ShippingProviderManagerPort` + `ShipmentCanceller`
 * for Allegro Delivery / Allegro One ("Wysyłam z Allegro") over Allegro's
 * `/shipment-management/*` API. Hosted on the Allegro **source** connection —
 * the `source_brokered` processor of the #832 fulfillment-routing model, so
 * `ShipmentDispatchService` (#835) drives it through `generateLabel` with no
 * dispatch-side changes.
 *
 * Agnostic by design: it consumes the resolved `deliveryMethodId` supplied on
 * the command (resolved upstream behind the dispatch seam, #833 ADR-012) and
 * never reaches for the order's source method. Create + cancel are async
 * commands (POST → poll); the bounded inline poll surfaces a still-pending
 * create as a retriable failure (the durable `pending` lifecycle + carrier
 * tracking are #838). The label PDF is returned as an opaque ref — byte
 * retrieval via `POST /shipment-management/label` is a deferred cross-provider
 * follow-up.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {ShippingProviderManagerPort}
 */
import { Logger } from '@openlinker/shared/logging';
import {
  ShippingProviderRejectionException,
  type GenerateLabelCommand,
  type GenerateLabelResult,
  type LabelDocument,
  type LabelDocumentReader,
  type ShipmentCanceller,
  type ShippingMethod,
  type ShippingProviderManagerPort,
  type TrackingSnapshot,
} from '@openlinker/core/shipping';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import { AllegroShipmentPendingException } from '../../domain/exceptions/allegro-shipment-pending.exception';
import type {
  AllegroCancelShipmentCommandRequest,
  AllegroCreateShipmentCommandRequest,
  AllegroShipmentCommandError,
  AllegroShipmentCommandResult,
  AllegroShipmentPollConfig,
  AllegroShipmentResource,
} from '../../domain/types/allegro-shipment.types';
import { DEFAULT_ALLEGRO_SHIPMENT_POLL_CONFIG } from '../../domain/types/allegro-shipment.types';
import type { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import {
  buildCreateShipmentInput,
  deriveCommandId,
  describeShipmentState,
  extractCarrierId,
  extractCarrierWaybill,
  formatCommandErrors,
  mapShipmentStateToStatus,
  toGenerateLabelResult,
} from '../mappers/allegro-shipment.mapper';

const SUPPORTED_METHODS: readonly ShippingMethod[] = ['paczkomat', 'kurier'];

const CREATE_COMMANDS_PATH = '/shipment-management/shipments/create-commands';
const CANCEL_COMMANDS_PATH = '/shipment-management/shipments/cancel-commands';
const SHIPMENTS_PATH = '/shipment-management/shipments';
const LABEL_PATH = '/shipment-management/label';

/**
 * Page geometry for the label request. NOT a format selector — the returned
 * document format (PDF / ZPL / EPL) is governed by the seller's "Ship with
 * Allegro" account setting, so the adapter reads the actual format from the
 * response `Content-Type` rather than assuming it here. `A6` is the
 * thermal-label default.
 */
const LABEL_PAGE_SIZE = 'A6';

export class AllegroDeliveryShippingAdapter
  implements ShippingProviderManagerPort, ShipmentCanceller, LabelDocumentReader
{
  private readonly logger = new Logger(AllegroDeliveryShippingAdapter.name);
  private readonly pollConfig: AllegroShipmentPollConfig;

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IAllegroHttpClient,
    _connection: Connection,
    pollConfig?: Partial<AllegroShipmentPollConfig>,
  ) {
    void _connection;
    this.pollConfig = { ...DEFAULT_ALLEGRO_SHIPMENT_POLL_CONFIG, ...pollConfig };
  }

  getSupportedMethods(): readonly ShippingMethod[] {
    return SUPPORTED_METHODS;
  }

  async generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult> {
    if (!SUPPORTED_METHODS.includes(cmd.shippingMethod)) {
      throw new ShippingProviderRejectionException(
        'allegro',
        'preflight.unsupported-method',
        `Allegro Delivery does not support shipping method '${cmd.shippingMethod}'`,
      );
    }

    // Throws a readable validation error if the resolved deliveryMethodId or
    // parcel dimensions/weight are missing.
    const input = buildCreateShipmentInput(cmd);
    const commandId = deriveCommandId(cmd.shipmentId);
    const body: AllegroCreateShipmentCommandRequest = { commandId, input };

    this.logger.debug(
      `Creating Allegro Delivery shipment for ${cmd.shipmentId} (connection ${this.connectionId}, command ${commandId})`,
    );

    try {
      await this.httpClient.post<unknown>(
        CREATE_COMMANDS_PATH,
        body as unknown as Record<string, unknown>,
      );
    } catch (error) {
      throw this.toRejected(error, `create shipment for ${cmd.shipmentId}`);
    }

    const result = await this.pollUntilTerminal(CREATE_COMMANDS_PATH, commandId);
    if (!result.shipmentId) {
      throw new ShippingProviderRejectionException(
        'allegro',
        'command.success-without-shipment-id',
        `Allegro create-command ${commandId} succeeded without a shipmentId`,
      );
    }
    return toGenerateLabelResult(result.shipmentId);
  }

  async getTracking(input: { providerShipmentId: string }): Promise<TrackingSnapshot> {
    // Intentional asymmetry vs generateLabel/cancelShipment: a read failure
    // propagates the raw Allegro error (API / auth / rate-limit) unchanged, so
    // the worker retry classifier can act on its retryability. Do NOT wrap it
    // into AllegroShipmentRejectedException — that would mask the error type.
    const response = await this.httpClient.get<AllegroShipmentResource>(
      `${SHIPMENTS_PATH}/${input.providerShipmentId}`,
    );
    const resource = response.data;
    // Carrier waybill + carrier-id arrive asynchronously after `generateLabel`
    // returns (#838 / #769); both undefined here is normal until the first
    // poll surfaces them in `transportingInfo[].{carrierWaybill,carrierId}`.
    // They typically appear together — Allegro brokers the carrier first,
    // then the carrier issues the waybill — but the snapshot doesn't promise
    // joint atomicity, so either may show up alone on intermediate polls.
    return {
      status: mapShipmentStateToStatus(resource),
      providerStatus: describeShipmentState(resource),
      trackingNumber: extractCarrierWaybill(resource),
      carrier: extractCarrierId(resource),
    };
  }

  async cancelShipment(input: { providerShipmentId: string }): Promise<void> {
    const commandId = deriveCommandId(`cancel:${input.providerShipmentId}`);
    const body: AllegroCancelShipmentCommandRequest = {
      commandId,
      input: { shipmentId: input.providerShipmentId },
    };

    try {
      await this.httpClient.post<unknown>(
        CANCEL_COMMANDS_PATH,
        body as unknown as Record<string, unknown>,
      );
    } catch (error) {
      throw this.toRejected(error, `cancel shipment ${input.providerShipmentId}`);
    }

    await this.pollUntilTerminal(CANCEL_COMMANDS_PATH, commandId);
  }

  async fetchLabel(input: { providerShipmentId: string }): Promise<LabelDocument> {
    // `POST /shipment-management/label` returns the label document bytes
    // directly. `pageSize` is page geometry, not a format selector — the
    // format (PDF/ZPL/EPL) follows the seller's account setting, so we forward
    // whatever `Content-Type` Allegro reports and default to PDF only when the
    // header is absent (never overwrite a real one).
    try {
      const response = await this.httpClient.postExpectingBinary(LABEL_PATH, {
        shipmentIds: [input.providerShipmentId],
        pageSize: LABEL_PAGE_SIZE,
      });
      return {
        contentType: response.contentType || 'application/pdf',
        body: response.data,
      };
    } catch (error) {
      throw this.toRejected(error, `fetch label for ${input.providerShipmentId}`);
    }
  }

  /**
   * Poll a create/cancel command to a terminal state. `SUCCESS` returns the
   * command result; `ERROR` throws a readable `AllegroShipmentRejectedException`;
   * exhausting the bounded budget while still `IN_PROGRESS` throws
   * `AllegroShipmentPendingException` (retriable; #838 reconciles).
   */
  private async pollUntilTerminal(
    basePath: string,
    commandId: string,
  ): Promise<AllegroShipmentCommandResult> {
    let delayMs = this.pollConfig.initialDelayMs;
    for (let attempt = 0; attempt < this.pollConfig.maxAttempts; attempt++) {
      const response = await this.httpClient.get<AllegroShipmentCommandResult>(
        `${basePath}/${commandId}`,
      );
      const result = response.data;

      if (result.status === 'SUCCESS') {
        return result;
      }
      if (result.status === 'ERROR') {
        throw new ShippingProviderRejectionException(
          'allegro',
          firstAllegroErrorCode(result.errors),
          `Allegro command ${commandId} failed: ${formatCommandErrors(result.errors)}`,
          result.errors ? { errors: result.errors } : undefined,
        );
      }

      // IN_PROGRESS — wait, honouring a Retry-After header when present.
      const retryAfterMs = this.parseRetryAfterMs(response.headers) ?? delayMs;
      await this.sleep(Math.min(retryAfterMs, this.pollConfig.maxDelayMs));
      delayMs = Math.min(delayMs * this.pollConfig.backoffFactor, this.pollConfig.maxDelayMs);
    }
    throw new AllegroShipmentPendingException(commandId);
  }

  /**
   * Wrap an Allegro HTTP failure into the typed rejection seam (#885).
   * `AllegroApiException.message` already carries the parsed Allegro error
   * summary (built by the HTTP client); non-API errors (auth, network, rate
   * limit) propagate unchanged so the worker's retry classifier can act on them.
   *
   * `providerCode` carries the HTTP status (`api.http-400`, `api.http-500`,
   * `api.http-unknown`) so structured logs / operator UI can distinguish
   * carrier-rejected payloads (4xx) from upstream availability issues (5xx)
   * at the discriminator level — the full message stays operator-readable.
   */
  private toRejected(error: unknown, context: string): Error {
    if (error instanceof AllegroApiException) {
      return new ShippingProviderRejectionException(
        'allegro',
        `api.http-${error.statusCode ?? 'unknown'}`,
        `Failed to ${context}: ${error.message}`,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private parseRetryAfterMs(headers: Record<string, string>): number | null {
    const raw = headers['retry-after'];
    if (!raw) {
      return null;
    }
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Pick the first Allegro command error code to use as the rejection's
 * `providerCode`. Allegro's structured `errors[]` carries actionable codes
 * like `DELIVERY_METHOD_NOT_AVAILABLE` or `INVALID_PARCEL_DIMENSIONS`;
 * returns `null` when no errors are surfaced.
 *
 * **Multi-error semantics**: when Allegro returns more than one error, only
 * the first surfaces as the discriminator. The full array is preserved on
 * `providerDetails.errors` so operators / structured logs see every error
 * the carrier reported. The first-error discriminator is sufficient for
 * status-histogram aggregation; consumers that need to act on the full set
 * read `providerDetails.errors`.
 */
function firstAllegroErrorCode(
  errors: readonly AllegroShipmentCommandError[] | undefined,
): string | null {
  if (!errors || errors.length === 0) return null;
  const code = errors[0]?.code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}
