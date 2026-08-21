/**
 * Sales analytics API client
 *
 * Thin request module for `GET /analytics/sales` (#1987).
 *
 * The endpoint treats `to` as an EXCLUSIVE boundary (`[from, to)`,
 * `sales-analytics.controller.ts` / `SalesAnalyticsFilters`), while the
 * `/analytics` date-range toolbar (`date-range.lib.ts`) hands this module an
 * INCLUSIVE `yyyy-mm-dd` end day. Passing the inclusive day straight through
 * would parse to midnight UTC of that day and silently drop the entire
 * selected last day's figures — `toExclusiveEndInstant` is the one place
 * that conversion happens, so it can't be forgotten at a call site.
 *
 * @module features/analytics/api
 */
import type { SalesAndChannelAnalytics, SalesAnalyticsFilters } from './sales-analytics.types';

export interface AnalyticsApi {
  getSales: (filters: SalesAnalyticsFilters) => Promise<SalesAndChannelAnalytics>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

/**
 * Converts an inclusive `yyyy-mm-dd` end day into the exclusive ISO instant
 * the endpoint expects — UTC midnight of the day AFTER `to`, so the whole of
 * `to` itself is included in `[from, to)`. Must stay UTC-anchored: `from` is
 * sent as a bare `yyyy-mm-dd` and parsed by the controller as UTC midnight
 * (`new Date(...)`), so a local-time anchor here would make the window
 * `[UTC midnight, local midnight)` — off by the caller's UTC offset in
 * either direction.
 */
export function toExclusiveEndInstant(to: string): string {
  const [year, month, day] = to.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString();
}

function buildQuery(filters: SalesAnalyticsFilters): string {
  const params = new URLSearchParams();
  params.set('from', filters.from);
  params.set('to', toExclusiveEndInstant(filters.to));
  if (filters.sourceConnectionId) {
    params.set('sourceConnectionId', filters.sourceConnectionId);
  }
  return params.toString();
}

export function createAnalyticsApi(request: ApiRequest): AnalyticsApi {
  return {
    getSales: (filters) => request(`/analytics/sales?${buildQuery(filters)}`),
  };
}
