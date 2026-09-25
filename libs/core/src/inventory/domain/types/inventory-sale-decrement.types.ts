/**
 * Inventory Sale Decrement Types (#3453, epic #3460)
 *
 * With the OMS on, a routed order stays in OpenLinker and is never created in the
 * product master, so the master's own order flow (PrestaShop's `validateOrder`)
 * never lowers its stock. OpenLinker therefore lowers it itself, once per work
 * line, in the product master that OWNS that line.
 *
 * This file holds the vocabulary and the pure rules; the orchestration is
 * `InventorySaleDecrementService`.
 *
 * ## The two failure directions, and which one this design picks
 *
 * A decrement can go wrong in two ways. Applied twice, the master's stock is too
 * LOW and the operator loses a sale; not applied, it is too HIGH and the last
 * unit can sell twice. An automatic retry of a write whose outcome is unknown
 * risks the first one silently and repeatedly (a retry ladder is ten attempts),
 * while declining to retry risks the second once, visibly. So:
 *
 * - the claim is persisted in Postgres BEFORE the boundary, and a claim found
 *   still `pending` on a later run is never re-sent — it becomes `in_doubt`;
 * - any throw after the boundary is `in_doubt` — OpenLinker cannot tell a
 *   refusal made before the write from a failure halfway through it;
 * - only a failure proven to have happened BEFORE the boundary (the owner's
 *   adapter could not be built) is `retryable`, the one re-claimable state.
 *
 * `in_doubt` is paired with a best-effort re-read of the master's stock, so the
 * marketplaces show the master's real number whichever way the write went.
 *
 * @module libs/core/src/inventory/domain/types
 */
import type { InventoryOwnerPosition } from './inventory.types';
import { resolveInventoryPositionOwner } from './inventory-owner.types';

/**
 * Where one line's decrement stands.
 *
 * - `pending` — claimed; the adapter call is in flight or its process died.
 * - `applied` / `deduplicated` — the master lowered its stock (or recognised the
 *   key as already applied). Both are successes.
 * - `skipped` — deliberately not decremented, with a reason (the order came from
 *   the line's own product master, which lowered its own stock).
 * - `blocked` — OpenLinker refused before the boundary, or the master reported
 *   the product absent. Nothing was lowered.
 * - `in_doubt` — the outcome is unknown. Never retried automatically.
 * - `retryable` — failed before the boundary for a transient reason; the only
 *   state a later run may re-claim.
 */
export const InventorySaleDecrementStatusValues = [
  'pending',
  'applied',
  'deduplicated',
  'skipped',
  'blocked',
  'in_doubt',
  'retryable',
] as const;

export type InventorySaleDecrementStatus = (typeof InventorySaleDecrementStatusValues)[number];

/** Why a line was skipped, blocked, in doubt or retryable. */
export const InventorySaleDecrementReasonValues = [
  /** The order was ingested through the line's own product master. */
  'source-is-owner',
  /** No live stock position exists for the line's product at the work's location. */
  'no-position',
  /** The owning position carries no provenance (`NULL` or `'legacy'`). */
  'unattributed-owner',
  /** Two connections own stock for the same line — OpenLinker will not guess. */
  'ambiguous-owner',
  /** The owner's `InventoryMaster` adapter could not be built (transient). */
  'adapter-unresolved',
  /** The master reported the product absent. */
  'master-product-not-found',
  /** The adapter threw; the detail carries its own words. */
  'master-error',
  /** A claim was found still `pending` — a previous run died mid-call. */
  'interrupted',
  /** The adapter answered with a disposition this build does not recognise. */
  'unrecognised-disposition',
] as const;

export type InventorySaleDecrementReason = (typeof InventorySaleDecrementReasonValues)[number];

/**
 * The statuses that make an order need attention.
 *
 * `retryable` is included deliberately: until the retry succeeds the stock has
 * NOT been lowered, which is exactly the oversell window an operator must see.
 * An `applied` row counts too when it was clamped — see
 * {@link deriveSaleDecrementAttention}.
 */
const ATTENTION_STATUSES: readonly InventorySaleDecrementStatus[] = [
  'blocked',
  'in_doubt',
  'retryable',
];

/**
 * The per-owner idempotency key, exactly as #3453 specifies it.
 *
 * Deterministic and never wall-clock, so a job retry recomputes it byte for byte
 * — the property both the Postgres claim and the adapter's own dedupe rely on.
 */
export function buildSaleDecrementIdempotencyKey(
  ownerConnectionId: string,
  workId: string,
  orderLineId: string
): string {
  return `sale:${ownerConnectionId}:${workId}:${orderLineId}`;
}

/**
 * The key for a line blocked BEFORE an owner could be named.
 *
 * Still deterministic, so a retry of the job finds the same row instead of
 * inserting a second block for the same line.
 */
export function buildUnresolvedSaleDecrementKey(workId: string, orderLineId: string): string {
  return `sale:unresolved:${workId}:${orderLineId}`;
}

