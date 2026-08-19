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
