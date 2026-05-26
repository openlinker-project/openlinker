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
} from './api/shipments.types';
export { useShipmentsQuery } from './hooks/use-shipments-query';
export { ShipmentStatusBadge } from './components/shipment-status-badge';
