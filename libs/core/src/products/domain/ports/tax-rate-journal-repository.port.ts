/**
 * Tax-Rate Journal Repository Port (#2250)
 *
 * Append-only by construction: the interface declares no update, no upsert and
 * no delete. A journal whose rows can be edited after the fact cannot answer
 * the question it exists for - "did the value change, and when?" - so adding a
 * mutating method here is not a refactor, it changes what an entry means. Same
 * discipline as `ExchangeRateRepositoryPort` (ADR-040).
 *
 * @module libs/core/src/products/domain/ports
 */
import type { TaxRateJournalEntry, TaxRateObservation } from '../types/tax-rate-journal.types';

export interface TaxRateJournalRepositoryPort {
  /** Insert one row. Callers dedup first; this method always writes. */
  append(observation: TaxRateObservation & { observedAt: Date }): Promise<TaxRateJournalEntry>;

  /**
   * The most recent entry for one item on one connection, or `null` when the
   * journal has never held one. One indexed read.
   */
  findLatest(
    productId: string,
    variantId: string | null,
    connectionId: string
  ): Promise<TaxRateJournalEntry | null>;

  /**
   * The most recent entry per connection for one item, across every connection
   * the journal knows about - what the disagreement surface reads to compare
   * the shop's value against each channel's.
   */
  findLatestPerConnection(
    productId: string,
    variantId: string | null
  ): Promise<TaxRateJournalEntry[]>;
}
