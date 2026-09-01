/**
 * DocumentKindGlyph (#2535)
 *
 * The silhouette that says WHICH sales document a row or a panel is about: a
 * folded page for an invoice, a till slip for a fiscal receipt, and a struck
 * circle when routing named no document at all.
 *
 * Three properties are load-bearing.
 *
 *  1. **The kind is an entity axis, never health.** The glyph inherits
 *     `currentColor` and carries no tone of its own, so a document's kind can
 *     never be mistaken for its state. Colour is reserved for the states that
 *     need attention; a finished document is plain ink.
 *  2. **The silhouettes differ in outline, not only in detail.** A list is
 *     scanned rather than read, so the two kinds have to be separable at a
 *     glance across several rows: a rectangle with a folded corner against a
 *     torn-off slip.
 *  3. **It names itself.** Rendered on its own the glyph is the only statement
 *     of the kind, so it is an `img` with an accessible name. Beside the kind
 *     word - which is how {@link DocumentHeadline} uses it - that name would be
 *     read twice, so the caller marks it `decorative`.
 *
 * @module shared/ui
 */
import type { ReactElement } from 'react';

/**
 * The two sales-document kinds, mirroring `SalesDocumentKind`
 * (`@openlinker/core/sales-documents`). `null` is not a third kind: it is the
 * absence of a routing decision, which the surfaces render alongside the two.
 */
export type DocumentKind = 'invoice' | 'fiscal-receipt';

/** Accessible name per kind, and for the no-decision case. */
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  invoice: 'Invoice',
  'fiscal-receipt': 'Fiscal receipt',
};

/** What the struck circle means. Not "unknown": routing reached no decision. */
export const NO_DOCUMENT_LABEL = 'No document';

export interface DocumentKindGlyphProps {
  /** `null` renders the no-document silhouette. */
  kind: DocumentKind | null;
  /**
   * Hide the glyph from assistive technology. Pass this ONLY where the kind is
   * already stated in adjacent text, or a screen reader announces it twice.
   */
  decorative?: boolean;
  /** Overrides the accessible name. Ignored when `decorative`. */
  label?: string;
  className?: string;
}

export function DocumentKindGlyph({
  kind,
  decorative = false,
  label,
  className = '',
}: DocumentKindGlyphProps): ReactElement {
  const name = label ?? (kind === null ? NO_DOCUMENT_LABEL : DOCUMENT_KIND_LABEL[kind]);
  const classes = ['document-glyph', className].filter(Boolean).join(' ');
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': name } as const);

  return (
    <svg className={classes} viewBox="0 0 16 16" width="16" height="16" {...a11y}>
      {kind === 'invoice' ? INVOICE_PATHS : null}
      {kind === 'fiscal-receipt' ? RECEIPT_PATHS : null}
      {kind === null ? NO_DOCUMENT_PATHS : null}
    </svg>
  );
}

/** A page with a folded corner and two ruled lines. */
const INVOICE_PATHS = (
  <>
    <path
      d="M3.5 1.5h6l3 3v10h-9z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path
      d="M9.5 1.5v3h3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path d="M5.5 8h5M5.5 10.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </>
);

/** A till slip: straight sides, a torn zig-zag foot. */
const RECEIPT_PATHS = (
  <>
    <path
      d="M3.5 1.5h9v13l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path d="M6 5.5h4M6 8.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </>
);

/** A struck circle. Deliberately not a document outline at all. */
const NO_DOCUMENT_PATHS = (
  <>
    <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M4.4 11.6 11.6 4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </>
);
