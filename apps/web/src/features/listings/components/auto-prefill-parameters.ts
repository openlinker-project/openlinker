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
import type { CatalogProduct, CategoryParameter } from '../api/listings.types';
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

/**
 * Higher-precedence prefill source: Allegro's catalog product match (#635).
 *
 * Merge key is `parameterId` — Allegro guarantees these are stable per
 * category, so we don't need the fuzzy name-pattern matching `prefillOne`
 * does for variant-attribute fallback. Catalog values overlay the
 * `autoPrefillParameters` baseline; the wizard applies them in order so
 * catalog wins on overlap.
 *
 * Skips any parameterId in `dirtyFields` — operator edits are sacred.
 * Returns the partial values map and a set of parameterIds that were
 * touched, so the panel can render "{N} fields auto-filled" and `Unlink`
 * can revert precisely those.
 *
 * Value-shape rules:
 *
 *   - dictionary, not multipleChoices → first `valueIds[0]` (string).
 *   - dictionary, multipleChoices    → `valueIds` (string[]).
 *   - string / numeric (non-range)   → first `valueStrings[0]` (string).
 *   - range                          → not handled (catalog doesn't carry
 *     ranged values today; skipped).
 *
 * Catalog parameters whose `parameterId` is not in `parameters` are
 * silently dropped — Allegro's category-scoped catalog usually but not
 * always aligns 1:1 with `/categories/:id/parameters`, and overshooting
 * would write into a parameter the wizard doesn't render.
 */
export function prefillFromCatalogProduct(
  parameters: CategoryParameter[],
  catalogProduct: CatalogProduct,
  dirtyFields: Record<string, boolean>,
): { values: CategoryParameterFormValues; prefilledIds: Set<string> } {
  const paramById = new Map(parameters.map((p) => [p.id, p]));
  const values: CategoryParameterFormValues = {};
  const prefilledIds = new Set<string>();

  for (const cp of catalogProduct.parameters) {
    if (dirtyFields[cp.parameterId]) continue;
    const target = paramById.get(cp.parameterId);
    if (!target) continue;

    const v = mapCatalogValueToFormValue(target, cp);
    if (v !== undefined) {
      values[cp.parameterId] = v;
      prefilledIds.add(cp.parameterId);
    }
  }

  return { values, prefilledIds };
}

function mapCatalogValueToFormValue(
  target: CategoryParameter,
  catalogParam: { valueIds?: string[]; valueStrings?: string[] },
): FormParameterValue {
  if (target.type === 'dictionary') {
    const ids = catalogParam.valueIds ?? [];
    if (ids.length === 0) return undefined;
    return target.restrictions.multipleChoices ? ids : ids[0];
  }
  // string / integer / float (non-range). Range types aren't surfaced by
  // the catalog endpoint today; skip rather than guess.
  if (target.restrictions.range) return undefined;
  const str = catalogParam.valueStrings?.[0];
  return str && str.length > 0 ? str : undefined;
}
