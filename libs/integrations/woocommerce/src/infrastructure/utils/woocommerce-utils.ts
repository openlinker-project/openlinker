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
import { WooCommerceInvalidIdentifierException } from '../../domain/exceptions/woocommerce-invalid-identifier.exception';

/**
 * Safety cap: prevents unbounded pagination in pathological cases.
 * 500 pages × 100 items = 50,000 items max per call.
 */
export const FETCH_ALL_MAX_PAGES = 500;

/**
 * Normalise a WooCommerce _gmt field to a valid UTC ISO 8601 string.
 *
 * WC REST API v3 returns _gmt fields without Z suffix ("2024-01-15T10:30:00").
 * Fallback chain:
 *   1. gmt present → append Z if missing
 *   2. gmt absent, local present → append Z to local field
 *   3. both absent → epoch sentinel — detectable, always sorts before real timestamps
 */
export function normGmt(gmt: string, local: string): string {
  const base = gmt || local;
  if (!base) return new Date(0).toISOString();
  return base.endsWith('Z') ? base : base + 'Z';
}

/**
 * Canonical positive-integer coercion for WooCommerce resource ids.
 *
 * Converts a value to a positive integer, THROWING
 * `WooCommerceInvalidIdentifierException` when the conversion fails or the
 * result is not a finite positive integer (NaN, Infinity, zero, negative,
 * non-numeric string). Throwing rather than returning a sentinel means a
 * corrupted identifier mapping fails fast at the point of use instead of
 * silently producing a malformed request path like `/products/NaN`.
 *
 * `label` is woven into the error message so the caller's context (e.g.
 * "product id", "variation id") survives in the thrown error.
 *
 * @throws {WooCommerceInvalidIdentifierException} when `value` is not a
 *   finite positive integer.
 */
export function toPositiveInt(value: unknown, label = 'identifier'): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new WooCommerceInvalidIdentifierException(
      `WooCommerce ${label} must be a positive integer, received: ${JSON.stringify(value)}`,
      value,
    );
  }
  return Math.floor(n);
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
