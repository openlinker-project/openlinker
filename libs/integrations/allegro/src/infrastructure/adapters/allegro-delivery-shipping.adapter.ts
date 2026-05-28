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
import type {
  GenerateLabelCommand,
  GenerateLabelResult,
  ShipmentCanceller,
  ShippingMethod,
  ShippingProviderManagerPort,
  TrackingSnapshot,
} from '@openlinker/core/shipping';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import { AllegroShipmentPendingException } from '../../domain/exceptions/allegro-shipment-pending.exception';
import { AllegroShipmentRejectedException } from '../../domain/exceptions/allegro-shipment-rejected.exception';
import type {
  AllegroCancelShipmentCommandRequest,
  AllegroCreateShipmentCommandRequest,
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

export class AllegroDeliveryShippingAdapter
  implements ShippingProviderManagerPort, ShipmentCanceller
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
      throw new AllegroShipmentRejectedException(
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
      throw new AllegroShipmentRejectedException(
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
        throw new AllegroShipmentRejectedException(
          `Allegro command ${commandId} failed: ${formatCommandErrors(result.errors)}`,
          result.errors,
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
   * Wrap an Allegro HTTP failure into a readable shipment-rejected error.
   * `AllegroApiException.message` already carries the parsed Allegro error
   * summary (built by the HTTP client); non-API errors (auth, network, rate
   * limit) propagate unchanged so the worker's retry classifier can act on them.
   */
  private toRejected(error: unknown, context: string): Error {
    if (error instanceof AllegroApiException) {
      return new AllegroShipmentRejectedException(`Failed to ${context}: ${error.message}`);
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
