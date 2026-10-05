/**
 * CorrectionLineGrid (#3090, returns spec § 5.8)
 *
 * Renders one row per line the ISSUED document actually carries — read from
 * `useInvoiceContentQuery`, the same #2076 source `CorrectionLinePicker`
 * already trusts for this — instead of the operator typing a line number
 * blind. Three column groups per row: `As invoiced` (read-only), `After
 * correction` (the one editable qty × price pair), `Credit` (computed).
 *
 * **Renders `null` when the invoice's content is not authoritative** for a
 * correction (`useInvoiceContentQuery`'s `linesAreAuthoritative`) — pending,
 * an adapter that captured no snapshot, or a pre-#2076 row. The caller (each
 * provider's `InvoiceCorrectionFlow`) falls back to the pre-#3090 manual
 * line-number table in that case, exactly as `CorrectionLinePicker` already
 * degrades per-row. This component owns no fallback UI of its own.
 *
 * **Pre-fill comes from `suggestedLines`, never from a returns-feature
 * import.** `ReturnCorrectionProposal.lines` already carries, for a `matched`
 * line, which invoice position it resolves to (`selectedOriginalLineNumber`)
 * and the quantity that should remain after crediting it (`newQuantity`) —
 * computed server-side, nothing here re-derives it. The RETURNS feature maps
 * those onto `CorrectionSuggestedLine[]` before passing them down, so this
 * component (and the `invoicing` feature generally) never depends on
 * `features/returns` — `returns` already depends on `invoicing`, and the
 * reverse edge would close a cross-feature cycle.
 *
 * **A `disposition-not-confirmed` return line is deliberately NOT rendered
 * as a blocked row here.** The matcher refuses to resolve an invoice line for
 * it at all (`return-correction-matching.domain-service.ts`: `noMatch(line,
 * 'disposition-not-confirmed', [])` — no candidates, no
 * `selectedOriginalLineNumber`), so there is no invoice position to attach a
 * blocked state to. That exclusion, and every other `no-match` reason, stays
 * on the return-page panel the dialog was opened from (`RETURN_PROPOSAL_COPY`
 * already renders it) — this grid only ever shows lines a correction can
 * actually address.
 *
 * @module apps/web/src/features/invoicing/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNumberFormat, useTranslation } from '../../../shared/i18n';
import { unitGrossOf } from './correction-line-picker';
import { useInvoiceContentQuery } from '../hooks/use-invoice-content-query';
import type { CorrectionLineInput, IssuedDocumentLine } from '../api/invoicing.types';

/**
 * One invoice line a return proposal already resolved — the position it
 * matched, and the quantity that should remain after crediting it. Mirrors
 * the two fields of `ReturnCorrectionProposalLine` this grid actually needs,
 * so `invoicing` names its own shape rather than importing the returns one.
 */
export interface CorrectionSuggestedLine {
  /** 1-based position into the invoice's issued lines. */
  originalLineNumber: number;
  /** Quantity that should remain on the line once the returned units are credited. */
  suggestedQuantity: number;
}

export interface CorrectionLineGridProps {
  invoiceId: string;
  suggestedLines?: CorrectionSuggestedLine[];
  disabled?: boolean;
  onChange: (lines: CorrectionLineInput[]) => void;
}

interface RowState {
  qty: string;
  price: string;
}

function buildInitialRows(
  lines: IssuedDocumentLine[],
  suggestedLines: CorrectionSuggestedLine[] | undefined,
): Map<number, RowState> {
  const bySuggestedPosition = new Map((suggestedLines ?? []).map((s) => [s.originalLineNumber, s]));
  const rows = new Map<number, RowState>();
  lines.forEach((line, i) => {
    const position = i + 1;
    const suggested = bySuggestedPosition.get(position);
    const unitGross = unitGrossOf(line);
    rows.set(position, {
      qty: String(suggested?.suggestedQuantity ?? line.quantity),
      price: unitGross !== undefined ? unitGross.toFixed(2) : '',
    });
  });
  return rows;
}

