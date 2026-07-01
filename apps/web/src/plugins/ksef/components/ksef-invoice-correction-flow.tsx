/**
 * KsefInvoiceCorrectionFlow (#1233)
 *
 * Per-provider `invoiceCorrectionFlow` slot for KSeF. Issues a KOR (faktura
 * korygująca) via `POST /invoices/:invoiceId/correct` (BE #1189). The
 * operator supplies:
 *   - an optional free-text reason;
 *   - per-line new quantity and/or new unit price gross.
 *
 * The form starts with ONE empty row and an "Add line" affordance for
 * multi-line corrections. Line numbers are entered explicitly (the FE has no
 * access to line-item detail from the neutral invoice record). The host dialog
 * owns the outer chrome; this component is content-only — call `onClose` to
 * close the dialog.
 *
 * @module plugins/ksef/components
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

export function KsefInvoiceCorrectionFlow({
  invoice,
  onClose,
  onCorrectionIssued,
}: InvoiceCorrectionFlowProps): ReactElement {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const mutation = useIssueCorrectionMutation();

  // Per-mount stable idempotency key — prevents duplicate KOR issuance on timeout/retry.
  const idempotencyKeyRef = useRef(
    `ksef-corr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );

  const [reason, setReason] = useState('');
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
    if (parsedLines.length === 0) {
      setLinesError(
        t(
          'ksef.correction.linesRequired',
          'At least one line with a line number is required.',
        ),
      );
      return;
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
            title: t('ksef.correction.issued', 'KOR issued'),
            description: t(
              'ksef.correction.issuedBody',
              'The correcting document was submitted to KSeF.',
            ),
          });
          onCorrectionIssued(correctionInvoice.id);
          onClose();
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: t('ksef.correction.failed', 'KOR failed'),
            description: error.message,
          });
        },
      },
    );
  }

  const isSubmitting = mutation.isPending;

  return (
    <div className="ksef-correction">
      {/* Header */}
      <div className="ksef-correction__head">
        <h3>{t('ksef.correction.title', 'Issue KOR correction')}</h3>
        <span className="section-card__provider">
          {t('ksef.correction.providerTag', 'KSeF · slot')}
        </span>
      </div>

      {/* Original invoice reference */}
      <div className="ksef-correction__orig">
        <span>
          {t('ksef.correction.correcting', 'Correcting')}{' '}
          <strong>{invoice.providerInvoiceNumber ?? invoice.id}</strong>
        </span>
        {invoice.clearanceReference ? (
          <span>
            {t('ksef.correction.ksefRef', 'KSeF')}{' '}
            <strong className="mono-text">
              {invoice.clearanceReference.slice(0, 14)}…
            </strong>
          </span>
        ) : null}
        {invoice.issuedAt ? (
          <span>
            {t('ksef.correction.issuedOn', 'Issued')}{' '}
            <strong className="mono-text">
              {invoice.issuedAt.slice(0, 10)}
            </strong>
          </span>
        ) : null}
      </div>

      {/* Reason */}
      <div className="field ksef-correction__reason">
        <label htmlFor="ksef-reason">
          {t('ksef.correction.reasonLabel', 'Reason for correction')}
        </label>
        <textarea
          id="ksef-reason"
          className="textarea"
          placeholder={t(
            'ksef.correction.reasonPlaceholder',
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
      <div className="ksef-correction__table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('ksef.correction.col.lp', 'Lp')}</th>
              <th className="ksef-correction__col-qty">
                {t('ksef.correction.col.newQty', 'New qty')}
              </th>
              <th className="ksef-correction__col-price">
                {t('ksef.correction.col.newPrice', 'New price')}
              </th>
              <th aria-label={t('ksef.correction.col.remove', 'Remove')} />
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
                    aria-label={`${t('ksef.correction.lineNum', 'Line number')} ${i + 1}`}
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
                    aria-label={`${t('ksef.correction.newQty', 'New qty, line')} ${i + 1}`}
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
                    aria-label={`${t('ksef.correction.newPrice', 'New price, line')} ${i + 1}`}
                    disabled={isSubmitting}
                  />
                </td>
                <td>
                  <Button
                    tone="secondary"
                    onClick={() => removeLine(i)}
                    disabled={lines.length === 1 || isSubmitting}
                    aria-label={`${t('ksef.correction.removeLine', 'Remove line')} ${i + 1}`}
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
        {t('ksef.correction.addLine', '+ Add line')}
      </Button>

      <p className="ksef-correction__note">
        {t(
          'ksef.correction.note',
          'A KOR document corrects quantity and/or price per line. KSeF assigns a clearance number; OpenLinker reconciles the status automatically.',
        )}
      </p>

      {/* Actions */}
      <div className="wizard__actions">
        <span className="wizard__spacer" />
        <Button tone="secondary" onClick={onClose} disabled={isSubmitting}>
          {t('ksef.correction.cancel', 'Cancel')}
        </Button>
        <Button tone="primary" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting
            ? t('ksef.correction.submitting', 'Issuing…')
            : t('ksef.correction.submit', 'Issue KOR')}
        </Button>
      </div>
    </div>
  );
}
