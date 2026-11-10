/**
 * Missing Product Parameters
 *
 * Names the required product-section parameters a variant still has no value
 * for (#4003), so the bulk editor can say WHICH ones Allegro is waiting for
 * instead of a nameless "needs attention". Uses the same required set the
 * wizard's readiness reads (`useBulkRequiredProductParams`: required, product
 * section, not conditional on another parameter), so the list and the blocker
 * describe one rule.
 *
 * @module features/listings/lib
 */
import type { CategoryParameter } from '../api/listings.types';
import type {
  CategoryParameterFormValues,
  FormParameterValue,
} from '../components/category-parameter-form.types';

function hasValue(value: FormParameterValue): boolean {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.some((v) => v.trim() !== '');
  return value.from.trim() !== '' || value.to.trim() !== '';
}

/**
 * Marketplace names of the required product parameters without a value, in
 * schema order. Names are returned verbatim: they are the marketplace's words
 * and the operator matches them against the form labels.
 */
export function missingRequiredProductParameterNames(
  schema: readonly CategoryParameter[],
  values: CategoryParameterFormValues,
): string[] {
  return schema
    .filter((p) => p.required && p.section === 'product' && !p.dependsOn)
    .filter((p) => !hasValue(values[p.id]))
    .map((p) => p.name);
}
