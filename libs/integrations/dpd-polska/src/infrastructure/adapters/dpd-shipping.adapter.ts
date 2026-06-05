/**
 * DPD Polska Shipping Adapter
 *
 * Implements the core `ShippingProviderManagerPort` plus the
 * `LabelDocumentReader` and `PickupPointFinder` (#963 — DPD Pickup) sub-
 * capabilities against the DPDServices REST API. Thin orchestration only: it
 * delegates wire translation to `dpd-shipment.mapper` and HTTP/retry/error-
 * mapping to `IDpdHttpClient`.
 *
 * Two-call flow: `generatePackagesNumbers` (create → waybill) then
 * `generateSpedLabels` (render → PDF) on demand. Business validation failures
 * arrive as HTTP 200 with a non-OK body status, so `generateLabel` asserts all
 * three status levels before trusting the waybill.
 *
 * Class name is deliberately shortened from the `{Platform}{Capability}Adapter`
 * rule's `DpdShippingProviderManagerAdapter` (matches the InPost #764 shipping
 * vocabulary).
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/adapters
 */
import {
  ShippingProviderRejectionException,
  type DispatchProtocolReader,
  type FindPickupPointsQuery,
  type GenerateLabelCommand,
  type GenerateLabelResult,
  type LabelDocument,
  type LabelDocumentReader,
  type PickupPoint,
  type PickupPointFinder,
  type ShippingMethod,
  type ShippingProviderManagerPort,
  type TrackingSnapshot,
} from '@openlinker/core/shipping';
import type { DpdConnectionConfig } from '../../domain/types/dpd-config.types';
import type {
  DpdGeneratePackagesNumbersResponse,
  DpdGenerateProtocolResponse,
  DpdGenerateSpedLabelsResponse,
  DpdPointSearchResponse,
} from '../../domain/types/dpd-rest.types';
import type { IDpdHttpClient } from '../http/dpd-http-client.interface';
import {
  assertCreateSucceededAndExtractWaybill,
  buildCreatePackagesRequest,
  buildGenerateLabelRequest,
  buildGenerateProtocolRequest,
  buildPointSearchQuery,
  decodeLabelDocument,
  decodeProtocolDocument,
  toGenerateLabelResult,
  toPickupPoint,
} from '../mappers/dpd-shipment.mapper';

const SUPPORTED_METHODS: readonly ShippingMethod[] = ['kurier', 'pickup'];

const CREATE_PATH = '/public/shipment/v1/generatePackagesNumbers';
const LABEL_PATH = '/public/shipment/v1/generateSpedLabels';
// OQ-1 (#964 plan): exact protocol path/request/response confirmed against the
// live Swagger in the Phase-0 spike; isolated here + in the mapper/types.
const PROTOCOL_PATH = '/public/shipment/v1/generateProtocol';
// OQ-1 (#963 plan): exact point-directory path/method/auth confirmed against the
// live Swagger in the Phase-0 spike. DPDServices is POST-heavy (findPostalCode-
// style), so v1 POSTs the query body; isolated here + in the mapper.
const POINT_SEARCH_PATH = '/public/appservices/v1/findPoints';

export class DpdShippingAdapter
  implements
    ShippingProviderManagerPort,
    LabelDocumentReader,
    PickupPointFinder,
    DispatchProtocolReader
{
  constructor(
    private readonly http: IDpdHttpClient,
    private readonly config: DpdConnectionConfig,
  ) {}

  getSupportedMethods(): readonly ShippingMethod[] {
    return SUPPORTED_METHODS;
  }

  async generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult> {
    const body = buildCreatePackagesRequest(cmd, this.config);
    // Non-idempotent create: the client does NOT retry on network/timeout
    // (no DPD idempotency key → double waybill + double COD).
    const response = await this.http.request<DpdGeneratePackagesNumbersResponse>({
      method: 'POST',
      path: CREATE_PATH,
      body,
    });
    const waybill = assertCreateSucceededAndExtractWaybill(response);
    return toGenerateLabelResult(waybill);
  }

  async fetchLabel(input: { providerShipmentId: string }): Promise<LabelDocument> {
    const body = buildGenerateLabelRequest(input.providerShipmentId);
    // Idempotent render (returns the PDF for an existing waybill) — safe to
    // retry on network/timeout.
    const response = await this.http.request<DpdGenerateSpedLabelsResponse>({
      method: 'POST',
      path: LABEL_PATH,
      body,
      idempotent: true,
    });
    return decodeLabelDocument(response);
  }

  async generateProtocol(input: { providerShipmentIds: string[] }): Promise<LabelDocument> {
    const body = buildGenerateProtocolRequest(input.providerShipmentIds);
    // Idempotent render of the handover manifest over existing waybills — safe
    // to retry on network/timeout (no side effect at the carrier).
    const response = await this.http.request<DpdGenerateProtocolResponse>({
      method: 'POST',
      path: PROTOCOL_PATH,
      body,
      idempotent: true,
    });
    return decodeProtocolDocument(response);
  }

  async findPickupPoints(query: FindPickupPointsQuery): Promise<PickupPoint[]> {
    // Idempotent read of the DPD Pickup point directory (#963).
    const response = await this.http.request<DpdPointSearchResponse>({
      method: 'POST',
      path: POINT_SEARCH_PATH,
      body: buildPointSearchQuery(query),
      idempotent: true,
    });
    return (response.points ?? []).map(toPickupPoint);
  }

  getTracking(_input: { providerShipmentId: string }): Promise<TrackingSnapshot> {
    // DPD tracking is a separate service (DPD InfoServices, #965). Until then
    // we throw rather than fabricate a status — the adapter receives only the
    // waybill, so any returned status would be a lie. The #838 status-sync
    // poller catches this and logs a warn (no crash); DPD should stay out of
    // that scan until #965 wires real tracking.
    return Promise.reject(
      new ShippingProviderRejectionException(
        'dpd',
        'tracking.unavailable',
        'DPD tracking is not available until DPD InfoServices is wired (#965)',
      ),
    );
  }
}
