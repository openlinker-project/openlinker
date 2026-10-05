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

/**
 * Size codes offered in the template select. These three are a convention this
 * product chooses, NOT a carrier contract: on the wire `parcelTemplate` is an
 * opaque carrier size code, and the valid codes are each carrier's own. The
 * dialog therefore also accepts a free-text code beside the list, until a
 * carrier declares its own list (the `ParcelRequirementsReader` sub-capability
 * of the shipping port is where that would arrive).
 */
export const PARCEL_TEMPLATE_OPTIONS = ['small', 'medium', 'large'] as const;

/**
 * Upper bounds in operator units (cm / kg). Mirrors the server's
 * `PARCEL_PROFILE_BOUNDS` (mm / g, `@openlinker/core/mappings`), which this
 * bundle cannot import (#591): 500 cm = 5000 mm, 100 kg = 100000 g. Mirrored so
 * the dialog refuses an out-of-range value in its own words instead of
 * surfacing the API's 400; `scripts/check-parcel-profile-bounds-mirror.mjs`
 * compares the two across the unit conversion.
 */
export const PARCEL_PROFILE_LIMITS = {
  dimensionCmMax: 500,
  weightKgMax: 100,
  templateMaxLength: 32,
} as const;

const MM_PER_CM = 10;
const GRAMS_PER_KG = 1000;

function parseDecimal(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** "30" cm -> 300 mm. Null for blank / non-numeric input. */
export function cmToMm(value: string): number | null {
  const n = parseDecimal(value);
  return n === null ? null : Math.round(n * MM_PER_CM);
}

/** "0.5" kg -> 500 g. Null for blank / non-numeric input. */
export function kgToGrams(value: string): number | null {
  const n = parseDecimal(value);
  return n === null ? null : Math.round(n * GRAMS_PER_KG);
}

function trimNumber(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function mmToCm(mm: number | null | undefined): string {
  return mm === null || mm === undefined ? '' : trimNumber(mm / MM_PER_CM);
}

export function gramsToKg(grams: number | null | undefined): string {
  return grams === null || grams === undefined ? '' : trimNumber(grams / GRAMS_PER_KG);
}

/** True when `code` is one of the listed size options rather than a free-text carrier code. */
export function isListedParcelTemplate(code: string): boolean {
  return (PARCEL_TEMPLATE_OPTIONS as readonly string[]).includes(code);
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
    draft.template.trim() === '' &&
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
  // A typed carrier code can carry stray whitespace. The server trims as well,
  // so trimming here makes the value sent the value stored.
  const template = draft.template.trim();
  return {
    parcelTemplate: template === '' ? null : template,
    lengthMm: cmToMm(draft.lengthCm),
    widthMm: cmToMm(draft.widthCm),
    heightMm: cmToMm(draft.heightCm),
    defaultWeightGrams: kgToGrams(draft.weightKg),
  };
}

export interface ValidateDraftOptions {
  /** The operator chose to type a carrier code rather than pick a listed size. */
  customTemplate?: boolean;
}

/** First problem with a draft, or null when it is savable (an empty draft is valid: it clears). */
export function validateDraft(
  draft: ParcelProfileDraft,
  options: ValidateDraftOptions = {},
): string | null {
  const template = draft.template.trim();
  if (options.customTemplate && template === '') return PARCEL_COPY.customTemplateEmpty;
  if (template.length > PARCEL_PROFILE_LIMITS.templateMaxLength) {
    return PARCEL_COPY.templateTooLong(PARCEL_PROFILE_LIMITS.templateMaxLength);
  }
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
  // Compared in wire units after rounding, i.e. exactly what the server's
  // `@Max` will see.
  const dimensionMmMax = PARCEL_PROFILE_LIMITS.dimensionCmMax * MM_PER_CM;
  if ([f.lengthMm, f.widthMm, f.heightMm].some((v) => v !== null && v > dimensionMmMax)) {
    return PARCEL_COPY.tooLarge(PARCEL_PROFILE_LIMITS.dimensionCmMax);
  }
  const weightGramsMax = PARCEL_PROFILE_LIMITS.weightKgMax * GRAMS_PER_KG;
  if (f.defaultWeightGrams !== null && f.defaultWeightGrams > weightGramsMax) {
    return PARCEL_COPY.weightTooLarge(PARCEL_PROFILE_LIMITS.weightKgMax);
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
