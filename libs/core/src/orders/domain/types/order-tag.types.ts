/**
 * Order Tag Types (#3532, D34)
 *
 * A workspace-wide tag vocabulary (max 50) plus the order-to-tag assignment.
 * Colors are a closed token-name vocabulary (`--tag-*` design tokens,
 * `docs/frontend-ui-style-guide.md`) — this context stores the token NAME as
 * a plain string and validates it against `OrderTagColorValues`, never a raw
 * hex value: a tag always has its name, and color is never the only signal.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * The closed `--tag-*` color-token vocabulary. Kept here (not in `apps/web`)
 * because the SERVER validates against it too — the form is not the only way
 * in (the #2610 rule): a raw JSON/`curl` caller must not be able to persist a
 * tag with an arbitrary color string the design system cannot render.
 *
 * Matches the eight `--tag-*` tokens `apps/web/src/index.css` defines (the
 * mockup M3 `--tag-*` proposal, ported verbatim) — the two sets must agree,
 * or a color this vocabulary accepts would have no dot to paint.
 */
export const OrderTagColorValues = [
  'grey',
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'pink',
  'violet',
] as const;
export type OrderTagColor = (typeof OrderTagColorValues)[number];

export const ORDER_TAG_WORKSPACE_LIMIT = 50;

export interface OrderTag {
  id: string;
  name: string;
  color: OrderTagColor;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderTagWithCount extends OrderTag {
  /** How many orders currently carry this tag — backs the Settings tag manager's count link. */
  orderCount: number;
}

export interface CreateOrderTagInput {
  name: string;
  color: OrderTagColor;
}

export interface UpdateOrderTagInput {
  name?: string;
  color?: OrderTagColor;
}

/** Result of a bulk assign of ONE tag across several orders (AC). */
export interface BulkAssignOrderTagResult {
  tagId: string;
  /** Orders that gained the tag by this call. */
  added: number;
  /** Orders that already carried it — informational, matches the "1 of 3 has it" copy. */
  alreadyTagged: number;
}
