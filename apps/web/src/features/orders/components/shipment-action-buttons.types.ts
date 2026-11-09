/**
 * Shipment action buttons types (#769, #1905)
 *
 * The Generate-label block vocabulary, the gate's input and the copy the
 * action row reads, kept apart from the component in
 * `shipment-action-buttons.tsx`.
 *
 * @module apps/web/src/features/orders/components
 */
import type { Shipment } from '../../shipments';
import type { Messages, ResolvedCopy } from '../../../shared/i18n';

/** Why "Generate label" is unavailable right now. */
export type GenerateLabelBlock = 'permission' | 'state' | 'post-waybill' | 'route' | 'payment';

/** The `orders.shipmentActionButtons` copy, in the active language. */
export type ShipmentActionButtonsCopy = ResolvedCopy<Messages['orders']>['shipmentActionButtons'];

export interface GenerateLabelBlockInput {
  /** `null` ⇒ no shipment row yet (the first-label case). */
  shipment: Shipment | null;
  canWrite: boolean;
  paymentBlocksDispatch: boolean;
  routeUnavailable: boolean;
}
