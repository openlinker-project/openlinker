/**
 * KSeF numbering — display constants + KSeF-specific document routing
 *
 * KSeF-owned presentation for the neutral numbering surface: document-type
 * labels, the reset-policy labels, the pattern-variable legend, the sequence
 * status labels + tones, the seller timezone the preview renders in, the
 * FA(3) `P_2` rendered-length limit, and the KSeF FA(3) document variants the
 * routing card exposes. Kept in the plugin (not the neutral feature) because the
 * KSeF-code labels (VAT / KOR / ZAL) and the Europe/Warsaw timezone are national
 * specifics that must not leak into `libs/core` or `features/invoicing`.
 *
 * @module plugins/ksef/components
 */
import {
  NumberingPatternVariableValues,
  type DocumentType,
  type NumberingPatternVariable,
  type NumberingSeqStatus,
  type ResetPolicy,
} from '../../../features/invoicing';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

/**
 * Seller timezone KSeF documents are dated in. The preview resolves date
 * variables here so the rendered number matches the number the server allocates
 * from the invoice's issue date.
 */
export const KSEF_TIME_ZONE = 'Europe/Warsaw';

/**
 * FA(3) `P_2` (invoice number) maximum rendered length. A pattern that renders
 * longer would only fail at KSeF, so the editor meters against it to fail early.
 */
export const FA3_P2_MAX_LENGTH = 256;

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  'credit-note': 'Credit note',
  corrected: 'Correction',
  proforma: 'Proforma',
  prepayment: 'Advance',
};

export const RESET_POLICY_LABELS: Record<ResetPolicy, string> = {
  none: 'Never',
  daily: 'Daily',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

/** Clickable pattern-variable chips in the editor (includes {DD} and {FY}). */
export const NUMBERING_VARIABLE_CHIPS = NumberingPatternVariableValues;

export const VARIABLE_LEGEND: Record<NumberingPatternVariable, string> = {
  '{seq}': 'Sequence number',
  '{YYYY}': '4-digit year',
  '{YY}': '2-digit year',
  '{FY}': 'Fiscal year',
  '{MM}': 'Month 01-12',
  '{QQ}': 'Quarter 1-4',
  '{DD}': 'Day 01-31',
};

export const SEQ_STATUS_LABELS: Record<NumberingSeqStatus, string> = {
  issued: 'Issued',
  pending: 'Pending',
  abandoned: 'Abandoned',
  skipped: 'Skipped',
};

export const SEQ_STATUS_TONES: Record<NumberingSeqStatus, StatusBadgeTone> = {
  issued: 'success',
  pending: 'info',
  abandoned: 'warning',
  skipped: 'warning',
};

/**
 * KSeF FA(3) document variants the routing card exposes. VAT / KOR / ZAL map to
 * the neutral document types the API accepts; the settlement variant (ROZ) has
 * no neutral document type yet and is intentionally omitted until one exists.
 */
export interface KsefRoutedDocumentType {
  documentType: DocumentType;
  code: string;
  label: string;
  hint: string;
}

export const KSEF_ROUTED_DOCUMENT_TYPES: readonly KsefRoutedDocumentType[] = [
  {
    documentType: 'invoice',
    code: 'VAT',
    label: 'Standard invoice',
    hint: 'Regular sales invoices (FA VAT).',
  },
  {
    documentType: 'corrected',
    code: 'KOR',
    label: 'Correction',
    hint: 'Correcting invoices — kept on their own series so a correction never reuses the original number.',
  },
  {
    documentType: 'prepayment',
    code: 'ZAL',
    label: 'Advance',
    hint: 'Advance / prepayment invoices (FA ZAL).',
  },
  {
    documentType: 'proforma',
    code: 'PRO',
    label: 'Proforma',
    hint: 'Proforma documents (no legal numbering requirement).',
  },
];

/**
 * Month options for the "fiscal year starts in" picker (#1692), shown only when
 * the pattern uses `{FY}`. Value is the 1-12 calendar month; label is its name.
 */
export const FISCAL_YEAR_START_MONTHS: readonly { value: number; label: string }[] = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

export function resetCaption(resetPolicy: ResetPolicy): string {
  return resetPolicy === 'none'
    ? 'never resets'
    : `resets ${RESET_POLICY_LABELS[resetPolicy].toLowerCase()}`;
}

export function documentTypeLabel(documentType: string): string {
  return (DOCUMENT_TYPE_LABELS as Record<string, string>)[documentType] ?? documentType;
}
