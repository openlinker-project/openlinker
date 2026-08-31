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
 * Permission note (#1826, deliberate): `canWrite` comes from
 * `usePermission('shipments:write')`, NOT `useWriteAccess` (#1615), so write
 * affordances are absent — not disabled-with-tooltip — for a public-demo
 * read-only viewer. The plan (§7 of
 * `docs/plans/implementation-plan-shipments-inline-retry.md`) chose that
 * deliberately, because the carrier `errorMessage` these affordances sit
 * beside is itself role-redacted server-side. Do not "fix" this by swapping in
 * `useWriteAccess` without revisiting that decision.
 *
 * @module apps/web/src/features/shipments/components
 */
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import {
  CAN_CANCEL,
  CAN_DOWNLOAD_LABEL,
  CAN_NOTIFY_DISPATCHED,
  canRegenerateLabel,
  isPreWaybill,
} from '../lib/shipment-action-eligibility';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { CopyableId } from '../../../shared/ui/copyable-id';
import { shortenId } from '../../../shared/ui/entity-label';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useToast } from '../../../shared/ui/toast-provider';
import {
  DELIVERY_INTENT_LABEL,
  REDACTED_ERROR_MESSAGE,
  SHIPPING_METHOD_LABEL,
  type Shipment,
} from '../api/shipments.types';
import { buildCarrierTrackingUrl, getCarrierDisplayName } from '../lib/carrier-tracking-url';
import { resolveLabelDownloadError } from '../lib/label-download-error';
import { deriveRetryabilityClass, RETRYABILITY_LABEL } from '../lib/shipment-retryability';
import { useCancelShipmentMutation } from '../hooks/use-cancel-shipment-mutation';
import { useLabelDownload } from '../hooks/use-label-download';
import { useNotifyDispatchedMutation } from '../hooks/use-notify-dispatched-mutation';

interface ShipmentRowDetailProps {
  shipment: Shipment;
  /** `usePermission('shipments:write')` — gates write actions + raw error text. */
  canWrite: boolean;
  /**
   * `usePermission('connections:write')` — gates the connection-settings jump
   * only. Editing a connection is a different permission from dispatching a
   * shipment, and `ShipmentTriageStrip` already separates the two; binding this
   * link to `canWrite` here would have handed the same CTA to a
   * `shipments:write`-only operator in the accordion while withholding it in
   * the strip.
   */
  canReviewConnection: boolean;
}

/**
 * Deep link into the order's shipment form.
 *
 * `#shipment` matches the anchor the order-detail page already scroll-and-
 * focuses (the same target `/orders` list rows link to); without it the
 * operator lands at the top of a long order page with the form out of sight.
 * `from=shipments` tells that page where the jump came from so it can offer
 * the way back.
 */
function retryHref(shipment: Shipment): string {
  return `/orders/${shipment.orderId}?retryShipmentId=${shipment.id}&from=shipments#shipment`;
}

export function ShipmentRowDetail({
  shipment,
  canWrite,
  canReviewConnection,
}: ShipmentRowDetailProps): ReactElement {
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

  const canGenerate = canRegenerateLabel(shipment, canWrite);
  const canCancel = CAN_CANCEL.has(shipment.status);
  const canNotify = CAN_NOTIFY_DISPATCHED.has(shipment.status);
  const canDownloadLabel =
    shipment.labelPdfRef !== null && CAN_DOWNLOAD_LABEL.has(shipment.status);
  const trackingUrl = buildCarrierTrackingUrl(shipment);
  const isFailed = shipment.status === 'failed';
  // A `failed` row that still holds a waybill is a post-delivery outcome
  // (returned to sender, refused, undelivered, pickup expired…) rather than a
  // rejected dispatch. Regenerating there would buy a SECOND carrier label
  // while the first stays live, so the CTA is replaced by an explanation.
  const isPostWaybillFailure = isFailed && !isPreWaybill(shipment);
  const liveWaybill = shipment.trackingNumber ?? shipment.providerShipmentId;
  const carrierName = getCarrierDisplayName(shipment.carrier) ?? 'the carrier';
  // Drives the "why is there nothing to do here" line below — true for a
  // common transitional state (`dispatched` / `in-transit` before the carrier
  // status-sync poll has backfilled `carrier`, so no tracking link yet) as
  // well as for a viewer who simply holds no write permission.
  const hasAnyAction =
    canGenerate ||
    (canNotify && canWrite) ||
    canDownloadLabel ||
    trackingUrl !== null ||
    (canCancel && canWrite);
  // Provider / Method / Tracking / Paczkomat are hidden from the table below
  // 1024px (Paczkomat, Provider) and 768px (Tracking), so on a narrow window
  // the accordion is the ONLY place they can be read. The `omp` branch above
  // already surfaces its tracking number this way; this is the same treatment
  // for a carrier-dispatched row.
  //
  // The internal order id joined them in #2089 — see `orderIdField` below, which
  // both grids render.
  const facts: ReadonlyArray<{ label: string; value: string; mono: boolean }> = [
    { label: 'Provider', value: shipment.carrier ? carrierName : null, mono: false },
    { label: 'Method', value: SHIPPING_METHOD_LABEL[shipment.shippingMethod], mono: false },
    { label: 'Tracking', value: shipment.trackingNumber, mono: true },
    { label: 'Paczkomat', value: shipment.paczkomatId, mono: true },
  ].filter((fact): fact is { label: string; value: string; mono: boolean } => fact.value !== null);

  // ONE definition for both grids below. The failed grid is a separate `<dl>`
  // that does not render `facts`, and a failed row is precisely where an operator
  // quotes the order id to carrier support — so justifying this field by triage
  // while showing it only on healthy rows would have been the wrong way round.
  const orderIdField = (
    <div className="shipment-detail-grid__field">
      <span className="shipment-detail-grid__label">Order</span>
      <p className="shipment-detail-grid__value mono-text">
        <CopyableId
          id={shipment.orderId}
          label={shortenId(shipment.orderId)}
          copyLabel={`Copy internal order ID ${shortenId(shipment.orderId)}`}
          copiedLabel={`Copied internal order ID ${shortenId(shipment.orderId)}`}
        />
      </p>
    </div>
  );

  const handleDownloadLabel = (): void => {
    void labelDownload.download(shipment.id).then((result) => {
      if (!result.ok) {
        const mapped = resolveLabelDownloadError(result.error);
        showToast({ tone: mapped.tone, title: mapped.title, description: mapped.description });
      }
    });
  };

  return (
    <div className="shipment-row-detail">
      {isFailed ? (
        <dl className="shipment-detail-grid">
          <div className="shipment-detail-grid__field shipment-detail-grid__field--wide">
            <span className="shipment-detail-grid__label">
              {canWrite && shipment.errorMessage ? 'Carrier rejection' : 'Shipment failed'}
            </span>
            <p className="shipment-detail-grid__value">
              {/* A status-sync-derived failure (returned to sender, refused,
                  undelivered, pickup expired…) persists no `errorMessage`, so
                  without this fallback the operator saw a "Carrier rejection"
                  label above an empty paragraph. */}
              {!canWrite
                ? REDACTED_ERROR_MESSAGE
                : shipment.errorMessage ??
                  'The carrier reported this parcel as undelivered or returned - check the tracker.'}
            </p>
          </div>
          {orderIdField}
          {shipment.failedAt ? (
            <div className="shipment-detail-grid__field">
              <span className="shipment-detail-grid__label">Failed</span>
              <p className="shipment-detail-grid__value">
                <TimeDisplay iso={shipment.failedAt} />
              </p>
            </div>
          ) : null}
          {/* Structured rejection code (#1918) — unlike `errorMessage`, never
              redacted for a viewer (short discriminator, not carrier prose),
              so this is the one cause-related field a viewer always sees. */}
          {shipment.providerCode ? (
            <div className="shipment-detail-grid__field">
              <span className="shipment-detail-grid__label">Rejection code</span>
              <p className="shipment-detail-grid__value mono-text">
                {shipment.providerCode}
                {' - '}
                {RETRYABILITY_LABEL[deriveRetryabilityClass(shipment.providerCode)]}
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
      ) : (
        <dl className="shipment-detail-grid">
          {orderIdField}
          {facts.map((fact) => (
            <div className="shipment-detail-grid__field" key={fact.label}>
              <span className="shipment-detail-grid__label">{fact.label}</span>
              <p className={`shipment-detail-grid__value${fact.mono ? ' mono-text' : ''}`}>
                {fact.value}
              </p>
            </div>
          ))}
        </dl>
      )}

      {!isFailed && !hasAnyAction ? (
        // Two genuinely different reasons for an actionless row — conflating
        // them told a viewer to wait for a status sync that was never the
        // problem.
        <p className="text-muted">
          {canWrite
            ? 'No actions available for this shipment yet — check back once the carrier status sync catches up.'
            : 'You do not have permission to act on this shipment.'}
        </p>
      ) : null}

      {isPostWaybillFailure ? (
        // Rendered for viewers too: this is the one failed-row shape that
        // offers neither an action nor a rejection message, so without this a
        // viewer would see only the redaction placeholder and no reason why
        // nothing is actionable. The remediation half is write-gated - no
        // "Cancel" button exists on a failed row (`CAN_CANCEL` covers
        // `generated` only), so the copy points at the carrier-side void rather
        // than promising an in-app control that isn't here.
        <p className="text-muted">
          {`This parcel already has a live waybill${liveWaybill ? ` (${liveWaybill})` : ''}, so it cannot be re-dispatched from here${
            canWrite
              ? ` - regenerating would purchase a second label. Void the existing waybill with ${carrierName} first, then generate a new one.`
              : '.'
          }`}
        </p>
      ) : null}

      <div className="shipment-row-detail__actions">
        {isFailed && canReviewConnection ? (
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
        {canGenerate ? (
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
