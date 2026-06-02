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
 * Exhausts a paginated WC REST endpoint, collecting all items across pages.
 * Breaks early when the last page returns fewer items than `perPage`, or
 * when the safety cap is hit (warns and truncates — does not throw).
 */
export async function fetchAllPages<T>(
  path: string,
  httpClient: IWooCommerceHttpClient,
  logger: Logger,
  perPage = 100,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= FETCH_ALL_MAX_PAGES; page++) {
    const items = await httpClient.get<T[]>(path, { per_page: perPage, page });
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
