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
import type { CategoryParameter, CategoryParameterDictionaryEntry } from '../api/listings.types';
import type { CategoryParameterFormValues } from './category-parameter-form.types';

/**
 * The dictionary entry a stored single-choice value names, or `undefined`.
 *
 * A custom-values field stores the entry's TEXT (#4038), so it is matched by
 * spelling first (case-insensitive) and by entry id second: the id is what an
 * older writer stored, and what a pick stores when two entries share a label.
 * Every reader of such a value resolves it here, so the submit, the combobox
 * and the parent lookup below agree on which entry a value is.
 */
export function findDictionaryEntryForFormValue(
  param: CategoryParameter,
  raw: string,
): CategoryParameterDictionaryEntry | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const dictionary = param.dictionary ?? [];
  return (
    dictionary.find((entry) => entry.value.trim().toLowerCase() === trimmed.toLowerCase()) ??
    dictionary.find((entry) => entry.id === trimmed)
  );
}

/**
 * Resolve the parent value(s) the user has currently selected, normalized to
 * a string array of entry ids where the parent is a dictionary (single-select
 * returns `[id]`, multi-select returns `ids`, scalars return `[value]`).
 *
 * A custom-values parent stores the entry's TEXT, not its id (#4038), while
 * `dependsOn.valueIds` and `dependsOnValueIds` name ids. So its text is
 * resolved back to the entry id through the parent's own dictionary - without
 * that, picking "Samsung" for Marka would hide Model. A typed value that names
 * no entry stays verbatim: it matches no id, which is correct, since a custom
 * value is not one of the values a dependent can require.
 * Returns an empty array for unset / blank values.
 */
function readParentValues(
  values: CategoryParameterFormValues,
  parameterId: string,
  parameters: readonly CategoryParameter[],
): string[] {
  const v = values[parameterId];
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') {
    if (v === '') return [];
    const parent = parameters.find((p) => p.id === parameterId);
    if (parent?.type === 'dictionary' && parent.restrictions.customValuesEnabled) {
      return [findDictionaryEntryForFormValue(parent, v)?.id ?? v];
    }
    return [v];
  }
  if (Array.isArray(v)) return v.filter((s) => s !== '');
  // Range objects can't be parents — Allegro only uses dictionary parents.
  return [];
}

/**
 * Whether the parameter should be rendered for the current form values.
 * `parameters` is the category's full parameter list, from which the parent
 * is looked up.
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
  parameters: readonly CategoryParameter[],
): boolean {
  if (!param.dependsOn) return true;
  const parentValues = readParentValues(values, param.dependsOn.parameterId, parameters);
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
  parameters: readonly CategoryParameter[],
): CategoryParameterDictionaryEntry[] {
  if (!param.dictionary) return [];
  if (!param.dependsOn) return param.dictionary;

  const parentValues = readParentValues(values, param.dependsOn.parameterId, parameters);
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
      (r.from === undefined || r.from.trim() === '') && (r.to === undefined || r.to.trim() === '')
    );
  }
  return false;
}
