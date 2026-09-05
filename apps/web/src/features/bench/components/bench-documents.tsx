/**
 * The paper that travels with the box (#2418, `W3b-5`, Surface F)
 *
 * What goes INSIDE the box, what goes ON it, and the one state where a finished
 * box cannot go out at all.
 *
 * ## The bench PRINTS; it never ISSUES (F1)
 *
 * Nothing here creates a document. Both papers were made earlier, away from this
 * bench, and the copy says so to the packer rather than leaving them to work it
 * out from the absence of a "create" button. That is also why a missing invoice
 * has no retry: there is nothing at a bench that could make one.
 *
 * ## A missing invoice NEVER blocks (F2/D17)
 *
 * It is named — in the sales-document vocabulary the rest of the product already
 * uses, resolved through `features/sales-documents`' own guarded map rather than
 * a second copy of it — and the box goes out. A tax-rate gap is an office
 * problem the packer cannot fix, and refusing to pack would pile boxes at a
 * bench while somebody hunts for an administrator. That is the shape of every
 * fail-closed gate that gets switched off within a week.
 *
 * ## Two mockup controls are deliberately NOT rendered
 *
 * Two of the mockup's controls are deliberately absent, for the same reason: a
 * control wired to nothing is worse than a missing one on a surface worked at
 * speed. *"Put the box on the problem shelf"* has no backend behind it —
 * nothing records a shelf. And *"Try the label again"* has nothing to retry: a
 * label that EXISTS is reported `ready`, where the Print control re-fetches
 * every time it is pressed, so this arm is reached only when none was ever
 * produced — and buying one needs the address and the box measurements, which
 * are deliberately not on this screen. The panel names the owner instead.
 *
 * @module apps/web/src/features/bench/components
 */
import { useState, type ReactElement } from 'react';

import { useApiClient } from '../../../app/api/api-client-provider';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { BenchLabel } from '../api/bench-parcel.types';
import { useBenchDocumentsQuery, useBenchUnlabelledQuery } from '../hooks/use-bench-documents-query';
import { describeInvoiceBlock } from '../lib/bench-parcel-presentation';
import { benchParcelCopy } from '../lib/bench-parcel.copy';
import { printBlob } from '../lib/bench-print';

export interface BenchDocumentsPanelProps {
  readonly workId: string;
  /** Units verified into the box, for the unlabelled state's reassurance line. */
  readonly unitsPacked: number;
}

/**
 * What the carrier said, from what a PACKER is allowed to see.
 *
 * `carrierMessage` is `null` for a caller without `shipments:write` — the raw
 * rejection text may embed address fragments — which is every packer, so the
 * short code stands in. Where there is neither, the panel distinguishes two
 * facts a single sentence would have blurred: a reason exists but this role may
 * not read it (`carrierMessageRedacted`), and the carrier genuinely gave none.
 * Printing the second when the first is true is the surface stating something
 * false, which is worse than saying less.
 */
function describeCarrierRefusal(label: BenchLabel): string {
  if (label.carrierMessage !== null && label.carrierMessage.trim().length > 0) {
    return benchParcelCopy.unlabelled.carrierQuote(label.carrierMessage);
  }
  if (label.providerCode !== null && label.providerCode.trim().length > 0) {
    return benchParcelCopy.unlabelled.carrierCode(label.providerCode);
  }
  return label.carrierMessageRedacted
    ? benchParcelCopy.unlabelled.carrierHidden
    : benchParcelCopy.unlabelled.carrierUnknown;
}

