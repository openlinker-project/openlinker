/**
 * RichTextView
 *
 * Renders a stored description as HTML instead of printing its markup as text,
 * which is what every description surface did before ADR-046.
 *
 * ## The only sanctioned `dangerouslySetInnerHTML` in the app
 *
 * `dangerouslySetInnerHTML` is banned app-wide by a `no-restricted-syntax`
 * selector in `.eslintrc.js`, with this file as the sole override - so the rule
 * is checkable rather than a convention. Everything rendered here goes through
 * DOMPurify first.
 *
 * ## Why this sanitizes again, when the API already did
 *
 * Two reasons, and both are load-bearing:
 *
 * 1. **Rows written before the inbound boundary existed** (#2198) were never
 *    sanitized, and there is deliberately no backfill - this pass is what covers
 *    them. "No backfill" is only a safe decision because this exists.
 * 2. **Storage keeps `style` on purpose; render must not.** The inbound pass
 *    keeps `style` and `class` because stripping them would silently rewrite the
 *    operator's own catalogue. But arbitrary CSS inside the admin page is a
 *    UI-redressing vector even where it cannot execute - `position: fixed` with a
 *    high `z-index` can overlay the admin chrome, and a hostile source shop is
 *    the assumed adversary. So `style` is dropped HERE.
 *
 * That asymmetry between the two allowlists is intentional. A future reader
 * comparing them should not "fix" it.
 *
 * @module apps/web/src/shared/ui
 */
import DOMPurify from 'dompurify';
import { useMemo, type ReactElement } from 'react';

/**
 * Tags a rendered description may contain. Wider than any single destination's
 * format - this renders what is STORED (master HTML, a channel value read back)
 * rather than what one destination accepts, so narrowing to a destination format
 * would hide content the operator really has.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'span', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'sub', 'sup', 'small', 'mark',
  'a', 'figure', 'figcaption', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'blockquote', 'pre', 'code', 'abbr', 'cite', 'q',
];

/**
 * No `style`, deliberately - see the header. `class` is also dropped: a stored
 * class name means nothing in this stylesheet and could collide with a real
 * component class, restyling the admin UI from inside a description.
 *
 * `target` is dropped too, which sidesteps tabnabbing rather than trying to pair
 * every stored `target="_blank"` with a `rel="noopener"` we would have to inject.
 * A description link opening in the same tab is fine in an admin tool, and the
 * operator can still middle-click.
 */
const ALLOWED_ATTR = ['href', 'src', 'alt', 'width', 'height', 'title', 'colspan', 'rowspan'];

export interface RichTextViewProps {
  /** Stored HTML. `null` / empty renders the empty state. */
  html: string | null | undefined;
  /** Rendered when there is nothing to show. */
  emptyLabel?: string;
  className?: string;
}

export function RichTextView({
  html,
  emptyLabel = 'No description',
  className = '',
}: RichTextViewProps): ReactElement {
  const clean = useMemo(() => {
    if (html === null || html === undefined || html.trim() === '') return '';
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_ATTR: ['style', 'class'],
    });
  }, [html]);

  if (clean === '') {
    return <p className={['rich-text-view__empty', className].filter(Boolean).join(' ')}>{emptyLabel}</p>;
  }

  return (
    <div
      className={['rich-text-view', className].filter(Boolean).join(' ')}
      // The single sanctioned use in the app: `dangerouslySetInnerHTML` is
      // banned app-wide by a `no-restricted-syntax` selector, with this file as
      // the only override. The value above is DOMPurify output - see the header.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
