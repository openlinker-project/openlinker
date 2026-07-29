/**
 * Shipment Row Detail (#1826)
 *
 * Accordion body for a `/shipments` row, opened via `DataTable`'s `expandable`
 * leading toggle. Carries the failure detail (or the viewer's redacted
 * placeholder) plus the recovery action, mirroring the order-detail action
 * matrix so both surfaces stay in lockstep — status-eligibility is derived
 * from the same `CAN_GENERATE`/`CAN_CANCEL`/`CAN_NOTIFY_DISPATCHED`/
 * `CAN_DOWNLOAD_LABEL` sets (`../lib/shipment-action-eligibility.ts`, shared
 * with `<ShipmentActionButtons>`), not a second, driftable copy.
 *
 * Payment-gate note: unlike the order-detail panel, this component has no
 * `paymentStatus` in scope (`/shipments` rows carry no order-snapshot data,
 * and fetching every failed row's parent order just to pre-compute the gate
 * would be an unjustified N+1). Regenerate/Generate is always a plain
 * deep-link here; `OrderShipmentPanel`'s deep-link auto-open applies the same
 * payment/route gate `<ShipmentActionButtons>` does before opening the form
 * (see its own header comment), so a payment-blocked or route-unavailable
 * retry lands on the disabled button instead of a live form.
 *
 * `canWrite` gates only the write-shaped actions (Generate/Regenerate, Review
 * connection settings, Mark dispatched, Cancel) and the raw `errorMessage`
 * text — `Download label` and `Track parcel` are read-only and stay visible
 * regardless of role. The message redaction is belt-and-braces here: the API
 * already withholds the raw text from a non-`shipments:write` session
 * (`ShipmentResponseDto.fromDomain`), so this branch only ever sees the
 * server's placeholder for a viewer anyway.
 *
 * @module apps/web/src/features/shipments/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import {
  CAN_CANCEL,
  CAN_DOWNLOAD_LABEL,
  CAN_GENERATE,
  CAN_NOTIFY_DISPATCHED,
} from '../lib/shipment-action-eligibility';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useToast } from '../../../shared/ui/toast-provider';
import { DELIVERY_INTENT_LABEL, type Shipment } from '../api/shipments.types';
import { buildCarrierTrackingUrl, getCarrierDisplayName } from '../lib/carrier-tracking-url';
import { useCancelShipmentMutation } from '../hooks/use-cancel-shipment-mutation';
import { useLabelDownload } from '../hooks/use-label-download';
import { useNotifyDispatchedMutation } from '../hooks/use-notify-dispatched-mutation';

interface ShipmentRowDetailProps {
  shipment: Shipment;
  /** `usePermission('shipments:write')` — gates write actions + raw error text. */
  canWrite: boolean;
}

function retryHref(shipment: Shipment): string {
  return `/orders/${shipment.orderId}?retryShipmentId=${shipment.id}`;
}