export function BenchDocumentsPanel({
  workId,
  unitsPacked,
}: BenchDocumentsPanelProps): ReactElement | null {
  const apiClient = useApiClient();
  const documents = useBenchDocumentsQuery(workId);
  const [printError, setPrintError] = useState<string | null>(null);

  const data = documents.data;
  const unlabelled = data?.label.state === 'unavailable';
  // Only asked for while this bench is actually looking at an unlabelled box.
  const others = useBenchUnlabelledQuery({ enabled: unlabelled });

  if (data === undefined) return null;

  const invoice = data.invoice;
  const label = data.label;
  const invoiceBlock = describeInvoiceBlock(invoice.blockReason, invoice.unresolvedReason);

  const printInvoice = (): void => {
    setPrintError(null);
    void apiClient.bench
      .downloadInvoice(workId)
      .then((blob) => {
        if (!printBlob(blob)) setPrintError(benchParcelCopy.documents.printFailed);
      })
      .catch(() => {
        setPrintError(benchParcelCopy.documents.printFailed);
      });
  };

  const printLabel = (onFailure?: () => void): void => {
    setPrintError(null);
    if (label.shipmentId === null) {
      setPrintError(benchParcelCopy.documents.printFailed);
      return;
    }
    void apiClient.shipments
      .downloadLabel(label.shipmentId)
      .then((blob) => {
        if (!printBlob(blob)) setPrintError(benchParcelCopy.documents.printFailed);
      })
      .catch(() => {
        if (onFailure) onFailure();
        else setPrintError(benchParcelCopy.documents.printFailed);
      });
  };

  return (
    <section className="bench-documents" data-testid="bench-documents">
      {printError === null ? null : <Alert tone="warning">{printError}</Alert>}

      {/* F1, said before either control: neither paper is made here. */}
      {invoice.state === 'ready' && label.state === 'ready' ? (
        <div className="bench-documents__intro">
          <h3>{benchParcelCopy.documents.readyTitle}</h3>
          <p>{benchParcelCopy.documents.readyBody}</p>
        </div>
      ) : null}

      {/* ── F3/F4 — packed, and it cannot go out. ─────────────────────────── */}
      {unlabelled ? (
        <div className="bench-documents__unlabelled" data-testid="bench-documents-unlabelled">
          <p className="eyebrow">{benchParcelCopy.unlabelled.eyebrow}</p>
          <h3 className="bench-documents__title">{benchParcelCopy.unlabelled.title}</h3>
          <StatusBadge tone="error" withDot>
            {benchParcelCopy.unlabelled.badge}
          </StatusBadge>
          {/* "Do not open it and do not check it again" — the box is correct;
              only the label is outstanding. */}
          <p>{benchParcelCopy.unlabelled.body(unitsPacked)}</p>

          <div className="bench-documents__carrier">
            <h4>{benchParcelCopy.unlabelled.carrierHeading}</h4>
            <p className="bench-documents__carrier-said">{describeCarrierRefusal(label)}</p>
            <p>{benchParcelCopy.unlabelled.carrierReassurance}</p>
          </div>

          {/* No "try again" control here, and its absence is the decision.
              A label that EXISTS is reported `ready`, where the Print control
              re-fetches every time it is pressed — so a transient fetch failure
              is already retried by pressing it again. This arm is reached only
              when no label was ever produced, and buying one needs the address
              and the box measurements, which are deliberately not on this
              screen. A control wired to something that cannot succeed is worse
              than none, so the panel names the owner instead. */}
          <p className="bench-documents__not-retryable">
            {benchParcelCopy.unlabelled.notRetryable}
          </p>

          <div className="bench-documents__dispatch">
            <h4>{benchParcelCopy.unlabelled.dispatchTitle}</h4>
            <p>{benchParcelCopy.unlabelled.dispatchBody}</p>
            {/* One read, two audiences — which is what stops the bench and
                dispatch disagreeing about a box on a floor. `here` is this box;
                the rest of the list is what dispatch is looking at. */}
            {others.data === undefined ? null : (
              <StatusBadge tone="neutral">
                {benchParcelCopy.unlabelled.counts({
                  here: 1,
                  inDispatch: Math.max(0, others.data.total - 1),
                })}
              </StatusBadge>
            )}
          </div>
        </div>
      ) : null}

      {/* ── The invoice: inside the box. ──────────────────────────────────── */}
      <div className="bench-documents__invoice" data-testid="bench-documents-invoice">
        <StatusBadge tone={invoice.state === 'ready' ? 'success' : 'warning'} withDot>
          {invoice.state === 'ready'
            ? benchParcelCopy.documents.readyBadge
            : benchParcelCopy.documents.nothingToPrintBadge}
        </StatusBadge>
        <span className="bench-documents__slot">
          {invoice.state === 'missing'
            ? benchParcelCopy.documents.insideLabelMissing
            : benchParcelCopy.documents.insideLabel}
        </span>

        {invoice.state === 'ready' ? (
          <>
            <h3>{benchParcelCopy.documents.invoiceTitle(invoice.documentNumber)}</h3>
            <p>{benchParcelCopy.documents.invoiceHint}</p>
            <Button tone="secondary" onClick={printInvoice}>
              {benchParcelCopy.documents.printInvoiceAction}
            </Button>
          </>
        ) : invoice.state === 'issued-not-printable' ? (
          <>
            <h3>{benchParcelCopy.documents.notPrintableTitle}</h3>
            <p>{benchParcelCopy.documents.notPrintableBody}</p>
          </>
        ) : (
          <>
            {/* F2 — named, never silently skipped, and it blocks nothing. */}
            <h3>{benchParcelCopy.documents.missingTitle}</h3>
            <p>{benchParcelCopy.documents.missingBody}</p>
            <h4>{benchParcelCopy.documents.missingInvoiceTitle}</h4>
            <p>{benchParcelCopy.documents.missingInvoiceBody}</p>
            <p className="bench-documents__missing-reason">
              {benchParcelCopy.documents.missingReasonLabel}:{' '}
              {invoiceBlock === null
                ? benchParcelCopy.documents.missingReasonUnknown
                : `${invoiceBlock.short} — ${invoiceBlock.detail}`}
            </p>
            <p className="bench-documents__flagged">
              <strong>{benchParcelCopy.documents.flaggedTitle}</strong>{' '}
              {benchParcelCopy.documents.flaggedBody}
            </p>
          </>
        )}
      </div>

      {/* ── The label: on the box. Suppressed while unlabelled, which has its
             own treatment above. ──────────────────────────────────────────── */}
      {label.state === 'ready' ? (
        <div className="bench-documents__label" data-testid="bench-documents-label">
          <StatusBadge tone="success" withDot>
            {benchParcelCopy.documents.readyBadge}
          </StatusBadge>
          <span className="bench-documents__slot">{benchParcelCopy.documents.onLabel}</span>
          <h3>{benchParcelCopy.documents.labelTitle(label.carrier)}</h3>
          {label.trackingNumber === null ? null : (
            <p className="bench-documents__tracking">
              {benchParcelCopy.documents.trackingLabel}: {label.trackingNumber}
            </p>
          )}
          <p>{benchParcelCopy.documents.labelHint}</p>
          <Button
            tone="primary"
            onClick={() => {
              printLabel();
            }}
          >
            {benchParcelCopy.documents.printLabelAction}
          </Button>
        </div>
      ) : null}

      {unlabelled && invoice.state === 'ready' ? (
        <p className="bench-documents__invoice-still-fine">
          {benchParcelCopy.unlabelled.invoiceStillFine}
        </p>
      ) : null}
    </section>
  );
}
