/**
 * Inventory Sale Decrement Service Interface (#3453)
 *
 * Lowers a routed work's sold quantities in the product master that owns each
 * line, exactly once per line.
 *
 * The work and the order arrive as ARGUMENTS: `inventory` must not import
 * `orders` (`OrdersModule` imports `InventoryModule`, so the edge back would
 * close a module cycle) nor reach into `fulfillment`'s tables. The worker handler
 * composes both reads, the #3171 precedent. The order's attention verdict is
 * likewise REPORTED rather than written — the handler writes it through
 * `IOrderRecordService`.
 *
 * @module libs/core/src/inventory/application/services
 */
import type {
  InventorySaleDecrementReason,
  InventorySaleDecrementStatus,
  SaleDecrementAttention,
} from '../../domain/types/inventory-sale-decrement.types';

/** One sold work line. */
export interface SaleDecrementLineInput {
  readonly orderLineId: string;
  readonly productId: string;
  /** `null` for a product-level line (no variant). */
  readonly productVariantId: string | null;
  /** Units sold — always positive; the service negates it for the write. */
  readonly quantity: number;
}

export interface DecrementForWorkInput {
  readonly orderId: string;
  readonly workId: string;
  /**
   * The connection the order was ingested through. A line whose owner IS this
   * connection is skipped: a storefront order already lowered its own shop's
   * stock, and lowering it again would count one sale twice.
   */
  readonly orderSourceConnectionId: string;
  /** The work's OL location, used only to pick positions — never sent to an adapter. */
  readonly locationId: string | null;
  readonly lines: readonly SaleDecrementLineInput[];
}

/** What happened to one line this run. */
export interface SaleDecrementLineOutcome {
  readonly orderLineId: string;
  readonly status: InventorySaleDecrementStatus;
  readonly reason: InventorySaleDecrementReason | null;
  readonly ownerConnectionId: string | null;
  /** True when this run crossed the adapter boundary for the line. */
  readonly attempted: boolean;
}

export interface DecrementForWorkResult {
  readonly lines: readonly SaleDecrementLineOutcome[];
  /**
   * Lines left `retryable` — failed before the boundary for a transient reason.
   * The caller throws a retryable error when this is non-empty, and the next run
   * re-claims exactly these lines.
   */
  readonly retryableLineIds: readonly string[];
  /** The order's attention verdict, folded over ALL its decrement rows. */
  readonly attention: SaleDecrementAttention;
}

export interface IInventorySaleDecrementService {
  /**
   * Lower one routed work's sold quantities in each line's owning product master.
   *
   * Never re-sends a line whose claim already exists in any non-`retryable`
   * state, so a replay, a re-poll or a job retry cannot decrement twice.
   * Infrastructure faults (the database) propagate; per-line business and
   * adapter outcomes never do.
   */
  decrementForWork(input: DecrementForWorkInput): Promise<DecrementForWorkResult>;
}
