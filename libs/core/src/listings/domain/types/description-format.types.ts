/**
 * Description Format Types
 *
 * The neutral contract a destination uses to declare what it accepts in a
 * product description. Each destination accepts a different, narrow subset of
 * HTML, and before ADR-046 that knowledge lived in one regex private to the
 * Allegro package - with the wrong tag set, which is why we were emitting
 * payloads Allegro answers with 422.
 *
 * A destination declares a `DescriptionFormat`; core enforces it once through
 * the co-located pure `applyDescriptionFormat`; the frontend composes its
 * editor from the declaration and holds no destination knowledge of its own.
 *
 * The interesting field is `contentModel`. Allegro's validator is
 * context-sensitive - the allowed set depends on the parent element, so a
 * heading accepts no formatting at all - and a flat allowlist provably cannot
 * express that. Modelling it as `parent -> allowed children` keeps a
 * platform-specific rule expressible as data with no platform name in core.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link applyDescriptionFormat} for the enforcement pass
 * @see docs/architecture/adrs/046-adapter-declared-description-format.md
 */

/**
 * How the destination wants the value shaped. `plain-text` destinations get
 * every tag stripped and the text preserved; `html` destinations get the
 * allowlist + content model applied.
 */
export const DescriptionShapeValues = ['html', 'plain-text'] as const;
export type DescriptionShape = (typeof DescriptionShapeValues)[number];

export const DescriptionRewriteActionValues = ['rename', 'unwrap', 'split-block'] as const;
export type DescriptionRewriteAction = (typeof DescriptionRewriteActionValues)[number];

/**
 * A transformation applied BEFORE the allowlist. The ordering is a decision,
 * not an implementation detail: run the allowlist first and a `strong` the
 * destination rejects is deleted along with the operator's emphasis, instead
 * of being converted to the `b` the destination does accept.
 *
 * - `rename` - emit `to` instead of `from` (Allegro: `strong` -> `b`).
 * - `unwrap` - drop the tag, keep its text.
 * - `split-block` - replace the tag with a paragraph break (Allegro rejects
 *   `<br>` and documents `<p></p>` as the substitute).
 */
export type DescriptionRewrite =
  | { readonly from: string; readonly action: 'rename'; readonly to: string }
  | { readonly from: string; readonly action: 'unwrap' }
  | { readonly from: string; readonly action: 'split-block' };

/**
 * `'root'` plus tag names. A key mapped to an empty array means "this element
 * accepts text only" (Allegro's headings). Omit the whole field for a flat
 * allowlist with no context rules (a permissive shop).
 */
export type DescriptionContentModel = Readonly<Record<string, readonly string[]>>;

export interface DescriptionFormat {
  readonly shape: DescriptionShape;
  /** Tags that survive. Everything else is unwrapped, keeping its text. */
  readonly allowedTags: readonly string[];
  /** Per-tag allowed attributes. An absent tag means no attributes at all. */
  readonly allowedAttributes?: Readonly<Record<string, readonly string[]>>;
  readonly contentModel?: DescriptionContentModel | null;
  readonly rewrites?: readonly DescriptionRewrite[];
  /** The payload must open with a block-level element (Allegro, Erli). */
  readonly requiresBlockOpener?: boolean;
  /** Erli accepts `<br/>` and rejects `<br>`. */
  readonly selfClosingVoids?: boolean;
  /** Hard cap in UTF-8 bytes. `null` / absent means the destination sets none. */
  readonly maxBytes?: number | null;
}

/**
 * Block-level tags used as the default block-opener set when a format requires
 * an opener but declares no `contentModel.root`.
 */
export const DESCRIPTION_BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'ul', 'ol'] as const;

/**
 * The fallback for a destination that declares no format (ADR-046 subordinate
 * decision 1). Deliberately the conservative intersection of the destinations
 * we know rather than a permissive guess: a permissive guess yields a platform
 * rejection the operator cannot explain to themselves, whereas an over-narrow
 * pass loses formatting visibly and recoverably.
 *
 * Resolved server-side, so a consumer never has to carry a default of its own.
 *
 * Reachable only for a marketplace adapter that declares `OfferCreator`
 * without `OfferFieldUpdater` - `getDescriptionFormat` is required on
 * `ShopProductManagerPort`, so a shop always declares one.
 */
/**
 * Which capability answered the format read.
 *
 * `as const` + derived union, not an inline string union: the value crosses to
 * the frontend as an HTTP response field, so it needs a runtime array for
 * validation and Swagger (`engineering-standards.md § Union Types`).
 */
export const DescriptionFormatSourceValues = ['OfferManager', 'ProductPublisher'] as const;
export type DescriptionFormatSource = (typeof DescriptionFormatSourceValues)[number];

export const CONSERVATIVE_DESCRIPTION_FORMAT: DescriptionFormat = {
  shape: 'html',
  allowedTags: ['h1', 'h2', 'p', 'ul', 'ol', 'li', 'b'],
  allowedAttributes: {},
  contentModel: {
    root: ['h1', 'h2', 'p', 'ul', 'ol'],
    p: ['b'],
    ul: ['li'],
    ol: ['li'],
    li: ['b', 'p'],
    h1: [],
    h2: [],
  },
  rewrites: [
    { from: 'strong', action: 'rename', to: 'b' },
    { from: 'em', action: 'rename', to: 'b' },
    { from: 'i', action: 'rename', to: 'b' },
    { from: 'u', action: 'unwrap' },
    { from: 'br', action: 'split-block' },
  ],
  requiresBlockOpener: true,
  maxBytes: 40000,
};
