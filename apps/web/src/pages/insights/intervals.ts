/**
 * Insights Polling Intervals
 *
 * Centralised interval constants for the Insights page's auto-refresh. Tune
 * here to adjust polling frequency without touching individual query
 * call-sites.
 *
 * @module apps/web/src/pages/insights
 */

export const INSIGHTS_HEALTH_INTERVAL_MS = 30_000;
export const INSIGHTS_JOBS_INTERVAL_MS = 60_000;