/**
 * The idempotency key for one line's sale REVERSAL (#3479), exactly as the
 * issue specifies it.
 *
 * A distinct prefix (`sale-reversal:`, not `sale:`) rather than reusing the
 * `order_sale` key: the two claims share the same `inventory_sale_decrements`
 * table (one line's decrement and its later reversal are simply two rows keyed
 * by direction), and a shared key would make the reversal's `claim()` collide
 * with the decrement's own row instead of inserting a sibling.
 */
export function buildSaleReversalIdempotencyKey(
  ownerConnectionId: string,
  workId: string,
  orderLineId: string
): string {
  return `sale-reversal:${ownerConnectionId}:${workId}:${orderLineId}`;
}

/** The outcome of resolving which product master owns one line. */
export type SaleDecrementOwnerResolution =
  | {
      readonly kind: 'owner';
      readonly ownerConnectionId: string;
      /** The owner's position the new quantity is written back to. */
      readonly position: InventoryOwnerPosition;
      /** Summed across the owner's matching positions — the clamp comparison. */
      readonly availableQuantity: number;
    }
  | {
      readonly kind: 'blocked';
      readonly reason: Extract<
        InventorySaleDecrementReason,
        'no-position' | 'unattributed-owner' | 'ambiguous-owner'
      >;
      readonly detail: string;
    };

/**
 * Which product master owns a line's stock.
 *
 * Resolved per LINE from provenance, never as one global `InventoryMaster`
 * (unlike the returns restock, #2370), because v1 allows one or two product
 * masters (#3457) and a mixed basket must lower each owner for its own lines
 * only.
 *
 * - Only positions at the work's location or pooled ones (`locationId IS NULL`)
 *   count; a `null` work location accepts every live position.
 * - Variant-level rows win; product-level rows are used only when the variant
 *   has none, which is the shape a simple product without a synthetic variant
 *   row takes.
 * - `NULL` or `'legacy'` provenance refuses: writing to a book OpenLinker cannot
 *   name is guessing, and a wrong guess moves real stock in the wrong shop.
 * - More than one owner refuses for the same reason.
 *
 * When one owner has several positions, the one AT the work's location is the
 * write-back target, else the pooled one.
 */
export function resolveSaleDecrementOwner(
  positions: readonly InventoryOwnerPosition[],
  input: {
    readonly productId: string;
    readonly productVariantId: string | null;
    readonly locationId: string | null;
  }
): SaleDecrementOwnerResolution {
  // #3486 — the rule itself is shared with the returns restock; only the
  // operator-facing sentence is the sale decrement's own.
  const resolved = resolveInventoryPositionOwner(positions, input);
  if (resolved.kind === 'owner') return resolved;

  switch (resolved.reason) {
    case 'no-position':
      return {
        kind: 'blocked',
        reason: 'no-position',
        detail: 'OpenLinker has no live stock position for this product at the packing location',
      };
    case 'unattributed-owner':
      return {
        kind: 'blocked',
        reason: 'unattributed-owner',
        detail:
          'the stock for this product has no known owning connection yet; ' +
          'run a stock sync from the product master first',
      };
    case 'ambiguous-owner':
      return {
        kind: 'blocked',
        reason: 'ambiguous-owner',
        detail:
          `${String(resolved.ownerCount)} product masters hold stock for this product; ` +
          'OpenLinker will not guess which one sold it',
      };
  }
}

/** The slice of a decrement row the attention fold reads. */
export interface SaleDecrementAttentionRow {
  readonly status: InventorySaleDecrementStatus;
  readonly clamped: boolean;
}

/** What the order's attention entry should say, from ALL its decrement rows. */
export type SaleDecrementAttention =
  | { readonly kind: 'none' }
  | { readonly kind: 'blocked'; readonly detail: string };

/**
 * Fold every decrement row of one order into one attention verdict.
 *
 * LEVEL-triggered over the whole order (#2100): recomputed from every row on
 * every run, so a retry that succeeds clears the state and a sibling work's
 * failure is never erased by another work's success.
 */
export function deriveSaleDecrementAttention(
  rows: readonly SaleDecrementAttentionRow[]
): SaleDecrementAttention {
  const failed = rows.filter((row) => ATTENTION_STATUSES.includes(row.status)).length;
  const clamped = rows.filter(
    (row) => (row.status === 'applied' || row.status === 'deduplicated') && row.clamped
  ).length;

  if (failed === 0 && clamped === 0) {
    return { kind: 'none' };
  }

  const parts: string[] = [];
  if (failed > 0) {
    parts.push(`${String(failed)} line(s) not lowered or in doubt`);
  }
  if (clamped > 0) {
    parts.push(`${String(clamped)} line(s) sold more than the stock OpenLinker saw`);
  }
  return { kind: 'blocked', detail: parts.join('; ') };
}
