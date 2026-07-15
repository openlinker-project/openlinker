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
 * The form starts with ONE empty row and an "Add line" affordance for
 * multi-line corrections. Near-1:1 port of `KsefInvoiceCorrectionFlow` — same
 * line-row model, same generic `useIssueCorrectionMutation` hook, same
 * `InvoiceCorrectionFlowProps` slot contract. The host dialog owns the outer
 * chrome; this component is content-only — call `onClose` to close the
 * dialog.
 *
 * @module plugins/infakt/components
 */
import { type ReactElement, useRef, useState } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import type { InvoiceCorrectionFlowProps } from '../../../shared/plugins/plugin.types';
import {
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

export function InfaktInvoiceCorrectionFlow({
  invoice,
  onClose,
  onCorrectionIssued,
}: InvoiceCorrectionFlowProps): ReactElement {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const mutation = useIssueCorrectionMutation();

  // Per-mount stable idempotency key — prevents duplicate KOR issuance on timeout/retry.
  const idempotencyKeyRef = useRef(
    `infakt-corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );

  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [lines, setLines] = useState<LineRow[]>([emptyRow()]);
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
    const parsedLines = parseLineRows(lines);
    if (parsedLines === null) {
      setLinesError(
        t(
          'infakt.correction.lineDeltaRequired',
          'Each line must specify a new quantity and/or a new price.',
        ),
      );
      return;
    }
    if (parsedLines.length === 0) {
      setLinesError(
        t(
          'infakt.correction.linesRequired',
          'At least one line with a line number is required.',
        ),
      );
      return;
    }
    setLinesError(null);
    // #1582: the correction reason is legally required and must be non-empty
    // (art. 106j ust. 2 pkt 5 / FA(3) XSD PrzyczynaKorekty minLength=1). Checked
    // after line validation so a line problem surfaces its own error first.
    const trimmedReason = reason.trim();
    if (trimmedReason === '') {
      setReasonError(
        t('infakt.correction.reasonRequired', 'A reason for the correction is required.'),
      );
      return;
    }
    setReasonError(null);
    mutation.mutate(
      {
        invoiceId: invoice.id,
        input: {
          reason: trimmedReason,
          lines: parsedLines,
          idempotencyKey: idempotencyKeyRef.current,
        },
      },
      {
        onSuccess: (correctionInvoice) => {
          showToast({
            tone: 'success',
            title: t('infakt.correction.issued', 'KOR issued'),
            description: t(
              'infakt.correction.issuedBody',
              'The correcting document was submitted to KSeF via inFakt.',
            ),
          });
          onCorrectionIssued(correctionInvoice.id);
          onClose();
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: t('infakt.correction.failed', 'KOR failed'),
            description: error.message,
          });
        },
      },
    );
  }

  const isSubmitting = mutation.isPending;

  return (
    <div className="infakt-correction">
      {/* Header */}
      <div className="infakt-correction__head">
        <h3>{t('infakt.correction.title', 'Issue KOR correction')}</h3>
        <span className="section-card__provider">
          {t('infakt.correction.providerTag', 'inFakt · slot')}
        </span>
      </div>

      {/* Original invoice reference */}
      <div className="infakt-correction__orig">
        <span>
          {t('infakt.correction.correcting', 'Correcting')}{' '}
          <strong>{invoice.providerInvoiceNumber ?? invoice.id}</strong>
        </span>
        {invoice.clearanceReference ? (
          <span>
            {t('infakt.correction.ksefRef', 'KSeF')}{' '}
            <strong className="mono-text">
              {invoice.clearanceReference.slice(0, 14)}…
            </strong>
          </span>
        ) : null}
        {invoice.issuedAt ? (
          <span>
            {t('infakt.correction.issuedOn', 'Issued')}{' '}
            <strong className="mono-text">
              {invoice.issuedAt.slice(0, 10)}
            </strong>
          </span>
        ) : null}
      </div>

      {/* Reason */}
      <div className="field infakt-correction__reason">
        <label htmlFor="infakt-reason">
          {t('infakt.correction.reasonLabel', 'Reason for correction')}
        </label>
        <textarea
          id="infakt-reason"
          className="textarea"
          placeholder={t(
            'infakt.correction.reasonPlaceholder',
            'e.g. Partial return of the order',
          )}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isSubmitting}
          rows={3}
          aria-invalid={reasonError !== null}
        />
        {reasonError ? (
          <p className="error-text" role="alert">
            {reasonError}
          </p>
        ) : null}
      </div>

      {/* Line items */}
      {linesError ? (
        <p className="error-text" role="alert">
          {linesError}
        </p>
      ) : null}
      <div className="infakt-correction__table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('infakt.correction.col.lp', 'Lp')}</th>
              <th className="infakt-correction__col-qty">
                {t('infakt.correction.col.newQty', 'New qty')}
              </th>
              <th className="infakt-correction__col-price">
                {t('infakt.correction.col.newPrice', 'New price')}
              </th>
              <th aria-label={t('infakt.correction.col.remove', 'Remove')} />
            </tr>
          </thead>
          <tbody>
            {lines.map((row, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="number"
                    className="input input--w-lp"
                    value={row.originalLineNumber}
                    onChange={(e) => updateLine(i, 'originalLineNumber', e.target.value)}
                    placeholder="1"
                    min={1}
                    step={1}
                    aria-label={`${t('infakt.correction.lineNum', 'Line number')} ${i + 1}`}
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
                    aria-label={`${t('infakt.correction.newQty', 'New qty, line')} ${i + 1}`}
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
                    aria-label={`${t('infakt.correction.newPrice', 'New price, line')} ${i + 1}`}
                    disabled={isSubmitting}
                  />
                </td>
                <td>
                  <Button
                    tone="secondary"
                    onClick={() => removeLine(i)}
                    disabled={lines.length === 1 || isSubmitting}
                    aria-label={`${t('infakt.correction.removeLine', 'Remove line')} ${i + 1}`}
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
        {t('infakt.correction.addLine', '+ Add line')}
      </Button>

      <p className="infakt-correction__note">
        {t(
          'infakt.correction.note',
          'A KOR document corrects quantity and/or price per line. inFakt submits it to KSeF; OpenLinker reconciles the status automatically.',
        )}
      </p>

      {/* Actions */}
      <div className="wizard__actions">
        <span className="wizard__spacer" />
        <Button tone="secondary" onClick={onClose} disabled={isSubmitting}>
          {t('infakt.correction.cancel', 'Cancel')}
        </Button>
        <Button tone="primary" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting
            ? t('infakt.correction.submitting', 'Issuing…')
            : t('infakt.correction.submit', 'Issue KOR')}
        </Button>
      </div>
    </div>
  );
}
