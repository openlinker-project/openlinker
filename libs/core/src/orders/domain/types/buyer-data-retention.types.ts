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
  /** Distinct orders that would be hidden OR erased. */
  readonly total: number;
  /** Orders the rule would reach but skips: open hold, open return or a document being issued. */
  readonly skippedProtected: number;
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
