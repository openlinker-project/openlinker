/**
 * Shipment Action Buttons (#769)
 *
 * Status-gated action row for the order-detail Shipment panel. Computes
 * per-button enablement from `Shipment.status` (per plan §3.4 matrix), and
 * wraps destructive / override actions in `<ConfirmDialog>`. Generate Label
 * uses inline expansion (signalled to the parent via `onGenerateLabelClick`),
 * NOT a Dialog — it's a forward CTA, not a destructive confirmation.
 *
 * Generate/Regenerate eligibility is NOT computed here: it comes from the
 * shared `canRegenerateLabel` (`features/shipments/lib`), the same predicate
 * the `/shipments` row accordion renders its Regenerate link from, so the two
 * surfaces can never disagree about whether a retry is offered (#1826/#1905).
 * This file owns only the operator-facing *reason* it is unavailable.
 *
 * @module apps/web/src/features/orders/components
 */
import { useState, type ReactElement } from 'react';
import {
  useCancelShipmentMutation,
  useNotifyDispatchedMutation,
  useLabelDownload,
  resolveLabelDownloadError,
  getCarrierDisplayName,
  canRegenerateLabel,
  CAN_GENERATE,
  CAN_CANCEL,
  CAN_NOTIFY_DISPATCHED,
  CAN_DOWNLOAD_LABEL,
  cancelShipmentCopy,
  CancelShipmentErrorAlert,
  classifyCancelShipmentError,
  canRetryCancelShipment,
  type Shipment,
} from '../../shipments';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { useToast } from '../../../shared/ui/toast-provider';
import type { PaymentStatus } from '../api/order-snapshot.schema';
import type {
  GenerateLabelBlock,
  GenerateLabelBlockInput,
  ShipmentActionButtonsCopy,
} from './shipment-action-buttons.types';

