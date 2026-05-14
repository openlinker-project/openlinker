/**
 * Auto-Prefill Category Parameters
 *
 * Conservative auto-fill for the create-offer wizard's Step 2 (#410, #412).
 * Maps structured variant fields onto matching marketplace category
 * parameters by name (case-insensitive exact match against a small,
 * hard-coded pattern list).
 *
 * Covers EAN-class fields, the `Stan` (condition) default, brand (Marka),
 * and producer code (Kod producenta). Each rule only fires on
 * high-confidence matches — wrong auto-fills are worse than no auto-fill
 * (silently broken listings, hard to debug).
 *
 * @module apps/web/src/features/listings/components
 */
import type { CatalogProduct, CategoryParameter } from '../api/listings.types';
import type {
  CategoryParameterFormValues,
  FormParameterValue,
} from './category-parameter-form.types';

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
 * detect drift on the live API. When/if a third locale lands, replace these
 * literals with a config map keyed by connection locale + parameter role,
 * so each adapter can declare its own mapping table.
 */
const EAN_NAME_PATTERNS = ['ean (gtin)', 'ean', 'gtin', 'kod ean'];
const CONDITION_NAME_PATTERNS = ['stan'];
const NEW_VALUE_PATTERNS = ['nowy', 'new', 'nowe', 'nowa'];
// Canonical Allegro brand-field names only. `Producent` (free-text manufacturer
// name) is intentionally excluded — it is sometimes a string-typed parameter
// distinct from the dictionary-backed brand, and the matcher elsewhere relies
// on exact equality, so widening here would be a coincidence-driven coupling.
const BRAND_NAME_PATTERNS = ['marka', 'brand'];
const MANUFACTURER_CODE_NAME_PATTERNS = [
  'kod producenta',
  'manufacturer code',
  'mpn',
  'producer code',
];

/**
 * Variant fields available for auto-prefill. Intentionally a narrow subset —
 * the wizard form holds the canonical variant; we only need the bits that
 * map onto category parameters.
 *
 * `brand` and `manufacturerCode` are read from `variant.attributes` by the
 * wizard (`variant.attributes?.['brand']` / `variant.attributes?.['manufacturerCode']`).
 * Today's PrestaShop adapter does not populate these keys — the prefill is a
 * no-op until a BE follow-up writes them. Note: `manufacturerCode` is a
 * deliberate, semantic key — it is NEVER sourced from `sku` (SKU is the
 * shop's internal stock-keeping reference, not the manufacturer's part
 * number; conflating them silently breaks offers where the two diverge).
 */
export interface AutoPrefillVariantFields {
  /** Variant's barcode — matches EAN/GTIN/Kod EAN parameter names. */
  ean?: string | null;
  /**
   * Variant's brand value (free-text from the master catalog). Used to find
   * an exact case-insensitive match against the `Marka` parameter's
   * dictionary; never used for fuzzy / substring matching to avoid wrong
   * fills.
   */
  brand?: string | null;
  /**
   * Manufacturer code / MPN — copied (after `trim()`) into the
   * `Kod producenta` / string-typed parameter. Deliberately a separate
   * field from `sku`: SKU is the shop's internal stock-keeping reference,
   * MPN is the manufacturer's part number. They are often equal in practice
   * but the semantics differ; conflating them here would silently break
   * offers where they diverge.
   */
  manufacturerCode?: string | null;
}

export function autoPrefillParameters(
  parameters: CategoryParameter[],
  variant: AutoPrefillVariantFields
): CategoryParameterFormValues {
  const out: CategoryParameterFormValues = {};

  for (const param of parameters) {
    const filled = prefillOne(param, variant);
    if (filled !== undefined) out[param.id] = filled;
  }

  return out;
}

/**
 * Emits a soft hint for every `Marka` parameter where the variant has a
 * brand value but no exact dictionary match was found. Operators see the
 * variant's brand value alongside the field with a prompt to pick manually
 * — better than a silent empty field with no explanation.
 *
 * Mirrors the matcher list used by `autoPrefillParameters` above, and
 * honours the same one-match-only invariant — if the dictionary has the
 * brand, the helper already filled it and this function skips that param
 * via the `filled` lookup.
 *
 * Returns a `Record<paramId, message>` shaped to match the
 * `CategoryParametersStep.extraHints` prop directly — no adapter step at
 * the consumer site.
 */
export function collectUnmatchedBrandHints(
  parameters: CategoryParameter[],
  variant: AutoPrefillVariantFields,
  filled: CategoryParameterFormValues
): Record<string, string> {
  if (!variant.brand) return {};
  const target = variant.brand.toLowerCase().trim();
  if (!target) return {};

  const hints: Record<string, string> = {};
  for (const param of parameters) {
    if (filled[param.id] !== undefined) continue;
    const nameLower = param.name.toLowerCase().trim();
    if (!BRAND_NAME_PATTERNS.includes(nameLower)) continue;
    if (param.type !== 'dictionary') continue;
    if (param.restrictions.multipleChoices) continue;
    hints[param.id] =
      `Variant brand "${variant.brand}" — no exact match in Allegro brand list; pick manually.`;
  }
  return hints;
}

function prefillOne(
  param: CategoryParameter,
  variant: AutoPrefillVariantFields
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
      NEW_VALUE_PATTERNS.includes(entry.value.toLowerCase().trim())
    );
    if (newOption) return newOption.id;
  }

  // Marka (brand) — exact case-insensitive match against the dictionary.
  // Multi-match or no-match → no fill (the "no exact match" hint is emitted
  // separately by `collectUnmatchedBrandHints`).
  if (
    variant.brand &&
    BRAND_NAME_PATTERNS.includes(nameLower) &&
    param.type === 'dictionary' &&
    !param.restrictions.multipleChoices
  ) {
    const target = variant.brand.toLowerCase().trim();
    if (target) {
      const matches = (param.dictionary ?? []).filter(
        (entry) => entry.value.toLowerCase().trim() === target
      );
      if (matches.length === 1) return matches[0].id;
      // 0 or >1 matches → leave blank, hint surfaces elsewhere.
    }
  }

  // Kod producenta (manufacturer code / MPN) — verbatim string passthrough,
  // trimmed to defend against whitespace-contaminated attribute bags
  // (operator-edited values routinely carry leading/trailing spaces; Allegro's
  // `Kod producenta` is whitespace-sensitive on submit). Only fires when the
  // parameter is a string type and the variant carries a non-empty value.
  // Deliberately does NOT touch SKU — that's the shop's internal stock-keeping
  // reference, not the manufacturer's part number.
  if (
    variant.manufacturerCode &&
    MANUFACTURER_CODE_NAME_PATTERNS.includes(nameLower) &&
    param.type === 'string'
  ) {
    const trimmed = variant.manufacturerCode.trim();
    if (trimmed) return trimmed;
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
  dirtyFields: Record<string, boolean>
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
  catalogParam: { valueIds?: string[]; valueStrings?: string[] }
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
