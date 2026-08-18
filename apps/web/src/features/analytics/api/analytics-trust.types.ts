/**
 * Analytics Trust Feature Types
 *
 * Frontend transport types for the analytics data-trust read. Mirrors the
 * backend AnalyticsTrustResponseDto / ConnectionIngestionTrustResponseDto
 * contracts (#1982). All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/analytics/api
 */
import type { ConnectionStatus } from '../../connections';

export type ConnectionIngestionStatus =
  | 'never-ingested'
  | 'fresh'
  | 'stalled'
  | 'disconnected'
  | 'unknown';

export interface ConnectionIngestionTrust {
  connectionId: string;
  connectionName: string;
  platformType: string;
  connectionStatus: ConnectionStatus;
  status: ConnectionIngestionStatus;
  lastPollAt: string | null;
  lastOrderIngestedAt: string | null;
  connectionCreatedAt: string;
  earliestOrderDate: string | null;
  expectedIntervalMs: number | null;
  staleAfterMs: number | null;
}

export interface AnalyticsTrustSnapshot {
  generatedAt: string;
  worstStatus: ConnectionIngestionStatus;
  connections: ConnectionIngestionTrust[];
}
