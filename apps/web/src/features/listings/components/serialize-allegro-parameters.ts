/**
 * Serialize Category-Parameter Form Values → Allegro Wire Shape
 *
 * Converts the wizard's flat `parameters[paramId]` form state into two
 * arrays — one per wire-shape section Allegro's `POST /sale/product-offers`
 * accepts:
 *
 *   - `offerParameters`   → `body.parameters[]`                    (offer-section)
 *   - `productParameters` → `body.productSet[0].product.parameters[]` (product-section, #415 / #419)
 *
 * Each parameter is routed by its `section` field on the neutral metadata.
 * Sending a product-section parameter under `body.parameters[]` triggers
 * `ParameterCategoryException` 422 — the split here is the actual fix for
 * the camera-category bug.
 *
 * **Strict branching (#423).** The router's branches are explicit:
 * `'product'` → productParameters, `'offer'` → offerParameters, and
 * **anything else throws** `MissingCategoryParameterSectionError`. CORE marks
 * `section` as required, so reaching the throw branch means the data
 * arrived from outside the type contract — almost certainly a stale
 * TanStack Query cache predating #417. Failing loud here is preferable to
 * silently mis-routing the parameter and getting `ParameterCategoryException`
 * from Allegro at the very last step of the wizard. The cache-version key
 * (`CATEGORY_PARAMETERS_SCHEMA_VERSION` in listings.types.ts) makes this
 * throw unreachable in well-behaved deploys; this is the runtime backstop.
 *
 * Handles all four submit shapes per parameter:
 *   - dictionary single → `{ id, valuesIds: [v] }`
 *   - dictionary multi  → `{ id, valuesIds: [...vs] }`
 *   - dictionary single + customValuesEnabled → match against the
 *     dictionary; matched entry → `valuesIds`, otherwise → `values: [text]`
 *   - integer / float range → `{ id, rangeValue: { from, to } }`
 *   - integer / float / string scalar → `{ id, values: [String(v)] }`
 *
 * Hidden parameters (per `isParameterVisible`) are excluded entirely. The
 * caller keeps both arrays as snapshots for error-mapping after a failed
 * submit.
 *
 * @module apps/web/src/features/listings/components
 */
import type { CategoryParameter } from '../api/listings.types';
import type { CategoryParameterFormValues } from './category-parameter-form.types';
import { isFormValueEmpty, isParameterVisible } from './category-parameter-visibility';

export interface AllegroParameterInput {
  id: string;
  values?: string[];
  valuesIds?: string[];
  rangeValue?: { from: string; to: string };
}

export interface SerializedParameters {
  /** Wire-ready array for `body.parameters[]` (offer-section). Order preserved from metadata. */
  offerParameters: AllegroParameterInput[];
  /** Wire-ready array for `body.productSet[0].product.parameters[]` (product-section, #415 / #419). */
  productParameters: AllegroParameterInput[];
}

/**
 * Thrown by `serializeAllegroParameters` when a `CategoryParameter` arrives
 * without a `section` value — a contract violation that signals a stale
 * browser cache predating #417 (when the field was added to the type).
 *
 * The wizard's submit handler catches this to render an actionable
 * "wizard data is out of date — please reload" Alert. Carries the
 * offending parameter's `id` and `name` as public readonly fields so the
 * UI can substitute them into operator-facing copy without re-parsing the
 * error message.
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

export function serializeAllegroParameters(
  values: CategoryParameterFormValues,
  parameters: CategoryParameter[],
): SerializedParameters {
  const offerParameters: AllegroParameterInput[] = [];
  const productParameters: AllegroParameterInput[] = [];

  for (const param of parameters) {
    if (!isParameterVisible(param, values)) continue;
    const out = mapOne(param, values[param.id]);
    if (out === null) continue;
    if (param.section === 'product') {
      productParameters.push(out);
    } else if (param.section === 'offer') {
      offerParameters.push(out);
    } else {
      // #423 — `section` is required by the CategoryParameter type contract.
      // Reaching this branch means the data arrived stale (most likely from
      // a TanStack Query cache predating #417). Fail loud rather than
      // silently mis-routing to offer-section, which would surface as
      // `ParameterCategoryException` from Allegro after a long wizard flow.
      throw new MissingCategoryParameterSectionError(param.id, param.name);
    }
  }

  return { offerParameters, productParameters };
}

function mapOne(
  param: CategoryParameter,
  raw: CategoryParameterFormValues[string],
): AllegroParameterInput | null {
  if (isFormValueEmpty(raw)) return null;

  if (param.type === 'dictionary') {
    if (param.restrictions.multipleChoices) {
      const ids = Array.isArray(raw) ? raw.filter((s) => s !== '') : [];
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

    return { id: param.id, valuesIds: [trimmed] };
  }

  // Range scalar (integer/float)
  if (
    param.restrictions.range &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    raw !== null
  ) {
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
