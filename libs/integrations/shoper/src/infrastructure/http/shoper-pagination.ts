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
 *     answer 10). A single REQUEST is therefore refused above 50
 *     (`fetchShoperPage`) rather than sent, since a silently short page reads
 *     as the end of the collection. A WINDOW of any size is a different matter:
 *     `fetchShoperWindow` composes it from pages of 50 and slices, so callers
 *     (the sweeps, whose page size is operator-settable) are never constrained
 *     by Shoper's ceiling.
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

/**
 * Upper bound on a window a caller may ask for in one call. The sweeps' page
 * size is operator-settable up to 500 (ADR-069); 1000 leaves headroom while
 * still bounding the number of Shoper requests a single call can issue
 * (1000 / 50 = 20).
 */
export const SHOPER_MAX_WINDOW = 1000;

export interface ShoperWindowRequest {
  /** Zero-based index of the first row wanted, in the order given by `query.order`. */
  readonly offset: number;
  /** Number of rows wanted, 1..{@link SHOPER_MAX_WINDOW}. */
  readonly limit: number;
  readonly query?: ShoperQuery;
}

/**
 * Reads the rows `[offset, offset + limit)` of a collection, however the
 * caller sized its window.
 *
 * Shoper pages by page index with a fixed ceiling of 50, but a caller's
 * window is its own affair (a sweep's budget, a setting changed between two
 * ticks - 100 -> 30 at offset 100). The adapter therefore picks the page size
 * itself, always 50, fetches the pages that cover the window and slices. Any
 * window and any offset is expressible exactly, so nothing has to be refused
 * and nothing is ever read as a short page standing for the end of the
 * collection: the loop stops only on the shop's own last page.
 *
 * The caller must pass an explicit, stable `order` (a bare `order=<field>`
 * sorts descending on Shoper).
 */
export async function fetchShoperWindow<T>(
  client: ShoperHttpClient,
  path: string,
  request: ShoperWindowRequest,
): Promise<T[]> {
  const { offset, limit } = request;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`Shoper ${path}: offset must be a non-negative integer, got ${offset}`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > SHOPER_MAX_WINDOW) {
    throw new RangeError(
      `Shoper ${path}: window size must be an integer between 1 and ${SHOPER_MAX_WINDOW}, got ${limit}`,
    );
  }

  const skip = offset % SHOPER_MAX_PAGE_SIZE;
  const wanted = skip + limit;
  const rows: T[] = [];

  for (let page = Math.floor(offset / SHOPER_MAX_PAGE_SIZE) + 1; rows.length < wanted; page += 1) {
    const result = await fetchShoperPage<T>(client, path, {
      page,
      limit: SHOPER_MAX_PAGE_SIZE,
      ...(request.query === undefined ? {} : { query: request.query }),
    });
    rows.push(...result.items);
    if (result.items.length === 0 || page >= result.pages) {
      break;
    }
  }

  return rows.slice(skip, skip + limit);
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
