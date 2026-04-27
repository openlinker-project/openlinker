/**
 * Serialize Category-Parameter Form Values → Allegro Wire Shape
 *
 * Converts the wizard's flat `parameters[paramId]` form state into two
 * arrays — one per wire-shape section Allegro's `POST /sale/product-offers`
 * accepts:
 *
 *   - `offerParameters`   → `body.parameters[]`        (offer-section)
 *   - `productParameters` → `body.product.parameters[]` (product-section, #415)
 *
 * Each parameter is routed by its `section` field on the neutral metadata.
 * Sending a product-section parameter under `body.parameters[]` triggers
 * `ParameterCategoryException` 422 — the split here is the actual fix for
 * the camera-category bug.
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
  /** Wire-ready array for `body.product.parameters[]` (product-section, #415). */
  productParameters: AllegroParameterInput[];
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
    } else {
      offerParameters.push(out);
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
