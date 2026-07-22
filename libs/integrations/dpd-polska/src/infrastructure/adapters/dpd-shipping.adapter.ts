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
import type {
  DispatchProtocolReader,
  FindPickupPointsQuery,
  GenerateLabelCommand,
  GenerateLabelResult,
  LabelDocument,
  LabelDocumentReader,
  PickupPoint,
  PickupPointFinder,
  ShippingMethod,
  ShippingProviderManagerPort,
  TrackingSnapshot,
} from '@openlinker/core/shipping';
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';
import type { DpdConnectionConfig } from '../../domain/types/dpd-config.types';
import type {
  DpdGeneratePackagesNumbersResponse,
  DpdGenerateProtocolResponse,
  DpdGenerateSpedLabelsResponse,
  DpdPointSearchResponse,
} from '../../domain/types/dpd-rest.types';
import type { IDpdHttpClient } from '../http/dpd-http-client.interface';
import type { IDpdInfoSoapClient } from '../http/dpd-info-soap-client.interface';
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
import { toTrackingSnapshot } from '../mappers/dpd-tracking.mapper';

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
  private readonly logger = new Logger(DpdShippingAdapter.name);

  constructor(
    private readonly http: IDpdHttpClient,
    private readonly config: DpdConnectionConfig,
    private readonly infoClient: IDpdInfoSoapClient,
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
    const waybill = this.assertResponseOk('create', response, () =>
      assertCreateSucceededAndExtractWaybill(response),
    );
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
    return this.assertResponseOk('label', response, () => decodeLabelDocument(response));
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
    return this.assertResponseOk('protocol', response, () => decodeProtocolDocument(response));
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

  async getTracking(input: { providerShipmentId: string }): Promise<TrackingSnapshot> {
    // DPD tracking lives in the separate SOAP DPDInfoServices service (#965 /
    // ADR-022): read the waybill's full event history, then fold it into the
    // neutral snapshot (terminal-precedence + offset-less-timestamp handling in
    // the mapper). `providerShipmentId` is the DPD waybill.
    const events = await this.infoClient.getEventsForWaybill({
      waybill: input.providerShipmentId,
    });
    return toTrackingSnapshot(events);
  }

  /**
   * Run a mapper assert/decode over a create/label/protocol response and, on a
   * rejection, log the FULL raw DPD response body at warn keyed by DPD's
   * `traceId` before rethrowing (#1777).
   *
   * DPD surfaces business rejections as HTTP 200 with a non-OK body status and
   * sometimes only `info: "NOT_PROCESSED"` with no field-level `errorCode`, so
   * the operator otherwise sees `NOT_PROCESSED` / `providerCode: null` with no
   * recoverable cause. The raw body carries no secrets (it's a status +
   * validation-info envelope, never credentials or the echoed request), so
   * logging it in full is safe, and `traceId` is the handle DPD support keys on.
   * (One caveat: a rejection `validationInfo` can echo an order-derived value
   * such as a receiver postcode — buyer-PII-adjacent. The FULL raw body logged
   * here stays in WARN logs only; the already-mapped `validationInfo` may
   * separately reach `providerDetails` → the 502 body via the pre-existing #1104
   * path, but this WARN log adds no exposure beyond what #1104 already surfaces.)
   * The rethrown exception is enriched with `providerDetails.traceId` so the
   * operator can quote it without a log dive.
   */
  private assertResponseOk<T>(
    operation: string,
    response: { readonly status: string; readonly traceId?: string },
    assert: () => T,
  ): T {
    try {
      return assert();
    } catch (error) {
      if (error instanceof ShippingProviderRejectionException) {
        this.logger.warn(
          `DPD ${operation} rejected (status=${response.status}) [traceId=${response.traceId ?? 'none'}]; raw response: ${JSON.stringify(response)}`,
        );
        throw response.traceId ? withTraceId(error, response.traceId) : error;
      }
      throw error;
    }
  }
}

/** Return a copy of the rejection with DPD's `traceId` merged into `providerDetails`. */
function withTraceId(
  error: ShippingProviderRejectionException,
  traceId: string,
): ShippingProviderRejectionException {
  const enriched = new ShippingProviderRejectionException(
    error.providerName,
    error.providerCode,
    error.message,
    { ...(error.providerDetails ?? {}), traceId },
  );
  // Preserve the original throw site (the mapper assert) rather than the stack
  // captured here, so triage points at where the rejection actually originated.
  if (error.stack) {
    enriched.stack = error.stack;
  }
  return enriched;
}
