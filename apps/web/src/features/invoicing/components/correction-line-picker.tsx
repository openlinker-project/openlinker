/**
 * CorrectionLinePicker (#2076)
 *
 * Lets an operator **pick** the invoice line a correction targets, instead of
 * typing its position into an empty box.
 *
 * Why this exists: every correction flow previously rendered a bare
 * `<input type="number" placeholder="1">` with no list of the invoice's lines
 * anywhere on screen. That produced a real bad fiscal document — an
 * `originalLineNumber: 99` typo minted a live corrective invoice at
 * `gross_price: 0`, which went to KSeF (reproduced 2026-07-29, recorded in
 * `infakt-invoicing.adapter.ts`). Out-of-range and duplicate numbers are now
 * guarded server-side, but an *in-range but wrong* number is unguardable there:
 * nothing can tell that the operator meant line 2 and typed 3. Picking removes
 * the class of error rather than validating it after the fact.
 *
 * The option's value is the line's **1-based position**, which is exactly what
 * `CorrectionLineInput.originalLineNumber` addresses — see
 * `useInvoiceContentQuery` for why this list and the server's snapshot share
 * indices.
 *
 * Degrades rather than blocks: when the invoice carries no content snapshot
 * (409 — pending, an adapter that captured none, or a pre-column row) it falls
 * back to manual entry with a visible warning. Stranding a real document would
 * be worse than the status quo for those rows.
 *
 * Shared by all three provider correction flows (inFakt / KSeF / Subiekt) via
 * the `features/invoicing` barrel — the defect was identical in each, and three
 * copies would triplicate the next fix.
 *
 * @module apps/web/src/features/invoicing/components
 */
import { useEffect, useId, type ReactElement } from 'react';
import { Select } from '../../../shared/ui/select';
import { useTranslation } from '../../../shared/i18n';
import type { IssuedDocumentLine } from '../api/invoicing.types';
import { useInvoiceContentQuery } from '../hooks/use-invoice-content-query';

export interface CorrectionLinePickerProps {
  /** Internal invoice id whose lines are being corrected. */
  invoiceId: string;
  /** Current 1-based line number, as a string (the flows keep form rows as strings). */
  value: string;
  /**
   * Called with the chosen 1-based line number. `line` is the picked line when
   * it came from the content snapshot, so a caller can prefill from it; it is
   * `undefined` on the manual-entry fallback.
   */
  onChange: (lineNumber: string, line?: IssuedDocumentLine) => void;
  disabled?: boolean;
  /** Accessible name — flows number their rows, so the caller supplies context. */
  ariaLabel: string;
}

/** Unit GROSS for a line. `LineDto` carries `unitNet`, but a correction asks for
 *  gross — deriving it here keeps the mismatch out of every call site. */
export function unitGrossOf(line: IssuedDocumentLine): number | undefined {
  if (!Number.isFinite(line.gross) || !Number.isFinite(line.quantity) || line.quantity === 0) {
    return undefined;
  }
  return line.gross / line.quantity;
}

/**
 * Option label. Shows the **unit gross**, because that is the number the
 * correction form asks for (`newUnitPriceGross`) — showing `unitNet`, which is
 * what the API returns, beside a gross-labelled input invites the same class of
 * error this component exists to remove.
 */
function describeLine(line: IssuedDocumentLine, position: number): string {
  const qty = Number.isFinite(line.quantity) ? line.quantity : '?';
  const unitGross = unitGrossOf(line);
  const unit = unitGross === undefined ? '?' : unitGross.toFixed(2);
  return `${position}. ${line.name} — ${qty} × ${unit}`;
}

export function CorrectionLinePicker({
  invoiceId,
  value,
  onChange,
  disabled,
  ariaLabel,
}: CorrectionLinePickerProps): ReactElement {
  const { t } = useTranslation();
  // Per-instance id: every flow supports "Add line", so N pickers mount with
  // the SAME invoiceId. Keying the warning off invoiceId would emit N identical
  // DOM ids and point every row's aria-describedby at the first one.
  const warningId = useId();
  const { query, contentUnavailable, fetchFailed, linesAreAuthoritative } =
    useInvoiceContentQuery(invoiceId);
  const lines = query.data?.lines;
  // Narrowed, not asserted: `pickableLines` is defined ONLY when the lines both
  // exist and are the array a correction will index, so the render below cannot
  // reach the picker without them.
  const pickableLines = linesAreAuthoritative ? lines : undefined;

  // A value that indexes no line must never reach submit: it is provably wrong
  // against the list just loaded, and NOT every provider guards it server-side
  // (inFakt 422s and KSeF throws, but Subiekt passes `originalLineNumber`
  // straight through to `lp`). Reachable because manual entry stays live while
  // the lines load — type 3, then the invoice turns out to have 2 lines.
  useEffect(() => {
    if (!pickableLines || value === '') return;
    const index = parseInt(value, 10) - 1;
    if (Number.isNaN(index) || !pickableLines[index]) {
      onChange('');
    }
  }, [pickableLines, value, onChange]);

  // Manual entry covers three states, each with its OWN copy — conflating them
  // would tell the operator something false. Deliberately NOT a disabled
  // placeholder control: a disabled field carrying the same accessible name
  // silently swallows anything typed during the fetch.
  if (!pickableLines) {
    const message = contentUnavailable
      ? t(
          'invoicing.correction.linesUnavailable',
          'Line list unavailable for this invoice — check the line number against the issued document before submitting.',
        )
      : fetchFailed
        ? t(
            'invoicing.correction.linesFetchFailed',
            'Could not load this invoice’s lines. Enter the line number manually, or reopen this form to try again.',
          )
        : // Content exists but a correction will NOT index it (an invoice issued
          // before the line-snapshot column): the server rebuilds the original
          // document from the order instead, so a position picked here would
          // address a different array. Showing a picker would be worse than
          // showing none.
          !query.isLoading && lines
          ? t(
              'invoicing.correction.linesNotAuthoritative',
              'This invoice predates line snapshots, so its lines cannot be matched reliably — enter the line number from the issued document.',
            )
          : null;

    return (
      <span className="correction-line-picker">
        <input
          type="number"
          className="input input--w-lp"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="1"
          min={1}
          step={1}
          aria-label={ariaLabel}
          aria-describedby={message ? warningId : undefined}
          disabled={disabled}
        />
        {message ? (
          <span id={warningId} className="correction-line-picker__warning">
            {message}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <Select
      className="input--w-lp"
      value={value}
      onChange={(e) => {
        const next = e.target.value;
        const index = parseInt(next, 10) - 1;
        onChange(next, Number.isNaN(index) ? undefined : pickableLines[index]);
      }}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      <option value="">{t('invoicing.correction.selectLine', 'Select a line…')}</option>
      {pickableLines.map((line, i) => (
        // Position is the identity here: two lines of the same product are
        // legitimately distinct rows, so index is the correct React key AND the
        // value the server addresses.
        <option key={i} value={String(i + 1)}>
          {describeLine(line, i + 1)}
        </option>
      ))}
    </Select>
  );
}
