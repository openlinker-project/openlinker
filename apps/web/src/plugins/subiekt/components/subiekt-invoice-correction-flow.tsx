/**
 * SubiektInvoiceCorrectionFlow (#1241)
 *
 * Per-provider `invoiceCorrectionFlow` slot for Subiekt. Issues a correcting
 * document (faktura korygująca) via the #1241 HTTP endpoint
 * `POST /invoices/:invoiceId/correct`. The operator supplies:
 *   - an optional free-text reason;
 *   - per-line new quantity and/or new unit price gross.
 *
 * The mockup shows N rows pre-populated from the original invoice lines. Since
 * the FE has no access to line-item detail (the invoice record carries only the
 * provider invoice ID), the operator enters line numbers explicitly. The form
 * starts with ONE empty row and an "Add line" affordance for multi-line
 * corrections. The host dialog owns the outer chrome; this component is
 * content-only — call `onClose` to close the dialog.
 *
 * @module plugins/subiekt/components
 */
import { type ReactElement, useState } from 'react';
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

export function SubiektInvoiceCorrectionFlow({
  invoice,
  onClose,
  onCorrectionIssued,
}: InvoiceCorrectionFlowProps): ReactElement {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const mutation = useIssueCorrectionMutation();

  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<LineRow[]>([emptyRow()]);

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
    mutation.mutate(
      {
        invoiceId: invoice.id,
        input: {
          reason: reason.trim() !== '' ? reason.trim() : undefined,
          lines: parsedLines,
        },
      },
      {
        onSuccess: (correctionInvoice) => {
          showToast({
            tone: 'success',
            title: t('subiekt.correction.issued', 'Correction issued'),
            description: t(
              'subiekt.correction.issuedBody',
              'The correcting document was sent to Subiekt.',
            ),
          });
          onCorrectionIssued(correctionInvoice.id);
          onClose();
        },
        onError: (error) => {
          showToast({
            tone: 'error',
            title: t('subiekt.correction.failed', 'Correction failed'),
            description: error.message,
          });
        },
      },
    );
  }

  const isSubmitting = mutation.isPending;

  return (
    <div className="subiekt-correction">
      {/* Header */}
      <div className="section-card__head" style={{ border: 0, padding: '0 0 var(--space-3)' }}>
        <h3>{t('subiekt.correction.title', 'Issue correction')}</h3>
        <span className="section-card__provider">
          {t('subiekt.correction.providerTag', 'Subiekt · slot')}
        </span>
      </div>

      {/* Original invoice reference */}
      <div className="corr__orig">
        <span>
          {t('subiekt.correction.correcting', 'Correcting')}{' '}
          <strong>{invoice.providerInvoiceNumber ?? invoice.id}</strong>
        </span>
        {invoice.clearanceReference ? (
          <span>
            {t('subiekt.correction.ksefRef', 'KSeF')}{' '}
            <strong className="mono-text">
              {invoice.clearanceReference.slice(0, 14)}…
            </strong>
          </span>
        ) : null}
        {invoice.issuedAt ? (
          <span>
            {t('subiekt.correction.issued', 'Issued')}{' '}
            <strong className="mono-text">
              {invoice.issuedAt.slice(0, 10)}
            </strong>
          </span>
        ) : null}
      </div>

      {/* Reason */}
      <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
        <label htmlFor="sk-reason">
          {t('subiekt.correction.reasonLabel', 'Reason for correction')}
        </label>
        <textarea
          id="sk-reason"
          className="textarea"
          placeholder={t(
            'subiekt.correction.reasonPlaceholder',
            'e.g. Partial return of the order',
          )}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isSubmitting}
          rows={3}
        />
      </div>

      {/* Line items */}
      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table className="lineitems">
          <thead>
            <tr>
              <th>{t('subiekt.correction.col.lp', 'Lp')}</th>
              <th style={{ minWidth: '80px' }}>{t('subiekt.correction.col.newQty', 'New qty')}</th>
              <th style={{ minWidth: '100px' }}>
                {t('subiekt.correction.col.newPrice', 'New net')}
              </th>
              <th aria-label={t('subiekt.correction.col.remove', 'Remove')} />
            </tr>
          </thead>
          <tbody>
            {lines.map((row, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="number"
                    className="input input--num"
                    value={row.originalLineNumber}
                    onChange={(e) => updateLine(i, 'originalLineNumber', e.target.value)}
                    placeholder="1"
                    min={1}
                    step={1}
                    aria-label={`${t('subiekt.correction.lineNum', 'Line number')} ${i + 1}`}
                    disabled={isSubmitting}
                    style={{ width: '60px' }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="input input--num"
                    value={row.newQuantity}
                    onChange={(e) => updateLine(i, 'newQuantity', e.target.value)}
                    placeholder="—"
                    min={0}
                    step="any"
                    aria-label={`${t('subiekt.correction.newQty', 'New qty, line')} ${i + 1}`}
                    disabled={isSubmitting}
                    style={{ width: '80px' }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="input input--num"
                    value={row.newUnitPriceGross}
                    onChange={(e) => updateLine(i, 'newUnitPriceGross', e.target.value)}
                    placeholder="—"
                    min={0}
                    step="any"
                    aria-label={`${t('subiekt.correction.newPrice', 'New net, line')} ${i + 1}`}
                    disabled={isSubmitting}
                    style={{ width: '100px' }}
                  />
                </td>
                <td>
                  <Button
                    tone="secondary"
                    onClick={() => removeLine(i)}
                    disabled={lines.length === 1 || isSubmitting}
                    aria-label={`${t('subiekt.correction.removeLine', 'Remove line')} ${i + 1}`}
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
        {t('subiekt.correction.addLine', '+ Add line')}
      </Button>

      <p className="corr-note" style={{ marginTop: 'var(--space-3)' }}>
        {t(
          'subiekt.correction.note',
          'A correcting invoice (faktura korygująca) can adjust quantity and/or price per line — e.g. a returned unit or a post-sale price reduction. Subiekt transmits the correction to KSeF; OpenLinker tracks the status.',
        )}
      </p>

      {/* Actions */}
      <div className="wizard__actions">
        <span style={{ flex: 1 }} />
        <Button tone="secondary" onClick={onClose} disabled={isSubmitting}>
          {t('subiekt.correction.cancel', 'Cancel')}
        </Button>
        <Button tone="primary" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting
            ? t('subiekt.correction.submitting', 'Issuing…')
            : t('subiekt.correction.submit', 'Issue correction')}
        </Button>
      </div>
    </div>
  );
}
