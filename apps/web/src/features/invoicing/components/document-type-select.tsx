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

const LABEL_FALLBACK: Record<(typeof OPTIONS)[number], string> = {
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
          {t(`invoice.documentType.${option}`, LABEL_FALLBACK[option])}
        </option>
      ))}
    </Select>
  );
}
