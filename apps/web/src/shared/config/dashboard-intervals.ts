/**
 * Dashboard Polling Intervals
 *
 * Centralised interval constants for dashboard auto-refresh. Tune here to
 * adjust polling frequency without touching individual query call-sites.
 *
 * @module apps/web/src/shared/config
 */

export const DASHBOARD_HEALTH_INTERVAL_MS = 30_000;
export const DASHBOARD_JOBS_INTERVAL_MS = 60_000;
