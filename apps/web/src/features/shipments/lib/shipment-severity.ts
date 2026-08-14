/**
 * Shipment Severity (#1826)
 *
 * Pure view-model helpers for the `/shipments` Action column. The order-id
 * truncation that shared this file was an alias of `shortenId` and went with the
 * hand-rolled Order cell it served (#2089).
 * They started life inline in `pages/shipments/shipments-page.tsx`; they are
 * pure functions of a `Shipment` with no React or router dependency, so they
 * belong in the owning feature's `lib` where they can be unit-tested directly
 * and reused by the mobile card summary and the row accordion alike.
 *
 * @module apps/web/src/features/shipments/lib
 */
import type { Shipment } from '../api/shipments.types';
import { isPreWaybill } from './shipment-action-eligibility';

export type ShipmentSeverity = 'Fix' | 'Finish' | 'Send' | 'View';

/**
 * Plain, non-interactive per-row severity for the Action column (#1826) —
 * riding alongside the real control (`DataTable`'s `expandable` toggle), not
 * a second clickable affordance. `Fix` (an actionable carrier rejection),
 * `Finish` (draft/cancelled — the same "regenerate" bucket the accordion's
 * `CAN_GENERATE` groups them under), `Send` (generated — a label exists,
 * dispatch is the next step), `View` (nothing actionable, just status).
 *
 * `canWrite === false` collapses every status to `View`: telling a viewer to
 * "Fix" something they hold no permission to touch is a dead end, and the row
 * accordion renders no write affordance for them either.
 *
 * `omp`/branch-1 rows always read `View` regardless of status: they carry no
 * OL dispatch action ever (see `ShipmentRowDetail`'s branch-1 early return),
 * so `Finish` (which implies a Generate-label action) would be misleading
 * for an `omp` row sitting at `cancelled`.
 *
 * `Blocked` (payment-gated) is intentionally NOT derived here — it needs the
 * order's payment status, which `/shipments` rows don't carry (no
 * order-snapshot join), and fetching every row's parent order just to
 * pre-compute this label would be the same unjustified N+1
 * `ShipmentRowDetail`'s own payment-gate note already rules out for the
 * identical reason. A payment-blocked retry still can't go live — the
 * deep-linked order-detail page's `<ShipmentActionButtons>` enforces that
 * gate — this row just can't label it "Blocked" in advance.
 */
export function deriveSeverityLabel(shipment: Shipment, canWrite: boolean): ShipmentSeverity {
  if (!canWrite) return 'View';
  if (shipment.shippingMethod === 'omp') return 'View';
  switch (shipment.status) {
    case 'failed':
      // A status-sync-derived failure (`returned_to_sender` and its six
      // siblings) persists no `errorMessage` and still holds a live waybill:
      // there is no rejection to diagnose and regenerating would buy a second
      // label, so it reads `View` (the tracker is the next stop). A `failed`
      // row with no message but no waybill either genuinely just needs another
      // dispatch attempt — `Finish`, same as draft.
      if (shipment.errorMessage) return 'Fix';
      return isPreWaybill(shipment) ? 'Finish' : 'View';
    case 'draft':
    case 'cancelled':
      return 'Finish';
    case 'generated':
      return 'Send';
    case 'dispatched':
    case 'in-transit':
    case 'delivered':
      return 'View';
  }
}
