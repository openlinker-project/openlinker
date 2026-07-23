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
  useLabelDownload,
  type Shipment,
  type ShipmentStatus,
} from '../../shipments';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { useToast } from '../../../shared/ui/toast-provider';
import { getCarrierDisplayName } from '../../shipments';
import type { PaymentStatus } from '../api/order-snapshot.schema';

interface ShipmentActionButtonsProps {
  /** Current active shipment row; `null` when the order has no shipment yet. */
  shipment: Shipment | null;
  /**
   * Source-reported payment status (#928). Blocks Generate-label when the order
   * isn't dispatchable yet (awaiting/refunded). Absent ⇒ payment unknown
   * (PrestaShop / legacy orders) ⇒ does not block.
   */
  paymentStatus?: PaymentStatus;
  /** Fired when operator clicks Generate Label. Parent toggles the inline
   * expansion of `<GenerateLabelForm>`. */
  onGenerateLabelClick: () => void;
  /**
   * The order's delivery method routes to a disabled carrier connection (#1799).
   * Blocks Generate-label the same way an un-dispatchable payment does — the
   * route is a dead end until the carrier is re-enabled. Defaults to false.
   */
  routeUnavailable?: boolean;
}

const CAN_GENERATE: ReadonlySet<ShipmentStatus | 'none'> = new Set([
  'none',
  'draft',
  'delivered',
  'failed',
  'cancelled',
]);

/**
 * Payment statuses that BLOCK dispatch (#928). Block-list polarity, not
 * allow-list: only these explicitly block. `paid`, `cod`, `undefined` (payment
 * unknown — PrestaShop / legacy orders), and any future union member the FE
 * doesn't yet handle all permit dispatch, so a new backend value never silently
 * blocks shipping until the FE consciously adds it here.
 */
const PAYMENT_BLOCKS_DISPATCH: ReadonlySet<PaymentStatus> = new Set(['awaiting', 'refunded']);

const CAN_CANCEL: ReadonlySet<ShipmentStatus> = new Set(['generated']);
const CAN_NOTIFY_DISPATCHED: ReadonlySet<ShipmentStatus> = new Set(['generated']);
// A label document exists once the shipment is generated and stays retrievable
// through the carrier-tracked lifecycle; cancelled/failed/draft have none.
const CAN_DOWNLOAD_LABEL: ReadonlySet<ShipmentStatus> = new Set([
  'generated',
  'dispatched',
  'in-transit',
  'delivered',
]);

export function ShipmentActionButtons({
  shipment,
  paymentStatus,
  onGenerateLabelClick,
  routeUnavailable = false,
}: ShipmentActionButtonsProps): ReactElement {
  const cancelMutation = useCancelShipmentMutation();
  const notifyMutation = useNotifyDispatchedMutation();
  const labelDownload = useLabelDownload();
  const { showToast } = useToast();

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);

  // Branch-1 awareness (#839 AC-6) — `shippingMethod === 'omp'` rows are
  // projection-only: the destination OMP ships externally, OL holds no
  // provider id, and `ShipmentDispatchService.dispatch` would resolve to
  // `{ kind: 'omp_fulfilled' }` (a no-op). None of the three actions
  // (Generate label / Cancel / Mark dispatched) is meaningful here.
  // Render a single read-only chip so the operator sees the row is
  // handled externally, then early-return.
  if (shipment !== null && shipment.shippingMethod === 'omp') {
    return (
      <div className="shipment-action-buttons">
        <span className="text-muted">Fulfilled by destination</span>
      </div>
    );
  }

  // Treat "no shipment row" as a synthetic 'none' status for the matrix.
  const status: ShipmentStatus | 'none' = shipment?.status ?? 'none';
  // #928 — payment gate (block-list): only awaiting/refunded block dispatch.
  const paymentBlocksDispatch =
    paymentStatus !== undefined && PAYMENT_BLOCKS_DISPATCH.has(paymentStatus);
  const canGenerate = CAN_GENERATE.has(status) && !paymentBlocksDispatch && !routeUnavailable;
  const canCancel = shipment !== null && CAN_CANCEL.has(shipment.status);
  const canNotify = shipment !== null && CAN_NOTIFY_DISPATCHED.has(shipment.status);
  // Label download needs both a retrievable lifecycle state AND a persisted
  // label ref (the "a label was generated" marker).
  const canDownloadLabel =
    shipment !== null &&
    shipment.labelPdfRef !== null &&
    CAN_DOWNLOAD_LABEL.has(shipment.status);

  const handleDownloadLabel = (): void => {
    if (!shipment) return;
    void labelDownload.download(shipment.id).then((ok) => {
      if (!ok) {
        showToast({ tone: 'error', description: 'Could not download the label. Try again.' });
      }
    });
  };

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
            canGenerate
              ? 'Generate shipping label'
              : // A shipment already past the regenerate-able states (e.g. label
                // generated / dispatched) reports its state first - the route
                // reason is irrelevant once a label exists.
                !CAN_GENERATE.has(status)
                ? 'Generate label not available in this state'
                : routeUnavailable
                  ? "Routed carrier isn't available to dispatch - resolve delivery routing first."
                  : paymentBlocksDispatch
                    ? "Awaiting payment — can't dispatch yet"
                    : 'Generate label not available in this state'
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
        <Button
          tone="secondary"
          className="button--sm"
          onClick={handleDownloadLabel}
          disabled={!canDownloadLabel || labelDownload.isDownloading}
          aria-label={
            canDownloadLabel
              ? 'Download shipping label'
              : 'Download label not available in this state'
          }
        >
          {labelDownload.isDownloading ? 'Downloading…' : 'Download label'}
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