export function ShipmentRowDetail({ shipment, canWrite }: ShipmentRowDetailProps): ReactElement {
  const cancelMutation = useCancelShipmentMutation();
  const notifyMutation = useNotifyDispatchedMutation();
  const labelDownload = useLabelDownload();
  const { showToast } = useToast();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);

  // Branch-1 (#839 AC-6): OMP-fulfilled, projection-only — no OL dispatch
  // action is meaningful. `createBranchOneShipment` does populate
  // `trackingNumber` even though `carrier` is never set, so there's no
  // clickable tracker link (`buildCarrierTrackingUrl` correctly returns
  // null) but the raw number is still worth surfacing as copy-text.
  if (shipment.shippingMethod === 'omp') {
    return (
      <div className="shipment-row-detail">
        {shipment.trackingNumber ? (
          <dl className="shipment-detail-grid">
            <div className="shipment-detail-grid__field">
              <span className="shipment-detail-grid__label">Tracking</span>
              <p className="shipment-detail-grid__value">
                <CopyableId id={shipment.trackingNumber} label={shipment.trackingNumber} />
              </p>
            </div>
          </dl>
        ) : (
          <p className="text-muted">Fulfilled by the destination — no tracking yet.</p>
        )}
      </div>
    );
  }

  const canGenerate = CAN_GENERATE.has(shipment.status);
  const canCancel = CAN_CANCEL.has(shipment.status);
  const canNotify = CAN_NOTIFY_DISPATCHED.has(shipment.status);
  const canDownloadLabel =
    shipment.labelPdfRef !== null && CAN_DOWNLOAD_LABEL.has(shipment.status);
  const trackingUrl = buildCarrierTrackingUrl(shipment);
  const isFailed = shipment.status === 'failed';
  const carrierName = getCarrierDisplayName(shipment.carrier) ?? 'the carrier';
  // Fallback for a common transitional state (#1826) — e.g. `dispatched` /
  // `in-transit` before the carrier status-sync poll has backfilled `carrier`
  // (no tracking link yet) — where none of the failure block, action row, or
  // tracking link has anything to render. Without this, the `expandable`
  // toggle promises content on every row and opens onto an empty box.
  const hasAnyAction =
    (canGenerate && canWrite) ||
    (canNotify && canWrite) ||
    canDownloadLabel ||
    trackingUrl !== null ||
    (canCancel && canWrite);
  const hasAnyContent = isFailed || hasAnyAction;

  const handleDownloadLabel = (): void => {
    void labelDownload.download(shipment.id).then((ok) => {
      if (!ok) {
        showToast({ tone: 'error', description: 'Could not download the label. Try again.' });
      }
    });
  };

  return (
    <div className="shipment-row-detail">
      {isFailed ? (
        <dl className="shipment-detail-grid">
          <div className="shipment-detail-grid__field shipment-detail-grid__field--wide">
            <span className="shipment-detail-grid__label">
              {canWrite ? 'Carrier rejection' : 'Shipment failed'}
            </span>
            <p className="shipment-detail-grid__value">
              {canWrite
                ? shipment.errorMessage
                : 'Details hidden for this role.'}
            </p>
          </div>
          {shipment.failedAt ? (
            <div className="shipment-detail-grid__field">
              <span className="shipment-detail-grid__label">Failed</span>
              <p className="shipment-detail-grid__value">
                <TimeDisplay iso={shipment.failedAt} />
              </p>
            </div>
          ) : null}
          {/* Triage context (#1826): what shape of delivery the dispatch was
              actually requested as. A `pickup_point` failure points at the
              locker code / point resolution; an `address` failure points at
              the recipient address. Null on pre-#979 rows and omp
              projections, so the field is omitted rather than shown empty. */}
          {shipment.deliveryIntent ? (
            <div className="shipment-detail-grid__field">
              <span className="shipment-detail-grid__label">Requested as</span>
              <p className="shipment-detail-grid__value">
                {DELIVERY_INTENT_LABEL[shipment.deliveryIntent]}
              </p>
            </div>
          ) : null}
        </dl>
      ) : !hasAnyContent ? (
        <p className="text-muted">
          No actions available for this shipment yet — check back once the carrier status sync
          catches up.
        </p>
      ) : null}

      <div className="shipment-row-detail__actions">
        {isFailed && canWrite ? (
          // Cause-neutral copy (#1826) — the raw carrier message could be
          // anything the carrier rejects on, not necessarily a sender-address
          // problem (see `ShipmentTriageStrip`'s header comment for the same
          // reasoning). `button--secondary` so it doesn't visually dominate
          // the primary Regenerate action next to it.
          <Link
            to={`/connections/${shipment.connectionId}`}
            className="button button--secondary button--sm"
          >
            Review connection settings
          </Link>
        ) : null}
        {canGenerate && canWrite ? (
          <Link to={retryHref(shipment)} className="button button--primary button--sm">
            {isFailed ? 'Regenerate label' : 'Generate label'}
          </Link>
        ) : null}
        {canNotify && canWrite ? (
          <Button
            tone="secondary"
            className="button--sm"
            onClick={() => setNotifyDialogOpen(true)}
            disabled={notifyMutation.isPending}
          >
            Mark dispatched
          </Button>
        ) : null}
        {canDownloadLabel ? (
          <Button
            tone="secondary"
            className="button--sm"
            onClick={handleDownloadLabel}
            disabled={labelDownload.isDownloading}
          >
            {labelDownload.isDownloading ? 'Downloading…' : 'Download label'}
          </Button>
        ) : null}
        {trackingUrl ? (
          <a href={trackingUrl} target="_blank" rel="noreferrer" className="button button--sm">
            Track parcel
          </a>
        ) : null}
        {canCancel && canWrite ? (
          <Button
            tone="danger"
            className="button--sm"
            onClick={() => setCancelDialogOpen(true)}
            disabled={cancelMutation.isPending}
          >
            Cancel
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Cancel this shipment?"
        description={
          <>
            The label will be voided with {carrierName}. This cannot be undone — to ship this
            order again you&apos;ll need to generate a new label.
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
            fulfillment state. Use this only when the automatic dispatch flow has stalled — the
            normal path is automatic via the carrier&apos;s status sync.
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
    </div>
  );
}
