/**
 * DocumentHeadline (#2535)
 *
 * One line that says what a sale's document is and where it has got to:
 * `<glyph> Invoice · Issued`, with an optional identity sub-line carrying the
 * number and the provider.
 *
 * It exists so a list row and a detail panel describe the same document in the
 * same words. Before this each surface composed its own wording, and the same
 * order read two different ways depending on where you looked at it.
 *
 * What it will not do:
 *
 *  - **It never derives the state word.** The caller passes the word it read
 *    from a persisted status. This component adds no vocabulary of its own, so
 *    it cannot invent a state the backend does not report.
 *  - **Colour marks exceptions only.** `done` and `idle` are plain ink; only
 *    `warning` and `error` are tinted, and never alone - `done` also carries a
 *    tick and `progress` a live dot, so the state survives without hue.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';
import { DocumentKindGlyph, DOCUMENT_KIND_LABEL, NO_DOCUMENT_LABEL } from './document-kind-glyph';
import type { DocumentKind } from './document-kind-glyph';

/**
 * How a document's state reads, not what it is.
 *
 * `tone`, not `variant`, matching every other primitive in this catalogue.
 * Deliberately its own small union rather than `StatusBadgeTone`: a headline has
 * a finished state (`done`) and an in-flight one (`progress`) that a badge's
 * `success` / `info` do not distinguish, and it has no `solid` or `review`.
 */
export type DocumentHeadlineTone = 'idle' | 'progress' | 'done' | 'warning' | 'error';

export interface DocumentHeadlineProps {
  /** `null` when routing named no document. */
  kind: DocumentKind | null;
  /** The state word, read from a persisted status. e.g. `Registered`. */
  state: ReactNode;
  tone?: DocumentHeadlineTone;
  /** Number, provider, or both. Rendered in the mono sub-line, or omitted. */
  identity?: ReactNode;
  className?: string;
}

export function DocumentHeadline({
  kind,
  state,
  tone = 'idle',
  identity,
  className = '',
}: DocumentHeadlineProps): ReactElement {
  const classes = ['document-headline', className].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <span className={`document-headline__main document-headline__main--${tone}`}>
        {/* Decorative: the kind is the very next word. */}
        <DocumentKindGlyph kind={kind} decorative />
        <span className="document-headline__word">
          {kind === null ? NO_DOCUMENT_LABEL : DOCUMENT_KIND_LABEL[kind]}
          <span className="document-headline__sep" aria-hidden="true">
            {' · '}
          </span>
          {state}
        </span>
        {tone === 'done' ? <DoneTick /> : null}
        {tone === 'progress' ? (
          <span className="document-headline__live" aria-hidden="true" />
        ) : null}
      </span>
      {identity ? <p className="document-headline__sub">{identity}</p> : null}
    </div>
  );
}

/** The second, non-colour carrier of `done`. */
function DoneTick(): ReactElement {
  return (
    <svg
      className="document-headline__tick"
      viewBox="0 0 12 12"
      width="14"
      height="14"
      aria-hidden="true"
    >
      <path
        d="M2.5 6.4 4.7 8.6 9.5 3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
