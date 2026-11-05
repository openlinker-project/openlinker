/**
 * KSeF numbering - display constants + KSeF-specific document routing
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
  DocumentTypeValues,
  NumberingPatternVariableValues,
  NumberingSeqStatusValues,
  ResetPolicyValues,
  type DocumentType,
  type NumberingPatternVariable,
  type NumberingSeqStatus,
  type ResetPolicy,
} from '../../../features/invoicing';
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import { getKsefMessages } from '../messages';

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

type LibCopy = ReturnType<typeof getKsefMessages>['ksefNumberingLib'];

/**
 * A label map whose values are read from the `ksef` namespace on every access,
 * so a module-level map still follows the active language.
 */
function labelMap<K extends string>(
  keys: readonly K[],
  read: (copy: LibCopy, key: K) => string,
): Record<K, string> {
  const map = {} as Record<K, string>;
  for (const key of keys) {
    Object.defineProperty(map, key, {
      enumerable: true,
      get: () => read(getKsefMessages().ksefNumberingLib, key),
    });
  }
  return map;
}

/** Copy key per document type (copy keys are camelCase; the values are not). */
const DOCUMENT_TYPE_COPY_KEYS = {
  invoice: 'invoice',
  receipt: 'receipt',
  'credit-note': 'creditNote',
  corrected: 'corrected',
  proforma: 'proforma',
  prepayment: 'prepayment',
} as const satisfies Record<DocumentType, string>;

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = labelMap(
  DocumentTypeValues,
  (copy, key) => copy.documentTypes[DOCUMENT_TYPE_COPY_KEYS[key]],
);

export const RESET_POLICY_LABELS: Record<ResetPolicy, string> = labelMap(
  ResetPolicyValues,
  (copy, key) => copy.resetPolicies[key],
);

/** Clickable pattern-variable chips in the editor (includes {DD} and {FY}). */
export const NUMBERING_VARIABLE_CHIPS = NumberingPatternVariableValues;

/** Copy key per pattern variable: the variable itself is a token, not a key. */
const VARIABLE_COPY_KEYS = {
  '{seq}': 'seq',
  '{YYYY}': 'yyyy',
  '{YY}': 'yy',
  '{FY}': 'fy',
  '{MM}': 'mm',
  '{QQ}': 'qq',
  '{DD}': 'dd',
} as const satisfies Record<NumberingPatternVariable, string>;

export const VARIABLE_LEGEND: Record<NumberingPatternVariable, string> = labelMap(
  NumberingPatternVariableValues,
  (copy, key) => copy.variables[VARIABLE_COPY_KEYS[key]],
);

export const SEQ_STATUS_LABELS: Record<NumberingSeqStatus, string> = labelMap(
  NumberingSeqStatusValues,
  (copy, key) => copy.seqStatuses[key],
);

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

type RoutedCopyKey = keyof LibCopy['routedDocumentTypes'];

function routedDocumentType(
  documentType: DocumentType,
  code: string,
  copyKey: RoutedCopyKey,
): KsefRoutedDocumentType {
  return {
    documentType,
    code,
    get label(): string {
      return getKsefMessages().ksefNumberingLib.routedDocumentTypes[copyKey].label;
    },
    get hint(): string {
      return getKsefMessages().ksefNumberingLib.routedDocumentTypes[copyKey].hint;
    },
  };
}

export const KSEF_ROUTED_DOCUMENT_TYPES: readonly KsefRoutedDocumentType[] = [
  routedDocumentType('invoice', 'VAT', 'invoice'),
  routedDocumentType('corrected', 'KOR', 'corrected'),
  routedDocumentType('prepayment', 'ZAL', 'prepayment'),
  routedDocumentType('proforma', 'PRO', 'proforma'),
];

const MONTH_KEYS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

/**
 * Month options for the "fiscal year starts in" picker (#1692), shown only when
 * the pattern uses `{FY}`. Value is the 1-12 calendar month; label is its name.
 */
export const FISCAL_YEAR_START_MONTHS: readonly { value: number; label: string }[] =
  MONTH_KEYS.map((key, index) => ({
    value: index + 1,
    get label(): string {
      return getKsefMessages().ksefNumberingLib.months[key];
    },
  }));

export function resetCaption(resetPolicy: ResetPolicy): string {
  return getKsefMessages().ksefNumberingLib.resetCaptions[resetPolicy];
}

export function documentTypeLabel(documentType: string): string {
  return (DOCUMENT_TYPE_LABELS as Record<string, string>)[documentType] ?? documentType;
}
