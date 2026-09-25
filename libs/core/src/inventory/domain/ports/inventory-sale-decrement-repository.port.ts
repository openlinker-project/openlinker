/**
 * Inventory Sale Decrement Repository Port (#3453)
 *
 * Persistence for {@link InventorySaleDecrement}. There is deliberately no
 * `save(entity)`: the claim is the guarantee, and a full-row save could overwrite
 * a peer's settled outcome with a stale `pending`.
 *
 * Intra-context — never exported from the inventory barrel
 * (`check-cross-context-imports` denies `*RepositoryPort`).
 *
 * @module libs/core/src/inventory/domain/ports
 */
import type { InventorySaleDecrement } from '../entities/inventory-sale-decrement.entity';
import type {
  InventorySaleDecrementReason,
  InventorySaleDecrementStatus,
} from '../types/inventory-sale-decrement.types';

/** The identity of one line's decrement. */
export interface SaleDecrementLineRef {
  readonly idempotencyKey: string;
  readonly orderId: string;
  readonly workId: string;
  readonly orderLineId: string;
  readonly productId: string;
  readonly productVariantId: string | null;
  readonly ownerConnectionId: string | null;
  readonly quantity: number;
}

/** A row written without crossing the boundary: skipped, blocked or retryable. */
export interface SaleDecrementUnclaimedOutcome {
  readonly status: Extract<InventorySaleDecrementStatus, 'skipped' | 'blocked' | 'retryable'>;
  readonly reason: InventorySaleDecrementReason;
  readonly detail: string | null;
}

/** What an adapter call settled to. */
export interface SaleDecrementSettlement {
  readonly status: Extract<
    InventorySaleDecrementStatus,
    'applied' | 'deduplicated' | 'blocked' | 'in_doubt'
  >;
  readonly reason: InventorySaleDecrementReason | null;
  readonly detail: string | null;
  readonly clamped: boolean;
  readonly idempotencyUnsupported: boolean;
  readonly resultingQuantity: number | null;
}

export interface InventorySaleDecrementRepositoryPort {
  /**
   * Take the at-most-once claim for one line.
   *
   * Inserts a `pending` row, or re-claims an existing `retryable` one — the only
   * state proven never to have crossed the boundary. Returns the claimed row, or
   * `null` when the key is already held in any other state; the caller then
   * reads it with {@link findByKey} and must NOT call the adapter.
   *
   * One atomic statement (`INSERT … ON CONFLICT … DO UPDATE … WHERE`), because a
   * read-then-insert enforces nothing at READ COMMITTED: the conflicting row is a
   * phantom until it exists.
   */
  claim(line: SaleDecrementLineRef): Promise<InventorySaleDecrement | null>;

  /**
   * Record a line that will not cross the boundary this run.
   *
   * Inserts the row, or overwrites an existing `retryable` one (the situation may
   * have changed since). Leaves every other existing row untouched, so a
   * terminal outcome is never rewritten.
   */
  recordUnclaimed(
    line: SaleDecrementLineRef,
    outcome: SaleDecrementUnclaimedOutcome
  ): Promise<void>;

  /** Settle a row this run claimed. */
  settle(id: string, settlement: SaleDecrementSettlement): Promise<void>;

  /**
   * Mark a claim found still `pending` as `in_doubt`.
   *
   * Conditional on the row still being `pending`, so a peer that settled it in
   * the meantime is never overwritten. Returns whether the row was marked.
   */
  markInterrupted(idempotencyKey: string): Promise<boolean>;

  findByKey(idempotencyKey: string): Promise<InventorySaleDecrement | null>;

  /** Every decrement row of one order — the attention fold's input. */
  findByOrderId(orderId: string): Promise<InventorySaleDecrement[]>;
}
