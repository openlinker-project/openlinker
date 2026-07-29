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
  type LabelDocumentReader,
  type DispatchProtocolReader,
  type ShipmentReferenceReconciler,
  type ReconciledShipment,
  type GenerateLabelCommand,
  type GenerateLabelResult,
  type LabelDocument,
  type TrackingSnapshot,
  type ShippingMethod,
  type PickupPoint,
  type FindPickupPointsQuery,
} from '@openlinker/core/shipping';
import type { InpostConnectionConfig } from '../../domain/types/inpost-config.types';
import type {
  ShipXPointsResponse,
  ShipXShipment,
  ShipXShipmentsResponse,
} from '../../domain/types/inpost-shipx.types';
import type { IInpostHttpClient } from '../http/inpost-http-client.interface';
import {
  buildCreateShipmentRequest,
  buildPointsQuery,
  buildProtocolQuery,
  mapShipXStatus,
  toGenerateLabelResult,
  toPickupPoint,
  toTrackingSnapshot,
} from '../mappers/inpost-shipx.mapper';

const SUPPORTED_METHODS: readonly ShippingMethod[] = ['paczkomat', 'kurier'];

/**
 * Page size for the reference lookup (#1917). Small on purpose: a reference is
 * expected to match at most one shipment (two only for pre-#1917 rows), so a
 * bigger page would just pay for data the filter should have excluded. It
 * doubles as the "did ShipX ignore the filter" probe — a response holding this
 * many items with none matching is almost certainly an unfiltered page.
 */
const REFERENCE_LOOKUP_PAGE_SIZE = 10;

export class InpostShippingAdapter
  implements
    ShippingProviderManagerPort,
    ShipmentCanceller,
    PickupPointFinder,
    LabelDocumentReader,
    DispatchProtocolReader,
    ShipmentReferenceReconciler
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
    const trackingNumber = shipment.tracking_number ?? undefined;
    if (mapped === null) {
      this.logger.warn(
        `Unknown ShipX status '${shipment.status}' for shipment ${input.providerShipmentId}; treating as in-transit`,
      );
      return toTrackingSnapshot('in-transit', shipment.status, trackingNumber);
    }
    return toTrackingSnapshot(mapped, shipment.status, trackingNumber);
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

  async fetchLabel(input: { providerShipmentId: string }): Promise<LabelDocument> {
    // ShipX returns the label document bytes directly. We request PDF; the
    // adapter forwards whatever `Content-Type` ShipX reports (it can answer
    // PNG for some carriers) and defaults to PDF only when the header is absent.
    const { body, contentType } = await this.http.requestBinary({
      method: 'GET',
      path: `/v1/shipments/${input.providerShipmentId}/label`,
      query: { format: 'pdf' },
    });
    return { contentType: contentType || 'application/pdf', body };
  }

  async generateProtocol(input: { providerShipmentIds: string[] }): Promise<LabelDocument> {
    // The handover protocol ("protokół odbioru") is a per-batch manifest ShipX
    // renders from `dispatch_orders/printouts` over already-confirmed shipments,
    // with or without a courier pickup order. Idempotent read (no carrier side
    // effect) → shares the client's retry machinery via `requestBinary`. ShipX
    // returns a single PDF when all shipments share one service and a ZIP when
    // they span several; the reported content type is forwarded either way and
    // defaults to PDF only when the header is absent (matches `fetchLabel`).
    const { body, contentType } = await this.http.requestBinary({
      method: 'GET',
      path: `/v1/organizations/${this.config.organizationId}/dispatch_orders/printouts`,
      query: buildProtocolQuery(input.providerShipmentIds),
    });
    return { contentType: contentType || 'application/pdf', body };
  }

  /**
   * Find a shipment ShipX already holds under an OL-stamped reference (#1917).
   *
   * `reference` is free text on ShipX — it does NOT deduplicate at creation —
   * but the organization shipment collection can be filtered by it, which is
   * enough to recover a label whose create-response was lost.
   *
   * Two deliberate strictnesses, both about never adopting the wrong shipment:
   *
   * 1. **Client-side equality re-check.** If ShipX ignores an unsupported
   *    filter it answers with an unfiltered page rather than an error, so the
   *    filter alone cannot be trusted. Only an exact `reference` match counts,
   *    and a shipment that does not echo `reference` at all is not a match.
   * 2. **Multi-match adopts nothing.** Rows created before the #1917 dispatch
   *    lock can carry two ShipX shipments under one reference (the loser of the
   *    old race reset the winner's row and re-sent the same id). Picking either
   *    would mis-link a paid label, so return null and let the caller decide.
   *
   * Only the FIRST page is read, which makes the two strictnesses above
   * asymmetric in one way worth naming: if ShipX ignores the `reference` filter
   * it answers with an unfiltered first page, and for an organization with more
   * shipments than one page the real match is almost never on it - so the
   * lookup would degrade into a permanent silent no-op. Safe (it still never
   * adopts a stranger) but dead. Hence the `warn` below when a FULL page comes
   * back with nothing matching: that is the signature of an unsupported filter,
   * and it makes the pending live-sandbox verification of the exact ShipX query
   * spelling self-diagnosing instead of invisible (#1917).
   */
  async findShipmentByReference(input: { reference: string }): Promise<ReconciledShipment | null> {
    const response = await this.http.request<ShipXShipmentsResponse>({
      method: 'GET',
      path: `/v1/organizations/${this.config.organizationId}/shipments`,
      query: { reference: input.reference, per_page: REFERENCE_LOOKUP_PAGE_SIZE },
    });

    const items = response.items ?? [];
    const matches = items.filter((item) => item.reference === input.reference);

    if (matches.length === 0) {
      if (items.length >= REFERENCE_LOOKUP_PAGE_SIZE) {
        this.logger.warn(
          `ShipX returned a full page of ${items.length} shipments for reference ` +
            `${input.reference} and none of them carries it: the 'reference' query filter is ` +
            `likely unsupported, which would make this an unfiltered page and the lookup ` +
            `unable to ever adopt an orphaned label (#1917)`,
        );
      }
      return null;
    }

    if (matches.length > 1) {
      this.logger.warn(
        `ShipX holds ${matches.length} shipments under reference ${input.reference} ` +
          `(${matches.map((m) => m.id).join(', ')}); refusing to adopt an ambiguous match`,
      );
      return null;
    }

    const [match] = matches;
    return {
      providerShipmentId: String(match.id),
      trackingNumber: match.tracking_number ?? null,
    };
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
