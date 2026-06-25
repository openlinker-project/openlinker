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
 *  the single source of truth so the issued-state line in `OrderInvoicePanel`
 *  reuses the same labels instead of re-declaring them. Unknown adapter-supplied
 *  types fall back to the raw string (open-world). */
export const DOCUMENT_TYPE_LABEL_FALLBACK: Record<string, string> = {
  invoice: 'Invoice (faktura)',
  receipt: 'Receipt (paragon)',
};

interface DocumentTypeSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function DocumentTypeSelect({
  value,
  onChange,
  disabled = false,
}: DocumentTypeSelectProps): ReactElement {
  const { t } = useTranslation();
  return (
    <Select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
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
