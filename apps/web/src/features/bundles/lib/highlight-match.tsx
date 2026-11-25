/**
 * Marks the part of a result that matched the search, so with several similar
 * names the user can see why a row is there (name, SKU or EAN). Bold only, no
 * background: the row already carries a highlight for the keyboard.
 *
 * @module apps/web/src/features/bundles/lib
 */
import type { ReactNode } from 'react';

export function highlightMatch(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return text;
  const at = text.toLowerCase().indexOf(needle);
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bpick__hit">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}
