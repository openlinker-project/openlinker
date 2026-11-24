/**
 * InfaktInvoiceCorrectionFlow (#1282)
 *
 * Per-provider `invoiceCorrectionFlow` slot for inFakt. Issues a KOR (faktura
 * korygująca) via `POST /invoices/:invoiceId/correct` — the same generic
 * capability-gated endpoint KSeF uses (backed by `InfaktInvoicingAdapter`
 * implementing `CorrectionIssuer`, PR #1292). The operator supplies:
 *   - an optional free-text reason;
 *   - per-line new quantity and/or new unit price gross.
 *
 * The line table is the shared `CorrectionLineGrid` (#3090) whenever the
 * invoice's content is authoritative — see `KsefInvoiceCorrectionFlow`'s
 * docblock for the full rationale, unchanged here. Near-1:1 port of that
 * component — same generic `useIssueCorrectionMutation` hook, same
 * `InvoiceCorrectionFlowProps` slot contract. The host dialog owns the outer
 * chrome; this component is content-only — call `onClose` to close the
 * dialog.
 *
 * @module plugins/infakt/components
 */
import { type ReactElement, useRef, useState } from 'react';
import { renderRich, useFormat, interpolate } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import type { InvoiceCorrectionFlowProps } from '../../../shared/plugins/plugin.types';
import {
  CorrectionLineGrid,
  CorrectionLinePicker,
  useInvoiceContentQuery,
  useIssueCorrectionMutation,
  type CorrectionLineInput,
  CorrectionReasonField,
  useCorrectionReason,
  useWarningAcknowledgement,
} from '../../../features/invoicing';
import { useInfaktMessages } from '../messages';
import { describeApiError } from '../../../shared/api/describe-api-error';

interface LineRow {
  originalLineNumber: string;
  newQuantity: string;
  newUnitPriceGross: string;
}

function emptyRow(): LineRow {
  return { originalLineNumber: '', newQuantity: '', newUnitPriceGross: '' };
}

/**
 * Returns `null` when a filled-in row changes neither quantity nor price — a
 * no-op line the backend `CorrectionLineDto` rejects (at least one delta is
 * required per line).
 */
function parseLineRows(rows: LineRow[]): CorrectionLineInput[] | null {
  const filled = rows.filter((r) => r.originalLineNumber.trim() !== '');
  const parsed: CorrectionLineInput[] = [];
  for (const r of filled) {
    const lineNum = parseInt(r.originalLineNumber, 10);
    const qty = r.newQuantity.trim() !== '' ? parseFloat(r.newQuantity) : undefined;
    const price = r.newUnitPriceGross.trim() !== '' ? parseFloat(r.newUnitPriceGross) : undefined;
    const hasQty = qty !== undefined && !Number.isNaN(qty);
    const hasPrice = price !== undefined && !Number.isNaN(price);
    if (!hasQty && !hasPrice) {
      return null;
    }
    parsed.push({
      originalLineNumber: lineNum,
      ...(hasQty ? { newQuantity: qty } : {}),
      ...(hasPrice ? { newUnitPriceGross: price } : {}),
    });
  }
  return parsed;
}

