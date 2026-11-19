/**
 * Serialize Category-Parameter Form Values → Neutral `OfferParameter[]`
 *
 * Converts the wizard's flat `parameters[paramId]` form state into a single
 * neutral, section-tagged `OfferParameter[]` (#1071). The backend merges these
 * with attribute projection and the destination adapter does the offer/product
 * wire split — the FE no longer buckets into Allegro-shaped arrays.
 *
 * Handles all submit shapes per parameter:
 *   - dictionary single → `{ id, valuesIds: [v], section }`
 *   - dictionary multi  → `{ id, valuesIds: [...vs], section }`
 *   - dictionary single + customValuesEnabled → match against the dictionary
 *     (by text, then by entry id); matched entry → `valuesIds`, otherwise →
 *     `values: [text]`
 *   - integer / float range → `{ id, rangeValue: { from, to }, section }`
 *   - integer / float / string scalar → `{ id, values: [String(v)], section }`
 *
 * Hidden parameters (per `isParameterVisible`) are excluded. `section` is
 * carried verbatim from the neutral `CategoryParameter` metadata; a parameter
 * arriving without a `section` throws `MissingCategoryParameterSectionError`
 * (a stale TanStack Query cache predating #417 — fail loud, don't mis-route).
 *
 * @module apps/web/src/features/listings/components
 */
import type { CategoryParameter, OfferParameter } from '../api/listings.types';
import type { CategoryParameterFormValues } from './category-parameter-form.types';
import {
  findDictionaryEntryForFormValue,
  isFormValueEmpty,
  isParameterVisible,
} from './category-parameter-visibility';

/**
 * The form value for a picked dictionary entry on a single-choice parameter
 * (#4038), shared by every writer (the combobox and both prefill paths).
 *
 * A custom-values field stores the entry's TEXT, which submit resolves back to
 * the entry by its spelling. That only works while the spelling names one
 * entry: when two entries share a label, the text would resolve to the first
 * one, so the entry id is stored instead and resolved by the id fallback in
 * `mapOne` / `toComboboxValue`. Any other dictionary field stores the id.
 */
export function dictionaryEntryFormValue(
  param: CategoryParameter,
  entry: { id: string; value: string }
): string {
  if (!param.restrictions.customValuesEnabled) return entry.id;
  const label = normalizeLabel(entry.value);
  const sameLabel = (param.dictionary ?? []).filter((e) => normalizeLabel(e.value) === label);
  return sameLabel.length > 1 ? entry.id : entry.value;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Thrown when a `CategoryParameter` arrives without a `section` value — a
 * contract violation that signals a stale browser cache predating #417. The
 * wizard / bulk-edit submit handlers catch this to render an actionable
 * "wizard data is out of date — please reload" message. Carries the offending
 * parameter's `id` and `name` for operator-facing copy.
 */
export class MissingCategoryParameterSectionError extends Error {
  public readonly parameterId: string;
  public readonly parameterName: string;

  constructor(parameterId: string, parameterName: string) {
    super(
      `Category parameter '${parameterId}' (${parameterName}) is missing a 'section' value. ` +
        `This usually means the wizard's category-parameters data was cached before the schema ` +
        `field was introduced (#417). Reload the wizard to refetch.`,
    );
    this.name = 'MissingCategoryParameterSectionError';
    this.parameterId = parameterId;
    this.parameterName = parameterName;
  }
}

export function categoryParametersToOfferParameters(
  values: CategoryParameterFormValues,
  parameters: CategoryParameter[],
): OfferParameter[] {
  const out: OfferParameter[] = [];

  for (const param of parameters) {
    if (!isParameterVisible(param, values, parameters)) continue;
    if (param.section !== 'offer' && param.section !== 'product') {
      // #423 — `section` is required by the CategoryParameter contract.
      // Reaching here means stale data (cache predating #417). Fail loud.
      throw new MissingCategoryParameterSectionError(param.id, param.name);
    }
    const mapped = mapOne(param, values[param.id]);
    if (mapped === null) continue;
    out.push({ ...mapped, section: param.section });
  }

  return out;
}

/** Map one form value to the neutral param body (without `section`), or null when empty. */
function mapOne(
  param: CategoryParameter,
  raw: CategoryParameterFormValues[string],
): Omit<OfferParameter, 'section'> | null {
  if (isFormValueEmpty(raw)) return null;

  if (param.type === 'dictionary') {
    if (param.restrictions.multipleChoices) {
      // A lone string is one selection: a prefill from a saved request cannot
      // tell a one-value multi-choice from a single choice (#4037).
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
      const ids = list.filter((s) => s !== '' && isKnownDictionaryId(param, s));
      return ids.length > 0 ? { id: param.id, valuesIds: ids } : null;
    }
    if (typeof raw !== 'string') return null;

    const trimmed = raw.trim();
    if (trimmed === '') return null;

    if (param.restrictions.customValuesEnabled) {
      // A custom-values field normally holds the entry's text, but a writer may
      // still store the entry id (one that predates #4038, or a pick between
      // two entries that share a label). Sending that id as free text makes the
      // marketplace read the parameter as missing, so the lookup also accepts
      // an id that names an entry. Keep this even once every writer stores text.
      const match = findDictionaryEntryForFormValue(param, trimmed);
      return match
        ? { id: param.id, valuesIds: [match.id] }
        : { id: param.id, values: [trimmed] };
    }

    return isKnownDictionaryId(param, trimmed) ? { id: param.id, valuesIds: [trimmed] } : null;
  }

  // Range scalar (integer/float)
  if (param.restrictions.range && typeof raw === 'object' && !Array.isArray(raw) && raw !== null) {
    const r = raw as { from?: string; to?: string };
    const from = r.from?.trim() ?? '';
    const to = r.to?.trim() ?? '';
    if (from === '' && to === '') return null;
    return { id: param.id, rangeValue: { from, to } };
  }

  // Single scalar (string / integer / float)
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed === '' ? null : { id: param.id, values: [trimmed] };
  }

  return null;
}

/**
 * Whether a dictionary value id belongs to this parameter's current dictionary.
 *
 * Changing the category keeps the form values keyed by parameter id, and a
 * parameter such as "Stan" shares its id across categories while its dictionary
 * does not. The select cannot show an id missing from its options, so it reads
 * "Select…" while the old id would still be sent and rejected by the
 * marketplace. Dropping it makes the payload match what the operator sees. A
 * parameter that arrives without a dictionary keeps every id - there is nothing
 * to check against.
 */
function isKnownDictionaryId(param: CategoryParameter, id: string): boolean {
  if (!param.dictionary || param.dictionary.length === 0) return true;
  return param.dictionary.some((entry) => entry.id === id);
}
