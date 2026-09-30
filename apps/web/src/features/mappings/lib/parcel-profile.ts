/**
 * Parcel profile helpers (#3652)
 *
 * Pure conversion between the operator-facing units (cm / kg, typed as
 * strings) and the wire units (mm / g, integers) for a routing rule's parcel
 * profile, plus the one-line summary the rule list shows.
 *
 * @module apps/web/src/features/mappings/lib
 */
import type { ParcelProfileFields } from '../api/mappings.types';
import { PARCEL_COPY } from './parcel-profile.copy';

/** The form draft: everything a string exactly as the inputs hold it. */
export interface ParcelProfileDraft {
  template: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightKg: string;
}

export const EMPTY_PARCEL_DRAFT: ParcelProfileDraft = {
  template: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  weightKg: '',
};

/** Size codes offered in the template select (carrier size codes are free strings on the wire). */
export const PARCEL_TEMPLATE_OPTIONS = ['small', 'medium', 'large'] as const;

function parseDecimal(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** "30" cm -> 300 mm. Null for blank / non-numeric input. */
export function cmToMm(value: string): number | null {
  const n = parseDecimal(value);
  return n === null ? null : Math.round(n * 10);
}

/** "0.5" kg -> 500 g. Null for blank / non-numeric input. */
export function kgToGrams(value: string): number | null {
  const n = parseDecimal(value);
  return n === null ? null : Math.round(n * 1000);
}

function trimNumber(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function mmToCm(mm: number | null | undefined): string {
  return mm === null || mm === undefined ? '' : trimNumber(mm / 10);
}

export function gramsToKg(grams: number | null | undefined): string {
  return grams === null || grams === undefined ? '' : trimNumber(grams / 1000);
}

/** True when a stored profile carries at least one value. */
export function hasParcelProfile(fields: ParcelProfileFields | null | undefined): boolean {
  if (!fields) return false;
  return (
    Boolean(fields.parcelTemplate) ||
    fields.lengthMm != null ||
    fields.widthMm != null ||
    fields.heightMm != null ||
    fields.defaultWeightGrams != null
  );
}

export function draftFromFields(fields: ParcelProfileFields | null | undefined): ParcelProfileDraft {
  if (!fields) return EMPTY_PARCEL_DRAFT;
  return {
    template: fields.parcelTemplate ?? '',
    lengthCm: mmToCm(fields.lengthMm),
    widthCm: mmToCm(fields.widthMm),
    heightCm: mmToCm(fields.heightMm),
    weightKg: gramsToKg(fields.defaultWeightGrams),
  };
}

export function isDraftEmpty(draft: ParcelProfileDraft): boolean {
  return (
    draft.template === '' &&
    draft.lengthCm.trim() === '' &&
    draft.widthCm.trim() === '' &&
    draft.heightCm.trim() === '' &&
    draft.weightKg.trim() === ''
  );
}

export function draftsEqual(a: ParcelProfileDraft, b: ParcelProfileDraft): boolean {
  return (
    a.template === b.template &&
    a.lengthCm === b.lengthCm &&
    a.widthCm === b.widthCm &&
    a.heightCm === b.heightCm &&
    a.weightKg === b.weightKg
  );
}

/** Wire fields with every key present (`null` = cleared). */
export function draftToFields(draft: ParcelProfileDraft): Required<ParcelProfileFields> {
  return {
    parcelTemplate: draft.template === '' ? null : draft.template,
    lengthMm: cmToMm(draft.lengthCm),
    widthMm: cmToMm(draft.widthCm),
    heightMm: cmToMm(draft.heightCm),
    defaultWeightGrams: kgToGrams(draft.weightKg),
  };
}

/** First problem with a draft, or null when it is savable (an empty draft is valid: it clears). */
export function validateDraft(draft: ParcelProfileDraft): string | null {
  const dims = [draft.lengthCm, draft.widthCm, draft.heightCm];
  const filled = dims.filter((d) => d.trim() !== '').length;
  if (filled > 0 && filled < 3) return PARCEL_COPY.boxIncomplete;
  for (const value of [...dims, draft.weightKg]) {
    if (value.trim() === '') continue;
    const n = parseDecimal(value);
    if (n === null || n <= 0) return PARCEL_COPY.notPositive;
  }
  const f = draftToFields(draft);
  if (
    [f.lengthMm, f.widthMm, f.heightMm, f.defaultWeightGrams].some((v) => v !== null && v < 1)
  ) {
    return PARCEL_COPY.notPositive;
  }
  return null;
}

/** e.g. "Box 30 x 20 x 10 cm, 0.5 kg" / "Size medium" / null when nothing is set. */
export function summarizeParcelProfile(
  fields: ParcelProfileFields | null | undefined,
): string | null {
  if (!hasParcelProfile(fields) || !fields) return null;
  const parts: string[] = [];
  if (fields.parcelTemplate) parts.push(PARCEL_COPY.sizeSummary(fields.parcelTemplate));
  if (fields.lengthMm != null && fields.widthMm != null && fields.heightMm != null) {
    parts.push(
      PARCEL_COPY.boxSummary(mmToCm(fields.lengthMm), mmToCm(fields.widthMm), mmToCm(fields.heightMm)),
    );
  }
  if (fields.defaultWeightGrams != null) {
    parts.push(PARCEL_COPY.weightSummary(gramsToKg(fields.defaultWeightGrams)));
  }
  return parts.length > 0 ? parts.join(', ') : null;
}
