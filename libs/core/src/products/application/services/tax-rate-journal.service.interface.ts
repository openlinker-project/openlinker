/**
 * Tax-Rate Journal Service Interface (#2250)
 *
 * @module libs/core/src/products/application/services
 * @see {@link TaxRateJournalService} for the implementation
 */
import type {
  TaxRateJournalEntry,
  TaxRateObservation,
} from '../../domain/types/tax-rate-journal.types';

export interface ITaxRateJournalService {
  /**
   * Record an observation, but only when it CHANGES what the journal last held
   * for the same item and connection.
   *
   * Returns the row when one was written and `null` when the observation was a
   * repeat. The catalogue sweep runs every twenty minutes and most products'
   * rates never move, so writing unconditionally would grow the table by the
   * size of the catalogue per tick and bury the handful of rows that matter.
   */
  record(observation: TaxRateObservation): Promise<TaxRateJournalEntry | null>;

  /** The latest entry per connection for one item - the disagreement surface's read. */
  getLatestPerConnection(
    productId: string,
    variantId?: string | null
  ): Promise<TaxRateJournalEntry[]>;
}
