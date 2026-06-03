/**
 * DPD Polska Shipping Adapter
 *
 * Implements the core `ShippingProviderManagerPort` plus the
 * `LabelDocumentReader` sub-capability against the DPDServices REST API. Thin
 * orchestration only: it delegates wire translation to `dpd-shipment.mapper`
 * and HTTP/retry/error-mapping to `IDpdHttpClient`.
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
  type GenerateLabelCommand,
  type GenerateLabelResult,
  type LabelDocument,
  type LabelDocumentReader,
  type ShippingMethod,
  type ShippingProviderManagerPort,
  type TrackingSnapshot,
} from '@openlinker/core/shipping';
import type { DpdConnectionConfig } from '../../domain/types/dpd-config.types';
import type {
  DpdGeneratePackagesNumbersResponse,
  DpdGenerateSpedLabelsResponse,
} from '../../domain/types/dpd-rest.types';
import type { IDpdHttpClient } from '../http/dpd-http-client.interface';
import {
  assertCreateSucceededAndExtractWaybill,
  buildCreatePackagesRequest,
  buildGenerateLabelRequest,
  decodeLabelDocument,
  toGenerateLabelResult,
} from '../mappers/dpd-shipment.mapper';

const SUPPORTED_METHODS: readonly ShippingMethod[] = ['kurier'];

const CREATE_PATH = '/public/shipment/v1/generatePackagesNumbers';
const LABEL_PATH = '/public/shipment/v1/generateSpedLabels';

export class DpdShippingAdapter implements ShippingProviderManagerPort, LabelDocumentReader {
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
