/**
 * InPost Shipping Adapter
 *
 * Implements the core `ShippingProviderManagerPort` plus the `ShipmentCanceller`
 * and `PickupPointFinder` sub-capabilities against the InPost ShipX REST API.
 * Thin orchestration only: it delegates wire translation to `inpost-shipx.mapper`
 * and HTTP/retry/error-mapping to `IInpostHttpClient`. Persistence + idempotency
 * are the caller's concern (the job layer) — this adapter just talks to ShipX.
 *
 * Class name is deliberately shortened from the `{Platform}{Capability}Adapter`
 * rule's `InpostShippingProviderManagerAdapter` (the capability name is
 * unwieldy; the short form matches #764/#765 and the shipping-domain vocabulary).
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters
 */
import { Logger } from '@openlinker/shared/logging';
import {
  ShippingProviderRejectionException,
  type ShippingProviderManagerPort,
  type ShipmentCanceller,
  type PickupPointFinder,
  type GenerateLabelCommand,
  type GenerateLabelResult,
  type TrackingSnapshot,
  type ShippingMethod,
  type PickupPoint,
  type FindPickupPointsQuery,
} from '@openlinker/core/shipping';
import type { InpostConnectionConfig } from '../../domain/types/inpost-config.types';
import type { ShipXPointsResponse, ShipXShipment } from '../../domain/types/inpost-shipx.types';
import type { IInpostHttpClient } from '../http/inpost-http-client.interface';
import {
  buildCreateShipmentRequest,
  buildPointsQuery,
  mapShipXStatus,
  toGenerateLabelResult,
  toPickupPoint,
  toTrackingSnapshot,
} from '../mappers/inpost-shipx.mapper';

const SUPPORTED_METHODS: readonly ShippingMethod[] = ['paczkomat', 'kurier'];

export class InpostShippingAdapter
  implements ShippingProviderManagerPort, ShipmentCanceller, PickupPointFinder
{
  private readonly logger = new Logger(InpostShippingAdapter.name);

  constructor(
    private readonly http: IInpostHttpClient,
    private readonly config: InpostConnectionConfig,
  ) {}

  getSupportedMethods(): readonly ShippingMethod[] {
    return SUPPORTED_METHODS;
  }

  async generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult> {
    const body = buildCreateShipmentRequest(cmd, this.config);
    let shipment: ShipXShipment;
    try {
      shipment = await this.http.request<ShipXShipment>({
        method: 'POST',
        path: `/v1/organizations/${this.config.organizationId}/shipments`,
        body,
      });
    } catch (error) {
      // ShipX rejecting the chosen locker surfaces as a generic validation
      // error; re-tag it with the stable `target_point` `providerCode` so
      // callers can offer "pick another locker" (#885).
      if (
        error instanceof ShippingProviderRejectionException &&
        error.providerName === 'inpost' &&
        cmd.paczkomatId &&
        mentionsTargetPoint(error)
      ) {
        throw new ShippingProviderRejectionException(
          'inpost',
          'target_point',
          error.message,
          {
            paczkomatId: cmd.paczkomatId,
            ...(error.providerDetails ?? {}),
          },
        );
      }
      throw error;
    }
    return toGenerateLabelResult(shipment);
  }

  async getTracking(input: { providerShipmentId: string }): Promise<TrackingSnapshot> {
    const shipment = await this.http.request<ShipXShipment>({
      method: 'GET',
      path: `/v1/shipments/${input.providerShipmentId}`,
    });
    const mapped = mapShipXStatus(shipment.status);
    if (mapped === null) {
      this.logger.warn(
        `Unknown ShipX status '${shipment.status}' for shipment ${input.providerShipmentId}; treating as in-transit`,
      );
      return toTrackingSnapshot('in-transit', shipment.status);
    }
    return toTrackingSnapshot(mapped, shipment.status);
  }

  async cancelShipment(input: { providerShipmentId: string }): Promise<void> {
    // ShipX only permits cancellation pre-confirmation; once confirmed it
    // returns `invalid_action`, which the HTTP client maps to
    // InpostValidationException for the caller to handle (best-effort cancel).
    await this.http.request<void>({
      method: 'DELETE',
      path: `/v1/shipments/${input.providerShipmentId}`,
    });
  }

  async findPickupPoints(query: FindPickupPointsQuery): Promise<PickupPoint[]> {
    const response = await this.http.request<ShipXPointsResponse>({
      method: 'GET',
      path: '/v1/points',
      query: buildPointsQuery(query),
    });
    return (response.items ?? []).map(toPickupPoint);
  }
}

function mentionsTargetPoint(error: ShippingProviderRejectionException): boolean {
  const fieldErrors = error.providerDetails?.fieldErrors;
  if (
    fieldErrors !== null &&
    typeof fieldErrors === 'object' &&
    !Array.isArray(fieldErrors) &&
    Object.keys(fieldErrors as Record<string, unknown>).includes('target_point')
  ) {
    return true;
  }
  return /target_point|paczkomat/i.test(error.message);
}
