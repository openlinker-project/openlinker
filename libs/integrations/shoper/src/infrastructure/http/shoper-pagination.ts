/**
 * Shoper Pagination
 *
 * One place for how Shoper's collection endpoints are paged, because three of
 * its behaviours are easy to get silently wrong (all verified against a live
 * shop):
 *
 *   - Paging is PAGE-based (`page`, `limit`), and the envelope's `count` is a
 *     string while `pages` / `page` are numbers.
 *   - **`limit` is capped at 50, and a larger value is NOT rejected**: Shoper
 *     silently falls back to 10 rows per page (`limit=51` and `limit=500` both
 *     answer 10). A caller that believes it asked for 100 would read a short
 *     page as the end of the collection, so this helper refuses an oversized
 *     page instead of sending it.
 *   - A bare `order=<field>` sorts DESCENDING. Callers pass an explicit
 *     direction (`product_id ASC`); the helper does not pick one.
 *
 * @module libs/integrations/shoper/src/infrastructure/http
 */
import { exceedsAdapterPageSize } from '@openlinker/core/operational-settings';

import { ShoperNetworkError } from '../../domain/exceptions/shoper-network.error';
import type { ShoperPageEnvelope } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient, ShoperQuery } from './shoper-http-client';

/** Shoper's hard `limit` ceiling; anything above it silently becomes 10. */
export const SHOPER_MAX_PAGE_SIZE = 50;

export interface ShoperPageRequest {
  /** 1-based page index. */
  readonly page: number;
  /** Rows per page, 1..{@link SHOPER_MAX_PAGE_SIZE}. */
  readonly limit: number;
  /** Extra query parameters: filters, `order` (always with an explicit direction). */
  readonly query?: ShoperQuery;
}

export interface ShoperPage<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pages: number;
  /** Total rows in the whole collection (the envelope sends it as a string). */
  readonly count: number;
}

/**
 * Refuses a page size Shoper would silently shrink. Throws rather than clamps:
 * a clamped page is always short, which a paging loop reads as the last page.
 */
export function assertShoperPageSize(limit: number, operation: string): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`Shoper ${operation}: page size must be a positive integer, got ${limit}`);
  }
  if (exceedsAdapterPageSize(limit, SHOPER_MAX_PAGE_SIZE)) {
    throw new RangeError(
      `Shoper ${operation}: page size ${limit} exceeds Shoper's maximum of ${SHOPER_MAX_PAGE_SIZE} ` +
        '(a larger value is silently reduced to 10 by the shop)',
    );
  }
}

export async function fetchShoperPage<T>(
  client: ShoperHttpClient,
  path: string,
  request: ShoperPageRequest,
): Promise<ShoperPage<T>> {
  assertShoperPageSize(request.limit, `GET ${path}`);

  const { data } = await client.get<Partial<ShoperPageEnvelope<T>>>(path, {
    ...request.query,
    limit: request.limit,
    page: request.page,
  });

  const count = Number(data.count);
  if (!Array.isArray(data.list) || typeof data.pages !== 'number' || !Number.isFinite(count)) {
    throw new ShoperNetworkError(`Shoper returned an unreadable list response for ${path}`);
  }

  return {
    items: data.list as readonly T[],
    page: typeof data.page === 'number' ? data.page : request.page,
    pages: data.pages,
    count,
  };
}
