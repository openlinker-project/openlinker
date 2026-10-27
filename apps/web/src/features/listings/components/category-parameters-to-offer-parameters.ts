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
 *   - dictionary single + customValuesEnabled → match against the dictionary;
 *     matched entry → `valuesIds`, otherwise → `values: [text]`
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
import { isFormValueEmpty, isParameterVisible } from './category-parameter-visibility';

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
    if (!isParameterVisible(param, values)) continue;
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
      const ids = Array.isArray(raw)
        ? raw.filter((s) => s !== '' && isKnownDictionaryId(param, s))
        : [];
      return ids.length > 0 ? { id: param.id, valuesIds: ids } : null;
    }
    if (typeof raw !== 'string') return null;

    const trimmed = raw.trim();
    if (trimmed === '') return null;

    if (param.restrictions.customValuesEnabled) {
      const match = param.dictionary?.find(
        (entry) => entry.value.trim().toLowerCase() === trimmed.toLowerCase(),
      );
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
