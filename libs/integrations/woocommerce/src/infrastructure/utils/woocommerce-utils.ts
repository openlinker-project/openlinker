/**
 * WooCommerce Infrastructure Utilities
 *
 * Shared helpers for WooCommerce infrastructure adapters. Kept in the
 * infrastructure layer because they depend on IWooCommerceHttpClient and
 * Logger — both infrastructure/shared concerns.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/utils
 */
import type { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../http/woocommerce-http-client.interface';

/**
 * Safety cap: prevents unbounded pagination in pathological cases.
 * 500 pages × 100 items = 50,000 items max per call.
 */
export const FETCH_ALL_MAX_PAGES = 500;

/**
 * Converts a value to a positive integer, returning null if the conversion
 * fails or the result is not a finite positive integer.
 * Guards against NaN, Infinity, negative numbers, and non-numeric strings.
 */
export function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * Exhausts a paginated WC REST endpoint, collecting all items across pages.
 * Breaks early when the last page returns fewer items than `perPage`, or
 * when the safety cap is hit (warns and truncates — does not throw).
 *
 * @param params - Additional query parameters forwarded to every page request
 *   (e.g. `{ status: 'publish' }`). The `per_page` and `page` keys are
 *   always added by this function and must not be included in `params`.
 */
export async function fetchAllPages<T>(
  path: string,
  httpClient: IWooCommerceHttpClient,
  logger: Logger,
  perPage = 100,
  params?: Record<string, string | number | boolean>,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= FETCH_ALL_MAX_PAGES; page++) {
    const items = await httpClient.get<T[]>(path, { ...params, per_page: perPage, page });
    all.push(...items);
    if (items.length < perPage) break;
    if (page >= FETCH_ALL_MAX_PAGES) {
      logger.warn(
        `fetchAllPages: hit MAX_PAGES (${FETCH_ALL_MAX_PAGES}) for ${path} — truncating result`,
      );
      break;
    }
  }
  return all;
}
