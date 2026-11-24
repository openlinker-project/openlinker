/**
 * Buyer Data Retention Types (#4289)
 *
 * What the retention rule reads, what its trial run (`preview`) reports and what
 * one sweep did. The rule itself - hide an order from the default lists after N
 * days, erase the buyer's personal data after M days - is configured in
 * Operational Settings with a per-connection override in
 * `Connection.config.buyerDataRetention`; this file only types the order-side
 * contract.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { BuyerDataEraseMode } from '@openlinker/core/operational-settings';

/** One trial-run (or live-run) question: which orders does this rule touch? */
export interface BuyerDataRetentionScope {
  /** Only this connection's orders; absent = every connection. */
  readonly connectionId?: string;
  /** Orders older than this are hidden. `null` = the hide rule is off. */
  readonly hideBefore: Date | null;
  /** Orders older than this have their personal data erased. `null` = off. */
  readonly eraseBefore: Date | null;
  /** `whole-order` mode: an erased order is hidden too. */
  readonly eraseHides: boolean;
}

/** The counts a scope produces. A protected order is counted apart, never acted on. */
export interface BuyerDataRetentionCounts {
  readonly toHide: number;
  readonly toErase: number;
  /**
   * Of `toErase`, the orders already hidden (an earlier rule or an operator hid
   * them). They are in `toErase` and `total` but not in the visible list count,
   * so a surface that adds "already hidden" to a "to erase" figure must take
   * these out of one of the two or it counts the same order twice.
   */
  readonly alreadyHiddenDueForErase: number;
  /** Distinct orders that would be hidden OR erased. */
  readonly total: number;
  /** Orders the rule would reach but skips: open hold, open return or a document being issued. */
  readonly skippedProtected: number;
  /** Each protected order counted once, under the first reason: open return, hold, pending invoice. */
  readonly skippedByReason: BuyerDataSkippedByReason;
}

export interface BuyerDataSkippedByReason {
  readonly openReturn: number;
  readonly hold: number;
  readonly invoicePending: number;
}

/** One age bucket (30-day months; the last bucket holds everything 120+). */
export interface BuyerDataAgeBucket {
  readonly ageMonths: number;
  readonly visible: number;
  readonly hidden: number;
  readonly erased: number;
}

/** What the repository returns: sparse buckets, the service densifies. */
export interface BuyerDataAgeHistogramRows {
  readonly rows: readonly BuyerDataAgeBucket[];
  readonly totalOrders: number;
  readonly oldestPlacedAt: Date | null;
}

export interface BuyerDataAgeHistogram {
  readonly bucketUnit: 'month';
  readonly buckets: readonly BuyerDataAgeBucket[];
  readonly totalOrders: number;
  readonly oldestPlacedAt: string | null;
}

/** Fill every month 0..max so a chart has no gaps. Pure. */
export function densifyAgeBuckets(rows: readonly BuyerDataAgeBucket[]): BuyerDataAgeBucket[] {
  if (rows.length === 0) return [];
  const byMonth = new Map(rows.map((row) => [row.ageMonths, row]));
  const max = Math.max(...rows.map((row) => row.ageMonths));
  const dense: BuyerDataAgeBucket[] = [];
  for (let month = 0; month <= max; month += 1) {
    dense.push(byMonth.get(month) ?? { ageMonths: month, visible: 0, hidden: 0, erased: 0 });
  }
  return dense;
}

/** One example row of a trial run. Carries no personal data. */
export interface BuyerDataRetentionSample {
  readonly orderRef: string;
  readonly placedAt: string;
  readonly maskedBuyer: string;
}

export interface BuyerDataRetentionPreviewInput {
  readonly connectionId?: string;
  readonly hideAfterDays: number;
  readonly eraseAfterDays: number;
  readonly mode: BuyerDataEraseMode;
}

export interface BuyerDataRetentionPreview extends BuyerDataRetentionCounts {
  /** Every order still on the list in scope, hidden ones excluded. */
  readonly totalOrders: number;
  readonly samples: readonly BuyerDataRetentionSample[];
}

/** One order selected for erasure. */
export interface ErasableOrderRow {
  readonly internalOrderId: string;
  readonly customerId: string | null;
  readonly orderSnapshot: Record<string, unknown>;
}

/** One guarded erase write. */
export interface PersonalDataErasure {
  readonly internalOrderId: string;
  readonly orderSnapshot: Record<string, unknown>;
  readonly searchText: string;
  /** `whole-order` mode hides the order in the same statement. */
  readonly hide: boolean;
}

export interface PersonalDataErasureResult {
  readonly erased: number;
  /** Customers of the orders that were actually erased, for projection clearing. */
  readonly customerIds: readonly string[];
}

/** What one sweep did, summed over connections. */
export interface BuyerDataRetentionRunResult {
  readonly hidden: number;
  readonly erased: number;
  readonly customersCleared: number;
  readonly budgetExhausted: boolean;
}
