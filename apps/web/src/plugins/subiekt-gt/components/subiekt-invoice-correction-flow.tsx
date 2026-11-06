/**
 * SubiektInvoiceCorrectionFlow (#1241)
 *
 * Per-provider `invoiceCorrectionFlow` slot for Subiekt. Issues a correcting
 * document (faktura korygująca) via the #1241 HTTP endpoint
 * `POST /invoices/:invoiceId/correct`. The operator supplies:
 *   - a free-text reason, recommended but not forced (DEF-32);
 *   - per-line new quantity and/or new unit price gross.
 *
 * The line table is the shared `CorrectionLineGrid` (#3090) whenever the
 * invoice's content is authoritative — see `KsefInvoiceCorrectionFlow`'s
 * docblock for the full rationale, unchanged here. When it is not, this flow
 * falls back to the original manual entry: the operator enters line numbers
 * explicitly, starting with ONE empty row and an "Add line" affordance. The
 * host dialog owns the outer chrome; this component is content-only — call
 * `onClose` to close the dialog.
 *
 * @module plugins/subiekt-gt/components
 */
import { type ReactElement, useState, useRef } from 'react';
import { interpolate, renderRich, useFormat } from '../../../shared/i18n';
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
import { useSubiektGtMessages } from '../messages';

interface LineRow {
  originalLineNumber: string;
  newQuantity: string;
  newUnitPriceGross: string;
}

function emptyRow(): LineRow {
  return { originalLineNumber: '', newQuantity: '', newUnitPriceGross: '' };
}

function parseLineRows(rows: LineRow[]): CorrectionLineInput[] {
  return rows
    .filter((r) => r.originalLineNumber.trim() !== '')
    .map((r) => {
      const lineNum = parseInt(r.originalLineNumber, 10);
      const qty = r.newQuantity.trim() !== '' ? parseFloat(r.newQuantity) : undefined;
      const price =
        r.newUnitPriceGross.trim() !== '' ? parseFloat(r.newUnitPriceGross) : undefined;
      return {
        originalLineNumber: lineNum,
        ...(qty !== undefined && !Number.isNaN(qty) ? { newQuantity: qty } : {}),
        ...(price !== undefined && !Number.isNaN(price) ? { newUnitPriceGross: price } : {}),
      };
    });
}

export function SubiektInvoiceCorrectionFlow({
  invoice,
  onClose,
  onCorrectionIssued,
  suggestedLines,
}: InvoiceCorrectionFlowProps): ReactElement {
  const copy = useSubiektGtMessages().subiektInvoiceCorrectionFlow;
  const format = useFormat();
  const strong = { strong: (text: string) => <strong>{text}</strong> };
  const strongMono = { strong: (text: string) => <strong className="mono-text">{text}</strong> };
  const { showToast } = useToast();
  const mutation = useIssueCorrectionMutation();
  const acknowledgement = useWarningAcknowledgement(mutation.isPending);
  const { linesAreAuthoritative, query: contentQuery } = useInvoiceContentQuery(invoice.id);

  const reasonState = useCorrectionReason();
  const [lines, setLines] = useState<LineRow[]>([emptyRow()]);
  const [gridLines, setGridLines] = useState<CorrectionLineInput[]>([]);
  const [linesError, setLinesError] = useState<string | null>(null);

  // Stable per-dialog-mount key — collapses post-timeout retries / duplicate tabs
  // onto the same pending row so the same correcting document is never issued twice.
  const idempotencyKeyRef = useRef(
    `sk-corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );

  function updateLine(index: number, field: keyof LineRow, value: string): void {
    setLines((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
    if (linesError) setLinesError(null);
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
        setLinesError(copy.gridLinesRequired);
        return;
      }
      parsedLines = gridLines;
    } else {
      const parsed = parseLineRows(lines);
      if (parsed.length === 0) {
        setLinesError(copy.linesRequired);
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
              description: error.message,
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
    <div className="subiekt-correction">
      {/* Header */}
      <div className="subiekt-correction__head">
        <h3>{copy.title}</h3>
        <span className="section-card__provider">
          {copy.providerTag}
        </span>
      </div>

      {/* Original invoice reference */}
      <div className="corr__orig">
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
        name="sk"
        disabled={isSubmitting}
        className="subiekt-correction__reason"
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
          <div className="table-wrap subiekt-correction__table-scroll">
            <table className="lineitems">
              <thead>
                <tr>
                  <th>{copy.col.lp}</th>
                  <th className="subiekt-correction__col-qty">{copy.col.newQty}</th>
                  <th className="subiekt-correction__col-price">
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
                        className="input input--num input--w-qty"
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
                        className="input input--num input--w-price"
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

          <p className="corr-note subiekt-correction__note">
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
