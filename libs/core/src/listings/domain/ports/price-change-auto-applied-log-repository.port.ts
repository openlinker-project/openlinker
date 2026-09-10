/**
 * Price Change Auto-Applied Log Repository Port (#3144, ADR-072 decision 3)
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { PriceChangeAutoAppliedLogEntry } from '../entities/price-change-auto-applied-log-entry.entity';
import type { RecordAutoAppliedPriceChangeInput } from '../types/price-change-auto-applied-log.types';

export interface PriceChangeAutoAppliedLogRepositoryPort {
  record(input: RecordAutoAppliedPriceChangeInput): Promise<PriceChangeAutoAppliedLogEntry>;

  /**
   * The most recent N entries, newest first. Deliberately NOT paginated or
   * filterable (ADR-072 decision 3 — this is explicitly not a digest feature).
   */
  findRecent(limit: number): Promise<readonly PriceChangeAutoAppliedLogEntry[]>;
}
