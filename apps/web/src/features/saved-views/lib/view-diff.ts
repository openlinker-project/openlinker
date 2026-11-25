/**
 * View Diff
 *
 * What differs between the list as it is on screen (the draft) and the view it
 * started from. Drives the "Edited" bar and its change summary.
 *
 * @module apps/web/src/features/saved-views/lib
 */
import type { ViewChangeKind, ViewDefinition } from './saved-view.types';
import { canonicalQuery } from './view-query';

const sameSort = (a: ViewDefinition['sort'], b: ViewDefinition['sort']): boolean =>
  a?.key === b?.key && a?.dir === b?.dir;

const sameParts = (a: ViewDefinition['parts'], b: ViewDefinition['parts']): boolean => {
  const keys = Object.keys({ ...a, ...b }).sort();
  return keys.every((key) => (a[key] ?? []).join() === (b[key] ?? []).join());
};

/**
 * Changes of `draft` against `saved`. Fields are reported only while the column
 * list is unchanged: a changed column list already says "Columns" and one chip
 * is enough to tell the operator to look at the panel.
 */
export function diffViews(
  draft: ViewDefinition,
  saved: ViewDefinition,
  nonViewParams?: readonly string[],
): ViewChangeKind[] {
  const changes: ViewChangeKind[] = [];
  if (canonicalQuery(draft.query, nonViewParams) !== canonicalQuery(saved.query, nonViewParams)) {
    changes.push('filters');
  }
  if (!sameSort(draft.sort, saved.sort)) changes.push('sort');
  if (draft.columns.join() !== saved.columns.join()) changes.push('columns');
  else if (!sameParts(draft.parts, saved.parts)) changes.push('fields');
  return changes;
}

export function isDirty(
  draft: ViewDefinition,
  saved: ViewDefinition,
  nonViewParams?: readonly string[],
): boolean {
  return (
    diffViews(draft, saved, nonViewParams).length > 0 ||
    // `fields` is suppressed next to `columns`; the stricter check keeps a pure parts edit dirty too.
    !sameParts(draft.parts, saved.parts)
  );
}
