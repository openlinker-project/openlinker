/**
 * Document Type Select (#757)
 *
 * Small controlled `<Select>` of well-known document types — `invoice` /
 * `receipt` surfaced in PL as faktura / paragon via `t()`. The selected value
 * feeds `documentType` into the issue call. Ephemeral action input (local
 * `useState` in the panel), not a persisted form (plan §2.5).
 *
 * @module apps/web/src/features/invoicing/components
 */
import type { ReactElement } from 'react';
import { Select } from '../../../shared/ui/select';
import { useTranslation } from '../../../shared/i18n';

/** Operator-selectable document types in v1 (subset of `DocumentTypeValues`). */
const OPTIONS = ['invoice', 'receipt'] as const;

/** EN fallbacks for the well-known document types (PL via `t()`). Exported as
 *  the single source of truth so the issued-state line in the `orders` feature's
 *  `SalesDocumentPanel` (#2160, previously `OrderInvoicePanel`) reuses the same
 *  labels instead of re-declaring them. Unknown adapter-supplied
 *  types fall back to the raw string (open-world).
 *
 *  Covers all six of `DocumentTypeValues`, not just the two this picker offers
 *  (#2090): the map is read by the invoices list, the invoice detail page and
 *  `SalesDocumentPanel`, which render whatever a provider issued — Subiekt issues
 *  `credit-note`, KSeF and inFakt issue `corrected`, inFakt also `proforma`. With
 *  only `invoice`/`receipt` mapped, a correction read as the raw slug
 *  `corrected` on all three surfaces, and telling a correction from an original
 *  is the one distinction an accountant needs at a glance. */
export const DOCUMENT_TYPE_LABEL_FALLBACK: Record<string, string> = {
  invoice: 'Invoice (faktura)',
  receipt: 'Receipt (paragon)',
  corrected: 'Correction (korekta)',
  'credit-note': 'Credit note (nota kredytowa)',
  proforma: 'Proforma (faktura pro forma)',
  prepayment: 'Prepayment (faktura zaliczkowa)',
};

/** Shown where `documentType` is the empty string — the state a record carries
 *  between creation and a successful issue (`InvoiceService` writes
 *  `cmd.documentType ?? ''` on the pending row and the failure patch never
 *  backfills it), which means every `pending` / `issuing` / `failed` row. Both
 *  production issuance paths omit the type, so this is the common case on a
 *  triage-filtered list, not an edge (#2090). */
export const DOCUMENT_TYPE_UNKNOWN_LABEL = 'Not yet issued';

interface DocumentTypeSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Forwarded to the underlying `<Select>` so the panel can control layout
   *  (e.g. flex-grow the picker to fill the action row). */
  className?: string;
}

export function DocumentTypeSelect({
  value,
  onChange,
  disabled = false,
  className,
}: DocumentTypeSelectProps): ReactElement {
  const { t } = useTranslation();
  return (
    <Select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      aria-label={t('invoice.documentType.label', 'Document type')}
    >
      {OPTIONS.map((option) => (
        <option key={option} value={option}>
          {t(`invoice.documentType.${option}`, DOCUMENT_TYPE_LABEL_FALLBACK[option])}
        </option>
      ))}
    </Select>
  );
}
