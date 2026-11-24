/**
 * Invoice attachment types (#3548)
 *
 * What a caller that wants to ATTACH an issued document to something - a parcel,
 * an email, a marketplace order - gets back from one read, whichever provider
 * issued it. Provider documents come in three shapes (real PDF bytes, a stored
 * `pdfUrl`, the authority's public verification link), and before this read every
 * caller had to know which provider produced which. Four outcomes, because
 * "not yet" and "never" are different facts and a surface must say so:
 *
 * - `pdf`     - real document bytes the caller can attach directly.
 * - `link`    - no bytes, but a public url for the document.
 * - `waiting` - nothing attachable right now, but there may be later: the
 *               document is not cleared yet, or a source that could answer
 *               failed to (a provider outage is not a statement that nothing
 *               exists). Try again later.
 * - `none`    - cleared (or nothing to clear), every source answered, and
 *               there is still nothing attachable. Stop asking.
 *
 * Country-agnostic (ADR-026): no regime vocabulary. The url is opaque.
 *
 * @module libs/core/src/invoicing/domain/types
 */

export const InvoiceAttachmentStateValues = ['pdf', 'link', 'waiting', 'none'] as const;
export type InvoiceAttachmentState = (typeof InvoiceAttachmentStateValues)[number];

export type InvoiceAttachment =
  | { state: 'pdf'; content: Uint8Array; contentType: string }
  | { state: 'link'; url: string }
  | { state: 'waiting' }
  | { state: 'none' };

/**
 * The same answer without the document bytes, for a caller that only needs to
 * know what it could attach (the HTTP read). Producing it never downloads the
 * document: a `pdf` is reported from the provider's declared ability to render
 * one, so a status check does not spend a provider call it then throws away.
 */
export type InvoiceAttachmentSummary =
  | { state: 'pdf' }
  | { state: 'link'; url: string }
  | { state: 'waiting' }
  | { state: 'none' };
