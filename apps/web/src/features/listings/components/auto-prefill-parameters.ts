/**
 * Auto-Prefill Category Parameters
 *
 * Conservative auto-fill for the create-offer wizard's Step 2 (#410). Maps
 * structured variant fields onto matching marketplace category parameters
 * by name (case-insensitive substring match against a small, hard-coded
 * pattern list).
 *
 * Only EAN-class fields and the `Stan` (condition) default are auto-filled.
 * Brand / producer-code prefill is deferred to #412 — those mappings are
 * fuzzy enough that wrong auto-fills are worse than no auto-fill (silently
 * broken listings, hard to debug).
 *
 * @module apps/web/src/features/listings/components
 */
import type { CategoryParameter } from '../api/listings.types';
import type { CategoryParameterFormValues, FormParameterValue } from './category-parameter-form.types';

/**
 * Known fragility — these matchers are case-insensitive *exact* string
 * compares against Allegro's PL/EN parameter names and dictionary entry
 * values. Any of the following will silently break prefill until the lists
 * below are updated:
 *
 *   - Allegro adds a new locale (e.g. an `allegro.de` connection),
 *   - Allegro renames a parameter ("Stan" → "Stan produktu"),
 *   - the canonical "Nowy" entry is replaced with a localised string.
 *
 * The fixture-based unit tests catch the *current* spelling but cannot
 * detect drift on the live API. When the brand / producer-code prefill
 * lands in #412, replace these literals with a config map keyed by
 * connection locale + parameter role, so each adapter can declare its own
 * mapping table.
 */
const EAN_NAME_PATTERNS = ['ean (gtin)', 'ean', 'gtin', 'kod ean'];
const CONDITION_NAME_PATTERNS = ['stan'];
const NEW_VALUE_PATTERNS = ['nowy', 'new', 'nowe', 'nowa'];

/**
 * Variant fields available for auto-prefill. Intentionally a narrow subset —
 * the wizard form holds the canonical variant; we only need the bits that
 * map onto category parameters.
 */
export interface AutoPrefillVariantFields {
  ean?: string | null;
}

export function autoPrefillParameters(
  parameters: CategoryParameter[],
  variant: AutoPrefillVariantFields,
): CategoryParameterFormValues {
  const out: CategoryParameterFormValues = {};

  for (const param of parameters) {
    const filled = prefillOne(param, variant);
    if (filled !== undefined) out[param.id] = filled;
  }

  return out;
}

function prefillOne(
  param: CategoryParameter,
  variant: AutoPrefillVariantFields,
): FormParameterValue {
  const nameLower = param.name.toLowerCase().trim();

  // EAN/GTIN — variant.ean lifted onto any matching string-typed parameter.
  if (variant.ean && EAN_NAME_PATTERNS.includes(nameLower)) {
    return variant.ean;
  }

  // Stan (condition) — default to "Nowy" when the parameter is a dictionary
  // and contains a value matching the "new" patterns. Most OL operators sell
  // new goods; user can change it.
  if (
    CONDITION_NAME_PATTERNS.includes(nameLower) &&
    param.type === 'dictionary' &&
    !param.restrictions.multipleChoices
  ) {
    const newOption = param.dictionary?.find((entry) =>
      NEW_VALUE_PATTERNS.includes(entry.value.toLowerCase().trim()),
    );
    if (newOption) return newOption.id;
  }

  return undefined;
}