export function CorrectionLineGrid({
  invoiceId,
  suggestedLines,
  disabled,
  onChange,
}: CorrectionLineGridProps): ReactElement | null {
  const { t } = useTranslation();
  const numberFormat = useNumberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const { query, linesAreAuthoritative } = useInvoiceContentQuery(invoiceId);
  const lines = linesAreAuthoritative ? query.data?.lines : undefined;

  const [rows, setRows] = useState<Map<number, RowState> | null>(null);

  // Every call site passes a fresh inline arrow on every render — held in a
  // ref (the CorrectionLinePicker precedent) so the emit effect below depends
  // only on the actual row state, never on the parent re-rendering.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Initialise once the lines load. `suggestedLines` is read only at this
  // moment — an operator's in-progress edits must not be clobbered by a
  // proposal refetch racing the dialog being open, and the suggestion is a
  // one-time starting point, not a value this grid keeps in sync with.
  //
  // `lines` DOES stay a dep — an ordinary background refetch while the
  // dialog is open (react-query's default `refetchOnWindowFocus: true`,
  // this app's 30s `staleTime`) must not re-run this and wipe an
  // in-progress edit. That is safe only because of TanStack Query's
  // `structuralSharing`: a refetch that resolves to a deeply-equal payload
  // keeps `query.data`'s object reference, so `lines` (derived from it
  // above) is unchanged and this effect does not re-fire. A refetch that
  // genuinely changed the content — a rare race, not the common case this
  // guards — legitimately re-initialises the grid.
  useEffect(() => {
    if (!lines) return;
    setRows(buildInitialRows(lines, suggestedLines));
    // `suggestedLines` is deliberately NOT a dep — see the comment above.
  }, [lines]);

  useEffect(() => {
    if (!lines || !rows) return;
    const result: CorrectionLineInput[] = [];
    lines.forEach((line, i) => {
      const position = i + 1;
      const row = rows.get(position);
      if (!row) return;
      const unitGross = unitGrossOf(line);
      const qty = row.qty.trim() === '' ? undefined : parseFloat(row.qty);
      const price = row.price.trim() === '' ? undefined : parseFloat(row.price);
      const qtyChanged = qty !== undefined && !Number.isNaN(qty) && qty !== line.quantity;
      const priceChanged =
        price !== undefined &&
        !Number.isNaN(price) &&
        unitGross !== undefined &&
        Math.abs(price - unitGross) > 0.005;
      if (qtyChanged || priceChanged) {
        result.push({
          originalLineNumber: position,
          ...(qtyChanged ? { newQuantity: qty } : {}),
          ...(priceChanged ? { newUnitPriceGross: price } : {}),
        });
      }
    });
    onChangeRef.current(result);
  }, [rows, lines]);

  if (!lines || !rows) {
    return null;
  }

  function updateRow(position: number, field: keyof RowState, value: string): void {
    setRows((prev) => {
      const next = new Map(prev ?? []);
      const current = next.get(position) ?? { qty: '', price: '' };
      next.set(position, { ...current, [field]: value });
      return next;
    });
  }

  const totalCredit = lines.reduce((sum, line, i) => {
    const position = i + 1;
    const row = rows.get(position);
    if (!row) return sum;
    const unitGross = unitGrossOf(line);
    if (unitGross === undefined) return sum;
    const qty = row.qty.trim() === '' ? line.quantity : parseFloat(row.qty);
    const price = row.price.trim() === '' ? undefined : parseFloat(row.price);
    const effectivePrice = price !== undefined && !Number.isNaN(price) ? price : unitGross;
    if (Number.isNaN(qty)) return sum;
    return sum + line.quantity * unitGross - qty * effectivePrice;
  }, 0);

  return (
    <div className="credit-grid__scroll">
      <table className="data-table credit-grid">
        <caption className="sr-only">
          {t(
            'invoicing.correction.gridCaption',
            'Invoice lines, in the order they appear on the issued document',
          )}
        </caption>
        <thead>
          <tr>
            <th className="credit-grid__lp">{t('invoicing.correction.col.lp', '#')}</th>
            <th>{t('invoicing.correction.col.item', 'Item')}</th>
            <th className="data-table__cell--right">
              {t('invoicing.correction.col.invoiced', 'As invoiced')}
            </th>
            <th className="data-table__cell--right">
              {t('invoicing.correction.col.after', 'After correction')}
            </th>
            <th className="data-table__cell--right">
              {t('invoicing.correction.col.credit', 'Credit')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const position = i + 1;
            const row = rows.get(position) ?? { qty: '', price: '' };
            const unitGross = unitGrossOf(line);
            const qty = row.qty.trim() === '' ? undefined : parseFloat(row.qty);
            const priceRaw = row.price.trim() === '' ? undefined : parseFloat(row.price);
            const effectivePrice =
              priceRaw !== undefined && !Number.isNaN(priceRaw) ? priceRaw : unitGross;
            const credit =
              unitGross !== undefined &&
              effectivePrice !== undefined &&
              qty !== undefined &&
              !Number.isNaN(qty)
                ? line.quantity * unitGross - qty * effectivePrice
                : 0;
            const touched =
              (qty !== undefined && !Number.isNaN(qty) && qty !== line.quantity) ||
              (priceRaw !== undefined &&
                !Number.isNaN(priceRaw) &&
                unitGross !== undefined &&
                Math.abs(priceRaw - unitGross) > 0.005);
            const untouched = !touched;
            return (
              <tr key={position} className={untouched ? 'credit-row--untouched' : undefined}>
                <td className="credit-grid__lp">{position}</td>
                <td>{line.name}</td>
                <td className="credit-cell--invoiced data-table__cell--right">
                  <span className="data-table__stack">
                    <span className="tabular">
                      {line.quantity} × {unitGross !== undefined ? numberFormat.format(unitGross) : '—'}
                    </span>
                    <span className="text-muted tabular">
                      {numberFormat.format(line.gross)} · {t('invoicing.correction.vat', 'VAT')}{' '}
                      {line.taxRate}
                    </span>
                  </span>
                </td>
                <td className="credit-cell--after data-table__cell--right">
                  <span className="credit-cell__pair">
                    <input
                      type="number"
                      className="input--w-qty tabular"
                      min={0}
                      step="any"
                      value={row.qty}
                      onChange={(e) => updateRow(position, 'qty', e.target.value)}
                      aria-label={`${t(
                        'invoicing.correction.afterQty',
                        'Quantity after correction, line',
                      )} ${position}`}
                      disabled={disabled}
                    />
                    <span className="credit-cell__times" aria-hidden="true">
                      ×
                    </span>
                    <input
                      type="number"
                      className="input--w-price tabular"
                      min={0}
                      step="0.01"
                      value={row.price}
                      onChange={(e) => updateRow(position, 'price', e.target.value)}
                      aria-label={`${t(
                        'invoicing.correction.afterPrice',
                        'Unit price after correction, line',
                      )} ${position}`}
                      disabled={disabled}
                    />
                  </span>
                </td>
                <td className="credit-cell--credit data-table__cell--right">
                  {credit !== 0 ? (
                    <span className="mono-text tabular">{numberFormat.format(-credit)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="data-table__cell--right">
              {t('invoicing.correction.totalCredit', 'Total credit')}
            </td>
            <td className="credit-cell--credit data-table__cell--right">
              <span className="mono-text tabular">{numberFormat.format(-totalCredit)}</span>
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="ksef-correction__note">
        {t(
          'invoicing.correction.gridNote',
          'Enter the quantity and unit price that should be on the invoice — quantity 0 credits the whole line, and a lower price credits the difference without anything being returned. Figures are a preview; your invoicing provider calculates the final amounts on the document.',
        )}
      </p>
    </div>
  );
}
