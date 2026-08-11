/**
 * Analytics Trust Service Interface
 *
 * Defines the contract for reading the analytics data-trust snapshot: for
 * every OrderSource-capable connection, its freshness, coverage window, and
 * stalled status (#1982). Implemented by AnalyticsTrustService.
 *
 * @module libs/core/src/analytics-trust/application/services
 * @see {@link AnalyticsTrustService} for the implementation
 */
import type { AnalyticsTrustSnapshot } from '../../domain/types/connection-ingestion-trust.types';

export interface IAnalyticsTrustService {
  /**
   * Build the full data-trust snapshot: one entry per active OrderSource
   * connection. A single read the FE can make before rendering any figure.
   */
  getIngestionTrustSnapshot(): Promise<AnalyticsTrustSnapshot>;
}
