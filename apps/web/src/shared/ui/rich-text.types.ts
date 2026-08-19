/**
 * Rich Text Types
 *
 * The frontend mirror of the core `DescriptionFormat` contract (ADR-046), as it
 * arrives from `GET /listings/connections/:connectionId/description-format`.
 *
 * Kept as a plain value type with no behaviour: that is what makes crossing the
 * HTTP boundary cheap, and the ADR records that changing the shape is a
 * coordinated change. The editor derives its whole surface from this
 * (`deriveRichTextProfile`), so nothing here names a platform.
 *
 * @module apps/web/src/shared/ui
 */
export const RichTextMarkValues = ['bold', 'italic', 'underline', 'strike'] as const;
export type RichTextMark = (typeof RichTextMarkValues)[number];

export type DescriptionRewriteAction = 'rename' | 'unwrap' | 'split-block';

export interface DescriptionRewrite {
  from: string;
  action: DescriptionRewriteAction;
  to?: string;
}

export interface DescriptionFormat {
  shape: 'html' | 'plain-text';
  allowedTags: string[];
  /** Per-tag allowed attributes. An absent tag means no attributes at all. */
  allowedAttributes: Record<string, string[]>;
  /**
   * `root` plus tag names. `null` means a flat allowlist with no context rules.
   * An empty array for a tag means that element accepts text only.
   */
  contentModel: Record<string, string[]> | null;
  rewrites: DescriptionRewrite[];
  requiresBlockOpener: boolean;
  selfClosingVoids: boolean;
  maxBytes: number | null;
  /**
   * `false` when the destination declared nothing and this is the conservative
   * fallback. Surfaced in the editor rather than presented as authoritative -
   * an operator who is shown a restricted toolbar deserves to know whether the
   * restriction came from the destination or from OpenLinker guessing.
   */
  declared: boolean;
  resolvedVia: 'OfferManager' | 'ProductPublisher' | null;
}

/**
 * The format for editing the MASTER description.
 *
 * ADR-046 deliberately excludes the master from the declared-format rule: it is
 * the catalogue of record rather than a listing destination, its own editor is
 * the authority on what it accepts, and it is where the broad HTML originates.
 * So there is no adapter declaration to fetch here, and narrowing the editor to
 * a marketplace subset would actively prevent an operator from authoring the
 * tables and headings their own shop supports.
 *
 * `declared: true` is not a fudge: the contract IS stated, in ADR-046, it just
 * comes from the decision rather than from an adapter method. Reporting
 * `declared: false` would render the "this destination has not declared its
 * format" warning, which is wrong here - nothing is supposed to declare.
 */
export const MASTER_DESCRIPTION_FORMAT: DescriptionFormat = {
  shape: 'html',
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'p', 'br', 'ul', 'ol', 'li',
    'b', 'strong', 'i', 'em', 'u', 's', 'a', 'blockquote',
  ],
  allowedAttributes: { a: ['href'] },
  contentModel: null,
  rewrites: [],
  requiresBlockOpener: false,
  selfClosingVoids: false,
  maxBytes: 65536,
  declared: true,
  resolvedVia: null,
};
