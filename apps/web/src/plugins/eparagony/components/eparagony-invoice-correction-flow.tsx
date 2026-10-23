/**
 * EparagonyInvoiceCorrectionFlow (#3193)
 *
 * Per-provider `invoiceCorrectionFlow` slot for eparagony.pl. Issues an
 * `eCorrectiveInvoice` via the same generic capability-gated endpoint the
 * KSeF/inFakt/Subiekt slots use (`POST /invoices/:invoiceId/correct`, backed
 * here by `EparagonyInvoicingAdapter` implementing `CorrectionIssuer`,
 * #3193). The operator supplies:
 *   - an optional free-text reason;
 *   - per-line new quantity and/or new unit price gross.
 *
 * **The line table is the shared `CorrectionLineGrid` (#3090) whenever the
 * invoice's content is authoritative** — same as the other three providers
 * (PR #3379 review: this was the fourth `InvoiceCorrectionFlow` and had been
 * left on the pre-#3090 manual table). When the content is NOT authoritative
 * (`useInvoiceContentQuery`), this flow falls back to the original manual
 * table below — ONE empty row, `+ Add line`, a `CorrectionLinePicker` per
 * row. The host dialog owns the outer chrome; this component is
 * content-only — call `onClose` to close the dialog.
 *
 * The explainer copy deliberately says "the provider" / "the national
 * e-invoicing hub" rather than naming KSeF directly — the same restraint
 * `EparagonyInvoiceDetailSection` already exercises, because the vendor is a
 * relay rather than the authority (see that file's header) and this slot
 * should not assert a mechanism the adapter itself declines to name in its
 * own operator-facing copy.
 *
 * @module plugins/eparagony/components
 */
import { type ReactElement, useRef, useState } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import type { InvoiceCorrectionFlowProps } from '../../../shared/plugins/plugin.types';
import {
  CorrectionLineGrid,
  CorrectionLinePicker,
  useInvoiceContentQuery,
  useIssueCorrectionMutation,
  type CorrectionLineInput,
} from '../../../features/invoicing';

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

