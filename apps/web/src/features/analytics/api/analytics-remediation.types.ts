/**
 * Analytics Remediation types
 *
 * Mirrors `AnalyticsRemediationRunResponseDto` (#2468) — the run created by
 * `POST /analytics/coverage/currency/recalculate`.
 *
 * @module features/analytics/api
 */
import type { CoverageResolutionStatus } from './analytics-coverage.types';

export interface AnalyticsRemediationRun {
  id: string;
  category: string;
  status: CoverageResolutionStatus;
  detail: string | null;
  affectedCount: number;
  triggeredByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecalculateCurrencyInput {
  /** ISO 8601, inclusive. */
  from: string;
  /** ISO 8601, exclusive. */
  to: string;
  sourceConnectionId?: string;
}