export function InfaktInvoiceCorrectionFlow({
  invoice,
  onClose,
  onCorrectionIssued,
  suggestedLines,
}: InvoiceCorrectionFlowProps): ReactElement {
  const copy = useInfaktMessages().infaktInvoiceCorrectionFlow;
  const format = useFormat();
  const strong = { strong: (text: string) => <strong>{text}</strong> };
  const strongMono = { strong: (text: string) => <strong className="mono-text">{text}</strong> };
  const { showToast } = useToast();
  const mutation = useIssueCorrectionMutation();
  const acknowledgement = useWarningAcknowledgement(mutation.isPending);
  const { linesAreAuthoritative, query: contentQuery } = useInvoiceContentQuery(invoice.id);

  // Per-mount stable idempotency key — prevents duplicate KOR issuance on timeout/retry.
  const idempotencyKeyRef = useRef(
    `infakt-corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );

  const reasonState = useCorrectionReason();
  const [lines, setLines] = useState<LineRow[]>([emptyRow()]);
  const [gridLines, setGridLines] = useState<CorrectionLineInput[]>([]);
  const [linesError, setLinesError] = useState<string | null>(null);

  function updateLine(index: number, field: keyof LineRow, value: string): void {
    setLines((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function addLine(): void {
    setLines((prev) => [...prev, emptyRow()]);
  }

  function removeLine(index: number): void {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function handleSubmit(): void {
    let parsedLines: CorrectionLineInput[];
    if (linesAreAuthoritative) {
      if (gridLines.length === 0) {
        setLinesError(
          copy.gridLinesRequired,
        );
        return;
      }
      parsedLines = gridLines;
    } else {
      const parsed = parseLineRows(lines);
      if (parsed === null) {
        setLinesError(
          copy.lineDeltaRequired,
        );
        return;
      }
      if (parsed.length === 0) {
        setLinesError(
          copy.linesRequired,
        );
        return;
      }
      parsedLines = parsed;
    }
    setLinesError(null);
    // DEF-32: a missing reason warns once, then the operator decides.
    if (!reasonState.confirmBeforeSubmit()) {
      return;
    }
    const send = (acknowledgeWarnings: string[]): void => {
      mutation.mutate(
        {
          invoiceId: invoice.id,
          input: {
            ...(acknowledgeWarnings.length > 0 ? { acknowledgeWarnings } : {}),
            reason: reasonState.submittedReason,
            lines: parsedLines,
            idempotencyKey: idempotencyKeyRef.current,
          },
        },
        {
          onSuccess: (correctionInvoice) => {
            showToast({
              tone: 'success',
              title: copy.issued,
              description: copy.issuedBody,
            });
            onCorrectionIssued(correctionInvoice.id);
            onClose();
          },
          onError: (error) => {
            // DEF-23/30/31: a refusal the operator may overrule asks instead of failing.
            if (acknowledgement.offer(error, send)) {
              return;
            }
            showToast({
              tone: 'error',
              title: copy.failed,
              description: describeApiError(error, 'infakt'),
            });
          },
        },
      );
    };
    acknowledgement.reset();
    send([]);
  }

  const isSubmitting = mutation.isPending;

  return (
    <div className="infakt-correction">
      {/* Header */}
      <div className="infakt-correction__head">
        <h3>{copy.title}</h3>
        <span className="section-card__provider">
          {copy.providerTag}
        </span>
      </div>

      {/* Original invoice reference */}
      <div className="infakt-correction__orig">
        <span>
          {renderRich(copy.correcting, strong, {
            reference: invoice.providerInvoiceNumber ?? invoice.id,
          })}
        </span>
        {invoice.clearanceReference ? (
          <span>
            {renderRich(copy.ksefRef, strongMono, {
              reference: `${invoice.clearanceReference.slice(0, 14)}…`,
            })}
          </span>
        ) : null}
        {invoice.issuedAt ? (
          <span>
            {renderRich(copy.issuedOn, strongMono, { date: format.date(invoice.issuedAt) })}
          </span>
        ) : null}
      </div>

      {/* Reason */}
      <CorrectionReasonField
        state={reasonState}
        name="infakt"
        disabled={isSubmitting}
        className="infakt-correction__reason"
      />

      {/* Line items */}
      {linesError ? (
        <p className="error-text" role="alert">
          {linesError}
        </p>
      ) : null}

      {contentQuery.isLoading ? (
        <p className="text-muted">{copy.loadingLines}</p>
      ) : linesAreAuthoritative ? (
        <CorrectionLineGrid
          invoiceId={invoice.id}
          suggestedLines={suggestedLines}
          disabled={isSubmitting}
          onChange={setGridLines}
        />
      ) : (
        <>
          <div className="infakt-correction__table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{copy.col.lp}</th>
                  <th className="infakt-correction__col-qty">
                    {copy.col.newQty}
                  </th>
                  <th className="infakt-correction__col-price">
                    {copy.col.newPrice}
                  </th>
                  <th aria-label={copy.col.remove} />
                </tr>
              </thead>
              <tbody>
                {lines.map((row, i) => (
                  <tr key={i}>
                    <td>
                      <CorrectionLinePicker
                        invoiceId={invoice.id}
                        value={row.originalLineNumber}
                        onChange={(next) => updateLine(i, 'originalLineNumber', next)}
                        ariaLabel={interpolate(copy.lineNum, { n: i + 1 })}
                        disabled={isSubmitting}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="input input--w-qty"
                        value={row.newQuantity}
                        onChange={(e) => updateLine(i, 'newQuantity', e.target.value)}
                        placeholder={copy.emptyCell}
                        min={0}
                        step="any"
                        aria-label={interpolate(copy.newQty, { n: i + 1 })}
                        disabled={isSubmitting}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="input input--w-price"
                        value={row.newUnitPriceGross}
                        onChange={(e) => updateLine(i, 'newUnitPriceGross', e.target.value)}
                        placeholder={copy.emptyCell}
                        min={0}
                        step="any"
                        aria-label={interpolate(copy.newPrice, { n: i + 1 })}
                        disabled={isSubmitting}
                      />
                    </td>
                    <td>
                      <Button
                        tone="secondary"
                        onClick={() => removeLine(i)}
                        disabled={lines.length === 1 || isSubmitting}
                        aria-label={interpolate(copy.removeLine, { n: i + 1 })}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button tone="secondary" onClick={addLine} disabled={isSubmitting}>
            {copy.addLine}
          </Button>

          <p className="infakt-correction__note">
            {copy.note}
          </p>
        </>
      )}

      {/* Actions */}
      <div className="wizard__actions">
        <span className="wizard__spacer" />
        <Button tone="secondary" onClick={onClose} disabled={isSubmitting}>
          {copy.cancel}
        </Button>
        <Button tone="primary" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting
            ? copy.submitting
            : copy.submit}
        </Button>
      </div>
      {acknowledgement.dialog}
    </div>
  );
}