export function EparagonyInvoiceCorrectionFlow({
  invoice,
  onClose,
  onCorrectionIssued,
  suggestedLines,
}: InvoiceCorrectionFlowProps): ReactElement {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const mutation = useIssueCorrectionMutation();
  // Same read `CorrectionLineGrid` uses internally — resolved here too so this
  // component can decide WHICH table to render (react-query dedupes the
  // fetch by query key, so this costs no extra request).
  const { linesAreAuthoritative, query: contentQuery } = useInvoiceContentQuery(invoice.id);

  // Per-mount stable idempotency key — prevents duplicate correction issuance
  // on timeout/retry (the eparagony adapter derives a distinct
  // documentToken/transactionToken pair from it, namespaced away from the
  // original invoice's own tokens).
  const idempotencyKeyRef = useRef(
    `eparagony-corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );

  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<LineRow[]>([emptyRow()]);
  const [gridLines, setGridLines] = useState<CorrectionLineInput[]>([]);
  const [linesError, setLinesError] = useState<string | null>(null);

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
      // Every row in the grid already differs from what is on the document,
      // or it would not be in `gridLines` at all (see CorrectionLineGrid) —
      // there is nothing to parse, only a "did anything change" check.
      if (gridLines.length === 0) {
        setLinesError(
          t(
            'eparagony.correction.gridLinesRequired',
            'Change at least one line’s quantity or price before issuing a correction.',
          ),
        );
        return;
      }
      parsedLines = gridLines;
    } else {
      const parsed = parseLineRows(lines);
      if (parsed === null) {
        setLinesError(
          t(
            'eparagony.correction.lineDeltaRequired',
            'Each line must specify a new quantity and/or a new price.',
          ),
        );
        return;
      }
      if (parsed.length === 0) {
        setLinesError(
          t(
            'eparagony.correction.linesRequired',
            'At least one line with a line number is required.',
          ),
        );
        return;
      }
      parsedLines = parsed;
    }
    setLinesError(null);
    mutation.mutate(
      {
        invoiceId: invoice.id,
        input: {
          reason: reason.trim() !== '' ? reason.trim() : undefined,
          lines: parsedLines,
          idempotencyKey: idempotencyKeyRef.current,
        },
      },
      {
        onSuccess: (correctionInvoice) => {
          showToast({
            tone: 'success',
            title: t('eparagony.correction.issued', 'Correction issued'),
            description: t(
              'eparagony.correction.issuedBody',
              'The correcting document was submitted to the provider.',
            ),
          });
          onCorrectionIssued(correctionInvoice.id);
          onClose();
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: t('eparagony.correction.failed', 'Correction failed'),
            description: error.message,
          });
        },
      },
    );
  }

  const isSubmitting = mutation.isPending;

  return (
    <div className="eparagony-correction">
      {/* Header */}
      <div className="eparagony-correction__head">
        <h3>{t('eparagony.correction.title', 'Issue correction')}</h3>
        <span className="section-card__provider">
          {t('eparagony.correction.providerTag', 'eparagony.pl · slot')}
        </span>
      </div>

      {/* Original invoice reference */}
      <div className="eparagony-correction__orig">
        <span>
          {t('eparagony.correction.correcting', 'Correcting')}{' '}
          <strong>{invoice.providerInvoiceNumber ?? invoice.id}</strong>
        </span>
        {invoice.clearanceReference ? (
          <span>
            {t('eparagony.correction.clearanceRef', 'Clearance ref.')}{' '}
            <strong className="mono-text">{invoice.clearanceReference.slice(0, 14)}…</strong>
          </span>
        ) : null}
        {invoice.issuedAt ? (
          <span>
            {t('eparagony.correction.issuedOn', 'Issued')}{' '}
            <strong className="mono-text">{invoice.issuedAt.slice(0, 10)}</strong>
          </span>
        ) : null}
      </div>

      {/* Reason */}
      <div className="field eparagony-correction__reason">
        <label htmlFor="eparagony-reason">
          {t('eparagony.correction.reasonLabel', 'Reason for correction')}
        </label>
        <textarea
          id="eparagony-reason"
          className="textarea"
          placeholder={t(
            'eparagony.correction.reasonPlaceholder',
            'e.g. Partial return of the order',
          )}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isSubmitting}
          rows={3}
        />
      </div>

      {/* Line items */}
      {linesError ? (
        <p className="error-text" role="alert">
          {linesError}
        </p>
      ) : null}

      {contentQuery.isLoading ? (
        <p className="text-muted">{t('eparagony.correction.loadingLines', 'Loading invoice lines…')}</p>
      ) : linesAreAuthoritative ? (
        <CorrectionLineGrid
          invoiceId={invoice.id}
          suggestedLines={suggestedLines}
          disabled={isSubmitting}
          onChange={setGridLines}
        />
      ) : (
        <>
          <div className="eparagony-correction__table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('eparagony.correction.col.lp', 'Lp')}</th>
                  <th className="eparagony-correction__col-qty">
                    {t('eparagony.correction.col.newQty', 'New qty')}
                  </th>
                  <th className="eparagony-correction__col-price">
                    {t('eparagony.correction.col.newPrice', 'New gross')}
                  </th>
                  <th aria-label={t('eparagony.correction.col.remove', 'Remove')} />
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
                        ariaLabel={`${t('eparagony.correction.lineNum', 'Line number')} ${i + 1}`}
                        disabled={isSubmitting}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="input input--w-qty"
                        value={row.newQuantity}
                        onChange={(e) => updateLine(i, 'newQuantity', e.target.value)}
                        placeholder="—"
                        min={0}
                        step="any"
                        aria-label={`${t('eparagony.correction.newQty', 'New qty, line')} ${i + 1}`}
                        disabled={isSubmitting}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="input input--w-price"
                        value={row.newUnitPriceGross}
                        onChange={(e) => updateLine(i, 'newUnitPriceGross', e.target.value)}
                        placeholder="—"
                        min={0}
                        step="any"
                        aria-label={`${t('eparagony.correction.newPrice', 'New gross, line')} ${i + 1}`}
                        disabled={isSubmitting}
                      />
                    </td>
                    <td>
                      <Button
                        tone="secondary"
                        onClick={() => removeLine(i)}
                        disabled={lines.length === 1 || isSubmitting}
                        aria-label={`${t('eparagony.correction.removeLine', 'Remove line')} ${i + 1}`}
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
            {t('eparagony.correction.addLine', '+ Add line')}
          </Button>

          <p className="eparagony-correction__note">
            {t(
              'eparagony.correction.note',
              'A correcting document adjusts quantity and/or price per line. The provider submits it on your behalf; OpenLinker tracks the status.',
            )}
          </p>
        </>
      )}

      {/* Actions */}
      <div className="wizard__actions">
        <span className="wizard__spacer" />
        <Button tone="secondary" onClick={onClose} disabled={isSubmitting}>
          {t('eparagony.correction.cancel', 'Cancel')}
        </Button>
        <Button tone="primary" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting
            ? t('eparagony.correction.submitting', 'Issuing…')
            : t('eparagony.correction.submit', 'Issue correction')}
        </Button>
      </div>
    </div>
  );
}
