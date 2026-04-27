/**
 * Category-Parameter Visibility Helpers
 *
 * Shared logic for the two dependency mechanisms surfaced by the API (#410):
 *   - parameter-level visibility: `param.dependsOn` — the parameter is hidden
 *     until the parent has one of the listed values.
 *   - dictionary-entry filtering: `dictionary[i].dependsOnValueIds` — within a
 *     visible dictionary, an entry is selectable only when the parent has one
 *     of its listed values.
 *
 * Used by:
 *   - the field renderer (skip rendering, narrow option list)
 *   - the dynamic Zod schema (don't validate hidden fields, reject orphan
 *     dictionary selections)
 *   - the submit-time serializer (drop hidden fields entirely)
 *
 * @module apps/web/src/features/listings/components
 */
import type {
  CategoryParameter,
  CategoryParameterDictionaryEntry,
} from '../api/listings.types';
import type { CategoryParameterFormValues } from './category-parameter-form.types';

/**
 * Resolve the parent value(s) the user has currently selected, normalized to
 * a string array (single-select dictionaries return `[id]`, multi-select
 * return `ids`, scalars return `[value]`, custom-text is included verbatim).
 * Returns an empty array for unset / blank values.
 */
function readParentValues(values: CategoryParameterFormValues, parameterId: string): string[] {
  const v = values[parameterId];
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') return v === '' ? [] : [v];
  if (Array.isArray(v)) return v.filter((s) => s !== '');
  // Range objects can't be parents — Allegro only uses dictionary parents.
  return [];
}

/**
 * Whether the parameter should be rendered for the current form values.
 *
 * - No `dependsOn` declared → always visible.
 * - `dependsOn` declared but parent has no value yet → hidden (deliberate; the
 *   wizard waits for the parent to be set before showing dependent fields).
 * - `dependsOn` declared and parent has at least one value matching the
 *   declared `valueIds` → visible.
 */
export function isParameterVisible(
  param: CategoryParameter,
  values: CategoryParameterFormValues,
): boolean {
  if (!param.dependsOn) return true;
  const parentValues = readParentValues(values, param.dependsOn.parameterId);
  if (parentValues.length === 0) return false;
  const allowed = new Set(param.dependsOn.valueIds);
  return parentValues.some((pv) => allowed.has(pv));
}

/**
 * For dictionary parameters with parameter-level `dependsOn`, return only the
 * entries whose `dependsOnValueIds` overlap the current parent value(s).
 * Entries with no `dependsOnValueIds` are always included (they are not
 * filtered).
 *
 * For non-dictionary parameters or parameters without `dependsOn`, returns
 * the entries unchanged.
 */
export function visibleDictionaryEntries(
  param: CategoryParameter,
  values: CategoryParameterFormValues,
): CategoryParameterDictionaryEntry[] {
  if (!param.dictionary) return [];
  if (!param.dependsOn) return param.dictionary;

  const parentValues = readParentValues(values, param.dependsOn.parameterId);
  if (parentValues.length === 0) return param.dictionary;

  return param.dictionary.filter((entry) => {
    if (!entry.dependsOnValueIds || entry.dependsOnValueIds.length === 0) return true;
    return entry.dependsOnValueIds.some((id) => parentValues.includes(id));
  });
}

/**
 * Whether `value` can be considered "filled". Used by the Zod superRefine and
 * the submit serializer.
 */
export function isFormValueEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    const r = v as { from?: string; to?: string };
    return (
      (r.from === undefined || r.from.trim() === '') &&
      (r.to === undefined || r.to.trim() === '')
    );
  }
  return false;
}
