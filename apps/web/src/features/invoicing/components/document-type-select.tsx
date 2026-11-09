/**
 * Document Type Select (#757, narrowed — review finding)
 *
 * Small controlled `<Select>` feeding `documentType` into the INVOICE issue
 * call (`InvoicingPort.issueInvoice`). Offers `invoice` ONLY: no
 * `InvoicingPort` adapter in the tree (KSeF, inFakt, Subiekt) issues a
 * `receipt` document type — a fiscal receipt is a `FiscalizationPort`
 * concept entirely, reached through the separate "Register receipt" card,
 * never through this one. The picker used to also offer "Receipt (paragon)"
 * here, which sent `documentType: 'receipt'` straight to an invoicing
 * adapter that has no idea what that means — a capability mismatch the
 * picker itself should never have been able to construct.
 *
 * `DOCUMENT_TYPE_LABEL_FALLBACK` stays the wider six-value map (unchanged) —
 * it labels whatever a provider already issued on read-back surfaces
 * (invoices list / detail, `SalesDocumentPanel`'s issued state), which is a
 * different question from what an operator may newly SELECT here.
 *
 * @module apps/web/src/features/invoicing/components
 */
import type { ReactElement } from 'react';
import { Select } from '../../../shared/ui/select';
import { getMessages, useMessages } from '../../../shared/i18n';

/** The only document type any shipped `InvoicingPort` adapter actually issues. */
const OPTIONS = ['invoice'] as const;

/** Labels for the well-known document types, read from copy. Exported as
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
  get invoice() {
    return getMessages('invoicing').invoice.documentType.invoice;
  },
  get receipt() {
    return getMessages('invoicing').invoice.documentType.receipt;
  },
  get corrected() {
    return getMessages('invoicing').invoice.documentType.corrected;
  },
  get 'credit-note'() {
    return getMessages('invoicing').invoice.documentType['credit-note'];
  },
  get proforma() {
    return getMessages('invoicing').invoice.documentType.proforma;
  },
  get prepayment() {
    return getMessages('invoicing').invoice.documentType.prepayment;
  },
};

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
  const copy = useMessages('invoicing').invoice.documentType;
  return (
    <Select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      aria-label={copy.label}
    >
      {OPTIONS.map((option) => (
        <option key={option} value={option}>
          {copy[option]}
        </option>
      ))}
    </Select>
  );
}
