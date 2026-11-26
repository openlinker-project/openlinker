/**
 * Mirakl Pagination
 *
 * Mirakl paginates two ways, both seen on Empik staging:
 *
 * - **Offset** (OR11 orders, OF21 offers, P31 products): `max` + `offset` in,
 *   the items under a resource key plus `total_count` out.
 * - **Seek** (OF02 offer imports, RT11 returns, PRI02 price imports): `limit` +
 *   `page_token` in, `data` plus `next_page_token` out.
 *
 * Both readers stop at `maxPages` and say so through `truncated`, so a caller
 * can never mistake a partial read for the whole list.
 *
 * @module libs/integrations/mirakl/src/infrastructure/http
 */
import { MiraklNetworkException } from '../../domain/exceptions/mirakl-network.exception';
import type { IMiraklHttpClient } from './mirakl-http-client.interface';
import type {
  MiraklOffsetPage,
  MiraklQueryValue,
  MiraklSeekPage,
} from './mirakl-http-client.types';

/** Mirakl's own maximum page size for both styles. */
export const MIRAKL_MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 50;

export interface MiraklListResult<T> {
  readonly items: T[];
  /** `true` when `maxPages` stopped the read before the list ended. */
  readonly truncated: boolean;
}

interface ListOptions {
  readonly queryParams?: Readonly<Record<string, MiraklQueryValue>>;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export interface OffsetListOptions extends ListOptions {
  /** Key the items sit under, e.g. `orders`, `offers`, `products`. */
  readonly itemsKey: string;
}

export async function listAllOffset<T>(
  client: IMiraklHttpClient,
  path: string,
  options: OffsetListOptions,
): Promise<MiraklListResult<T>> {
  const pageSize = clampPageSize(options.pageSize);
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const items: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const { data } = await client.get<MiraklOffsetPage>(path, {
      queryParams: { ...options.queryParams, max: pageSize, offset: page * pageSize },
    });
    const pageItems = data?.[options.itemsKey];
    if (!Array.isArray(pageItems)) {
      throw new MiraklNetworkException(
        `Mirakl ${path} returned a page without a "${options.itemsKey}" array`,
      );
    }
    items.push(...(pageItems as T[]));
    const total = typeof data.total_count === 'number' ? data.total_count : undefined;
    const ended =
      pageItems.length < pageSize || (total !== undefined && items.length >= total);
    if (ended) {
      return { items, truncated: false };
    }
  }
  return { items, truncated: true };
}

export async function listAllSeek<T>(
  client: IMiraklHttpClient,
  path: string,
  options: ListOptions = {},
): Promise<MiraklListResult<T>> {
  const pageSize = clampPageSize(options.pageSize);
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const items: T[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const { data } = await client.get<MiraklSeekPage<T>>(path, {
      queryParams: { ...options.queryParams, limit: pageSize, page_token: pageToken },
    });
    const pageItems: unknown = data?.data;
    if (!Array.isArray(pageItems)) {
      throw new MiraklNetworkException(`Mirakl ${path} returned a page without a "data" array`);
    }
    items.push(...(pageItems as readonly T[]));
    const next = data.next_page_token;
    if (typeof next !== 'string' || next.length === 0) {
      return { items, truncated: false };
    }
    pageToken = next;
  }
  return { items, truncated: true };
}

function clampPageSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size)) {
    return MIRAKL_MAX_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(size), 1), MIRAKL_MAX_PAGE_SIZE);
}
