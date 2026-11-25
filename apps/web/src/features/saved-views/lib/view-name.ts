/**
 * View Name
 *
 * Naming rules shared by the save dialog and the duplicate action.
 *
 * @module apps/web/src/features/saved-views/lib
 */

export const VIEW_NAME_MAX_LENGTH = 60;

export function isNameTaken(name: string, views: ReadonlyArray<{ id: string; name: string }>, exceptId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  return views.some((view) => view.id !== exceptId && view.name.toLowerCase() === wanted);
}

/** `Base (copy)`, `Base (copy 2)`... unique among the given views, case-insensitively. */
export function uniqueCopyName(
  base: string,
  views: ReadonlyArray<{ name: string }>,
  copyWord: string,
): string {
  const root = base.replace(new RegExp(` \\(${copyWord}.*\\)$`), '');
  let candidate = `${root} (${copyWord})`;
  let n = 2;
  while (views.some((view) => view.name.toLowerCase() === candidate.toLowerCase())) {
    candidate = `${root} (${copyWord} ${n})`;
    n += 1;
  }
  return candidate;
}
