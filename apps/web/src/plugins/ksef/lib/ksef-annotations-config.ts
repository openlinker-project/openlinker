/**
 * KSeF seller-level annotation defaults and the cross-border switch
 * (DEF-18 / DEF-20 / DEF-22)
 *
 * Read and write `config.annotationsDefault` and `config.allowCrossBorder` for
 * the edit-connection form. Form fields are strings (the structured-section
 * contract), so a checkbox is `'true'` or `''`. Writing follows the #1311 rule:
 * each keystroke touches only its own leaf and never drops a sibling, so a
 * half-typed exemption basis survives until submit, where `superRefine` asks
 * for the other half.
 *
 * @module plugins/ksef/lib
 */
import { readOptionalConfigString } from '../../../shared/plugins';

export const KSEF_MARGIN_KIND_VALUES = [
  'travel-services',
  'used-goods',
  'works-of-art',
  'collectors-items',
] as const;

export const KSEF_EXEMPTION_KIND_VALUES = ['statute', 'directive', 'other'] as const;

/** The placeholder the adapter cites when no grounds are set (DEF-22). */
export const KSEF_PLACEHOLDER_EXEMPTION_TEXT = 'Zwolnienie z podatku VAT';

export interface KsefAnnotationsFormValues {
  ksefAllowCrossBorder: string;
  annCashAccounting: string;
  annSelfBilling: string;
  annMarginScheme: string;
  annMarginKind: string;
  annExemptionKind: string;
  annExemptionText: string;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

const flag = (value: unknown): string => (value === true ? 'true' : '');

export function readKsefAnnotations(config: Record<string, unknown>): KsefAnnotationsFormValues {
  const a = asObject(config.annotationsDefault);
  const basis = asObject(a.exemptionBasis);
  return {
    ksefAllowCrossBorder: flag(config.allowCrossBorder),
    annCashAccounting: flag(a.cashAccounting),
    annSelfBilling: flag(a.selfBilling),
    annMarginScheme: flag(a.marginScheme),
    annMarginKind: typeof a.marginKind === 'string' ? a.marginKind : '',
    annExemptionKind: typeof basis.kind === 'string' ? basis.kind : '',
    annExemptionText: typeof basis.text === 'string' ? basis.text : '',
  };
}

const FLAG_KEYS: ReadonlyArray<[keyof KsefAnnotationsFormValues, string]> = [
  ['annCashAccounting', 'cashAccounting'],
  ['annSelfBilling', 'selfBilling'],
  ['annMarginScheme', 'marginScheme'],
];

export function applyKsefAnnotationsToConfig(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };

  const crossBorder = readOptionalConfigString(patch, 'ksefAllowCrossBorder');
  if (crossBorder !== undefined) {
    if (crossBorder === 'true') {
      next.allowCrossBorder = true;
    } else {
      delete next.allowCrossBorder;
    }
  }

  const annotations: Record<string, unknown> = { ...asObject(next.annotationsDefault) };
  let touched = false;
  for (const [field, key] of FLAG_KEYS) {
    const value = readOptionalConfigString(patch, field);
    if (value === undefined) continue;
    touched = true;
    if (value === 'true') annotations[key] = true;
    else delete annotations[key];
  }
  const marginKind = readOptionalConfigString(patch, 'annMarginKind');
  if (marginKind !== undefined) {
    touched = true;
    if (marginKind) annotations.marginKind = marginKind;
    else delete annotations.marginKind;
  }
  const kind = readOptionalConfigString(patch, 'annExemptionKind');
  const text = readOptionalConfigString(patch, 'annExemptionText');
  if (kind !== undefined || text !== undefined) {
    touched = true;
    const basis: Record<string, unknown> = { ...asObject(annotations.exemptionBasis) };
    if (kind !== undefined) {
      if (kind) basis.kind = kind;
      else delete basis.kind;
    }
    if (text !== undefined) {
      if (text.trim()) basis.text = text;
      else delete basis.text;
    }
    if (Object.keys(basis).length > 0) annotations.exemptionBasis = basis;
    else delete annotations.exemptionBasis;
  }
  if (!touched) {
    return next;
  }
  if (Object.keys(annotations).length > 0) next.annotationsDefault = annotations;
  else delete next.annotationsDefault;
  return next;
}