interface ShipmentActionButtonsProps {
  /** Current active shipment row; `null` when the order has no shipment yet. */
  shipment: Shipment | null;
  /**
   * `usePermission('shipments:write')` (#1905). Every write-shaped action
   * (Generate / Cancel / Mark dispatched) renders disabled without it, so this
   * row and the `/shipments` accordion agree about who may act; `Download
   * label` is read-only and stays available. The POST is server-gated anyway —
   * this is consistency, not the authorization boundary.
   */
  canWrite: boolean;
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

/**
 * Payment statuses that BLOCK dispatch (#928). Block-list polarity, not
 * allow-list: only these explicitly block. `paid`, `cod`, `undefined` (payment
 * unknown — PrestaShop / legacy orders), and any future union member the FE
 * doesn't yet handle all permit dispatch, so a new backend value never silently
 * blocks shipping until the FE consciously adds it here.
 *
 * Exported (#1826) — also consumed by `OrderShipmentPanel`'s deep-link
 * auto-open guard, which must apply the same payment gate this button does
 * rather than opening the form unconditionally.
 */
export const PAYMENT_BLOCKS_DISPATCH: ReadonlySet<PaymentStatus> = new Set([
  'awaiting',
  'refunded',
]);

const BLOCK_REASON_KEY = {
  permission: 'permission',
  state: 'state',
  'post-waybill': 'postWaybill',
  route: 'route',
  payment: 'payment',
} as const satisfies Record<GenerateLabelBlock, keyof ShipmentActionButtonsCopy['blockReason']>;

/**
 * Operator-facing sentence per block reason (#1905).
 *
 * Doubles as the disabled button's `aria-label` + `title` AND as the text of
 * the order-detail panel's deep-link explanation Alert, so an ineligible
 * `?retryShipmentId=` landing tells the operator the same thing the greyed
 * button does instead of silently doing nothing.
 */
export function generateLabelBlockReason(
  block: GenerateLabelBlock,
  copy: ShipmentActionButtonsCopy
): string {
  return copy.blockReason[BLOCK_REASON_KEY[block]];
}

/**
 * Single decision point for the Generate-label gate: `null` ⇒ allowed.
 *
 * Shared with `OrderShipmentPanel`'s deep-link auto-open so the form can never
 * open behind a button that refuses the same action (#1826/#1905).
 */
export function resolveGenerateLabelBlock({
  shipment,
  canWrite,
  paymentBlocksDispatch,
  routeUnavailable,
}: GenerateLabelBlockInput): GenerateLabelBlock | null {
  if (!canWrite) return 'permission';
  if (shipment !== null && !canRegenerateLabel(shipment, canWrite)) {
    // The shared predicate returns one boolean for two distinct situations.
    // Split them apart for the message: a generate-able status that was still
    // refused can only have been refused for holding a live waybill, and that
    // one IS recoverable (cancel, then regenerate) — worth saying out loud.
    return CAN_GENERATE.has(shipment.status) ? 'post-waybill' : 'state';
  }
  // A shipment already past the regenerate-able states reports its state
  // first; the route / payment reason is irrelevant once a label exists.
  if (routeUnavailable) return 'route';
  if (paymentBlocksDispatch) return 'payment';
  return null;
}

export function ShipmentActionButtons({
  shipment,
  canWrite,
  paymentStatus,
  onGenerateLabelClick,
  routeUnavailable = false,
}: ShipmentActionButtonsProps): ReactElement {
  const copy = useMessages('orders').shipmentActionButtons;
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
        <span className="text-muted">{copy.fulfilledByDestination}</span>
      </div>
    );
  }

  // #928 — payment gate (block-list): only awaiting/refunded block dispatch.
  const paymentBlocksDispatch =
    paymentStatus !== undefined && PAYMENT_BLOCKS_DISPATCH.has(paymentStatus);
  const generateBlock = resolveGenerateLabelBlock({
    shipment,
    canWrite,
    paymentBlocksDispatch,
    routeUnavailable,
  });
  const canGenerate = generateBlock === null;
  const canCancel = canWrite && shipment !== null && CAN_CANCEL.has(shipment.status);
  const canNotify = canWrite && shipment !== null && CAN_NOTIFY_DISPATCHED.has(shipment.status);
  // Label download needs both a retrievable lifecycle state AND a persisted
  // label ref (the "a label was generated" marker).
  const canDownloadLabel =
    shipment !== null && shipment.labelPdfRef !== null && CAN_DOWNLOAD_LABEL.has(shipment.status);

  const handleDownloadLabel = (): void => {
    if (!shipment) return;
    void labelDownload.download(shipment.id).then((result) => {
      if (!result.ok) {
        const mapped = resolveLabelDownloadError(result.error);
        showToast({ tone: mapped.tone, title: mapped.title, description: mapped.description });
      }
    });
  };

  const carrierName = getCarrierDisplayName(shipment?.carrier ?? null) ?? copy.carrierFallback;
  const blockReason =
    generateBlock === null ? undefined : generateLabelBlockReason(generateBlock, copy);
  const cancelCopy = cancelShipmentCopy(shipment?.status ?? 'draft', carrierName);

  return (
    <>
      <div className="shipment-action-buttons">
        <Button
          tone="primary"
          className="button--sm"
          onClick={onGenerateLabelClick}
          disabled={!canGenerate}
          aria-label={blockReason ?? copy.generateAria}
          // `title` as well as `aria-label` (#1905): a sighted mouse user
          // otherwise sees a greyed button with no reason anywhere on screen.
          title={blockReason}
        >
          {copy.generate}
        </Button>
        <Button
          tone="danger"
          className="button--sm"
          onClick={() => setCancelDialogOpen(true)}
          disabled={!canCancel || cancelMutation.isPending}
        >
          {copy.cancel}
        </Button>
        <Button
          tone="secondary"
          className="button--sm"
          onClick={() => setNotifyDialogOpen(true)}
          disabled={!canNotify || notifyMutation.isPending}
        >
          {copy.markDispatched}
        </Button>
        <Button
          tone="secondary"
          className="button--sm"
          onClick={handleDownloadLabel}
          disabled={!canDownloadLabel || labelDownload.isDownloading}
          aria-label={canDownloadLabel ? copy.downloadAria : copy.downloadUnavailable}
        >
          {labelDownload.isDownloading ? copy.downloading : copy.download}
        </Button>
      </div>

      {shipment ? (
        <>
          <ConfirmDialog
            open={cancelDialogOpen}
            onOpenChange={(open) => {
              setCancelDialogOpen(open);
              // A failure belongs to one attempt: reopening starts clean.
              if (!open) cancelMutation.reset();
            }}
            title={copy.cancelDialog.title}
            description={
              <>
                {cancelCopy.effect}
                {cancelCopy.alsoOutstanding ? (
                  <>
                    {' '}
                    <strong>{cancelCopy.alsoOutstanding}</strong>
                  </>
                ) : null}
              </>
            }
            body={
              cancelMutation.isError ? (
                <CancelShipmentErrorAlert error={cancelMutation.error} />
              ) : undefined
            }
            confirmLabel={
              cancelMutation.isPending ? copy.cancelDialog.confirming : copy.cancelDialog.confirm
            }
            cancelLabel={copy.cancelDialog.keep}
            tone="danger"
            isConfirming={cancelMutation.isPending}
            confirmDisabled={
              cancelMutation.isError &&
              !canRetryCancelShipment(classifyCancelShipmentError(cancelMutation.error))
            }
            onConfirm={() => {
              cancelMutation.mutate(shipment.id, {
                onSuccess: () => setCancelDialogOpen(false),
              });
            }}
          />
          <ConfirmDialog
            open={notifyDialogOpen}
            onOpenChange={setNotifyDialogOpen}
            title={copy.notifyDialog.title}
            description={copy.notifyDialog.description}
            confirmLabel={
              notifyMutation.isPending ? copy.notifyDialog.confirming : copy.notifyDialog.confirm
            }
            cancelLabel={copy.notifyDialog.cancel}
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
