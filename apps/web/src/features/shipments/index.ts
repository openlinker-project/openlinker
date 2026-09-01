/**
 * Shipments — public surface
 *
 * Public barrel for the shipments feature (#770). Cross-feature / cross-plugin
 * consumers import only from here. Kept minimal — the `/shipments` page is the
 * only consumer today, and pages may deep-import feature internals, so nothing
 * external needs these yet. Exports are listed so a future consumer (e.g. an
 * order-detail shipment summary) has a stable seam.
 */
export type {
  Shipment,
  ShipmentFilters,
  ShipmentStatus,
  ShippingMethod,
  PaginatedShipments,
  DispatchResult,
  GenerateLabelInput,
  NotifyDispatchedResult,
  KnownCarrier,
  BulkDispatchItem,
  BulkGenerateLabelsInput,
  BulkDispatchResult,
  PerOrderDispatchResult,
} from './api/shipments.types';
export {
  KNOWN_CARRIER_VALUES,
  SHIPPING_METHOD_LABEL,
  SHIPPING_METHOD_VALUES,
  SHIPMENT_STATUS_VALUES,
  DELIVERY_INTENT_LABEL,
  BULK_DISPATCH_MAX_ITEMS,
  REDACTED_ERROR_MESSAGE,
} from './api/shipments.types';
export {
  PROCESSOR_FILTER_VALUES,
  PROCESSOR_KIND_VALUES,
  PROCESSOR_KIND_LABEL,
  deriveProcessor,
  parseProcessorFilter,
  toShipmentProcessorFilters,
} from './lib/processor';
export type { ProcessorFilter, ProcessorKind } from './lib/processor';
export { ProcessorBadge } from './components/processor-badge';
export { useShipmentsQuery } from './hooks/use-shipments-query';
export { useOrderShipmentsQuery } from './hooks/use-order-shipments-query';
export { useGenerateLabelMutation } from './hooks/use-generate-label-mutation';
export { useCancelShipmentMutation } from './hooks/use-cancel-shipment-mutation';
export { useNotifyDispatchedMutation } from './hooks/use-notify-dispatched-mutation';
export { useLabelDownload } from './hooks/use-label-download';
export type { LabelDownloadResult } from './hooks/use-label-download';
export { resolveLabelDownloadError } from './lib/label-download-error';
export type { LabelDownloadError } from './lib/label-download-error';
export { useBulkGenerateLabelsMutation } from './hooks/use-bulk-generate-labels-mutation';
export { useProtocolDownload } from './hooks/use-protocol-download';
export { ShipmentStatusBadge } from './components/shipment-status-badge';
export { buildCarrierTrackingUrl, getCarrierDisplayName } from './lib/carrier-tracking-url';
export { pickActiveShipment } from './lib/pick-active-shipment';
export { extractShippingFieldErrors } from './lib/extract-shipping-field-errors';
export { extractShippingTraceId } from './lib/extract-shipping-trace-id';
export {
  CAN_GENERATE,
  CAN_CANCEL,
  CAN_NOTIFY_DISPATCHED,
  CAN_DOWNLOAD_LABEL,
  isPreWaybill,
  canRegenerateLabel,
} from './lib/shipment-action-eligibility';
export { deriveSeverityLabel } from './lib/shipment-severity';
export type { ShipmentSeverity } from './lib/shipment-severity';
export { ShipmentSeverityLabel } from './components/shipment-severity-label';
