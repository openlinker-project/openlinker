/**
 * Shipment Action Buttons (#769)
 *
 * Status-gated action row for the order-detail Shipment panel. Computes
 * per-button enablement from `Shipment.status` (per plan §3.4 matrix), and
 * wraps destructive / override actions in `<ConfirmDialog>`. Generate Label
 * uses inline expansion (signalled to the parent via `onGenerateLabelClick`),
 * NOT a Dialog — it's a forward CTA, not a destructive confirmation.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';
import {
  useCancelShipmentMutation,
  useNotifyDispatchedMutation,
  type Shipment,
  type ShipmentStatus,
} from '../../shipments';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { getCarrierDisplayName } from '../../shipments';

interface ShipmentActionButtonsProps {
  /** Current active shipment row; `null` when the order has no shipment yet. */
  shipment: Shipment | null;
  /** Fired when operator clicks Generate Label. Parent toggles the inline
   * expansion of `<GenerateLabelForm>`. */
  onGenerateLabelClick: () => void;
}

const CAN_GENERATE: ReadonlySet<ShipmentStatus | 'none'> = new Set([
  'none',
  'draft',
  'delivered',
  'failed',
  'cancelled',
]);

const CAN_CANCEL: ReadonlySet<ShipmentStatus> = new Set(['generated']);
const CAN_NOTIFY_DISPATCHED: ReadonlySet<ShipmentStatus> = new Set(['generated']);

export function ShipmentActionButtons({
  shipment,
  onGenerateLabelClick,
}: ShipmentActionButtonsProps): ReactElement {
  const cancelMutation = useCancelShipmentMutation();
  const notifyMutation = useNotifyDispatchedMutation();

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);

  // Treat "no shipment row" as a synthetic 'none' status for the matrix.
  const status: ShipmentStatus | 'none' = shipment?.status ?? 'none';
  const canGenerate = CAN_GENERATE.has(status);
  const canCancel = shipment !== null && CAN_CANCEL.has(shipment.status);
  const canNotify = shipment !== null && CAN_NOTIFY_DISPATCHED.has(shipment.status);

  const carrierName = getCarrierDisplayName(shipment?.carrier ?? null) ?? 'the carrier';

  return (
    <>
      <div className="shipment-action-buttons">
        <Button
          tone="primary"
          className="button--sm"
          onClick={onGenerateLabelClick}
          disabled={!canGenerate}
          aria-label={
            canGenerate ? 'Generate shipping label' : 'Generate label not available in this state'
          }
        >
          Generate label
        </Button>
        <Button
          tone="danger"
          className="button--sm"
          onClick={() => setCancelDialogOpen(true)}
          disabled={!canCancel || cancelMutation.isPending}
        >
          Cancel
        </Button>
        <Button
          tone="secondary"
          className="button--sm"
          onClick={() => setNotifyDialogOpen(true)}
          disabled={!canNotify || notifyMutation.isPending}
        >
          Mark dispatched
        </Button>
      </div>

      {shipment ? (
        <>
          <ConfirmDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            title="Cancel this shipment?"
            description={
              <>
                The label will be voided with {carrierName}. This cannot be undone — to ship
                this order again you&apos;ll need to generate a new label.
              </>
            }
            confirmLabel={cancelMutation.isPending ? 'Cancelling…' : 'Cancel shipment'}
            cancelLabel="Keep"
            tone="danger"
            isConfirming={cancelMutation.isPending}
            onConfirm={() => {
              cancelMutation.mutate(shipment.id, {
                onSuccess: () => setCancelDialogOpen(false),
              });
            }}
          />
          <ConfirmDialog
            open={notifyDialogOpen}
            onOpenChange={setNotifyDialogOpen}
            title="Manually mark as dispatched?"
            description={
              <>
                This fires the source-marketplace notification and updates the destination
                fulfillment state. Use this only when the automatic dispatch flow has stalled —
                the normal path is automatic via the carrier&apos;s status sync.
              </>
            }
            confirmLabel={notifyMutation.isPending ? 'Notifying…' : 'Mark dispatched'}
            cancelLabel="Cancel"
            tone="default"
            isConfirming={notifyMutation.isPending}
            onConfirm={() => {
              notifyMutation.mutate(shipment.id, {
                onSuccess: () => setNotifyDialogOpen(false),
              });
            }}
          />
        </>
      ) : null}
    </>
  );
}
