/**
 * PrestaShop Paged Collection Reads
 *
 * One place that answers "did I read the whole collection?" for every
 * PrestaShop list read in this package.
 *
 * The WebService caps a collection read at its page size (100 by default) and
 * says nothing about what it left out, so a caller that issues one read cannot
 * tell a short list from a truncated one. That produced the same defect three
 * times: an order silently lost every line past the hundredth, a product with
 * 120 combinations reported 100, and a pack whose component stock rows were cut
 * read as 0 and published 0 (#2608, #2598). #2616 was the same shape one step
 * out - an ignored filter answering with the first page, read as the whole
 * answer.
 *
 * So a read here has exactly two outcomes: complete, or a throw. There is no
 * third outcome where a short answer is handed back as authoritative.
 *
 * Cost. A page is requested only after the previous one came back full, so a
 * collection that fits in one page still costs one request - which is what keeps
 * the per-SKU request budget this epic works on intact. The extra requests land
 * only on the shops that were being truncated, plus one empty read when a
 * collection happens to be an exact multiple of the page size.
 *
 * Ordering. Offset paging over a result set with no ORDER BY has no tiling
 * guarantee at all - two pages can overlap or leave a hole, which is the same
 * class of wrong answer this file exists to remove, and the reason #2605 sorted
 * the order feed. So a read through the resource helpers below is sorted by
 * `id_ASC` unless the caller asked for its own order. A concurrent insert can
 * still shift a row across a page boundary; that residual hole is inherent to
 * offset paging and far smaller than the one being closed.
 *
 * Page size. Taken from the connection's own `pageSize` when the client
 * exposes it, so an operator who raised it to 1 000 pays one request where the
 * fixed 100 cost ten, and one who lowered it because their shop cannot serve
 * big bodies is honoured. The budgets below are therefore expressed in ROWS,
 * not pages, so a ceiling keeps meaning the same thing whatever the page size.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http
 */
import { PrestashopTruncatedReadException } from '../../domain/exceptions/prestashop-truncated-read.exception';
import type {
  IPrestashopWebserviceClient,
  PrestashopQueryFilters,
} from './prestashop-webservice.client.interface';

/**
 * PrestaShop's own default collection page size.
 */
export const PRESTASHOP_PAGE_SIZE = 100;

/**
 * Row budget for a read narrowed by a filter - one order's lines, one product's
 * combinations, one customer's addresses, one tax group's rules. 5 000 rows is
 * far past any real shop's value for those, so filling it means the filter did
 * not narrow what the caller thought it did, and the loud failure is the point.
 */
export const PRESTASHOP_NARROWED_MAX_ROWS = 5000;

/**
 * Row budget for a read that deliberately enumerates a whole shop-wide
 * collection - categories, feature values, attribute values. These legitimately
 * run to tens of thousands of rows on a large catalogue, so the narrowed budget
 * would refuse a read that is simply big. 50 000 rows is the point past which we
 * would rather an operator hear about it than keep spending requests.
 */
export const PRESTASHOP_UNNARROWED_MAX_ROWS = 50000;

/**
 * Reads one page. `limit` and `offset` map straight onto
 * `IPrestashopWebserviceClient.listResources`.
 */
export type PrestashopPageReader<T> = (limit: number, offset: number) => Promise<T[]>;

export interface PrestashopPagedReadContext {
  /** Collection being read, for the failure message. */
  resource: string;
  /** Connection being read, for the failure message. */
  connectionId: string;
  /** Row ceiling. Defaults to {@link PRESTASHOP_NARROWED_MAX_ROWS}. */
  maxRows?: number;
  /** Defaults to {@link PRESTASHOP_PAGE_SIZE}. */
  pageSize?: number;
  /** Extra context for the failure message, e.g. the filter that was applied. */
  detail?: string;
}

/**
 * Read every page of a collection.
 *
 * @throws PrestashopTruncatedReadException when the page budget runs out before
 *   the collection ends - never a partial array.
 */
export async function readAllPrestashopPages<T>(
  read: PrestashopPageReader<T>,
  ctx: PrestashopPagedReadContext
): Promise<T[]> {
  const pageSize = resolvePageSize(ctx.pageSize);
  const maxPages = resolveMaxPages(ctx.maxRows, pageSize);
  const all: T[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const rows = await read(pageSize, page * pageSize);
    all.push(...rows);

    // A short page is the only end-of-collection signal the WebService gives.
    if (rows.length < pageSize) {
      return all;
    }
  }

  throw new PrestashopTruncatedReadException(
    ctx.resource,
    maxPages,
    pageSize,
    ctx.connectionId,
    ctx.detail
  );
}

/**
 * Scan pages until a row matches, then stop.
 *
 * Kept separate from {@link readAllPrestashopPages} because a resolve-or-create
 * caller wants the first match and must not pay for the rest of the collection.
 * Answers `null` only after seeing the end of the collection, so "absent" is a
 * fact rather than an artefact of where the first page ended.
 *
 * @throws PrestashopTruncatedReadException when the page budget runs out first
 */
export async function findAcrossPrestashopPages<T>(
  read: PrestashopPageReader<T>,
  matches: (row: T) => boolean,
  ctx: PrestashopPagedReadContext
): Promise<T | null> {
  const pageSize = resolvePageSize(ctx.pageSize);
  const maxPages = resolveMaxPages(ctx.maxRows, pageSize);

  for (let page = 0; page < maxPages; page += 1) {
    const rows = await read(pageSize, page * pageSize);

    const match = rows.find(matches);
    if (match !== undefined) {
      return match;
    }

    if (rows.length < pageSize) {
      return null;
    }
  }

  throw new PrestashopTruncatedReadException(
    ctx.resource,
    maxPages,
    pageSize,
    ctx.connectionId,
    ctx.detail
  );
}

/**
 * A page size is only useful if it is a positive whole number, and a client
 * that does not report one keeps PrestaShop's own default.
 */
function resolvePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined || !Number.isFinite(pageSize) || pageSize < 1) {
    return PRESTASHOP_PAGE_SIZE;
  }

  return Math.floor(pageSize);
}

/**
 * The budget is a row count, so the page count it allows moves with the page
 * size. At least one page, or a read could refuse before issuing a request.
 */
function resolveMaxPages(maxRows: number | undefined, pageSize: number): number {
  const rows = maxRows === undefined || maxRows < 1 ? PRESTASHOP_NARROWED_MAX_ROWS : maxRows;

  return Math.max(1, Math.ceil(rows / pageSize));
}

/**
 * The connection's configured page size, when the client reports one.
 *
 * Optional on the client interface so an out-of-tree or test double compiled
 * against an older shape keeps working on PrestaShop's own default rather than
 * failing.
 */
export function prestashopPageSizeOf(client: IPrestashopWebserviceClient): number {
  return resolvePageSize(client.getPageSize?.());
}

/**
 * Sorted, page-sized, budgeted read of one whole collection.
 *
 * Preferred over calling {@link readAllPrestashopPages} with a hand-built
 * reader: the sort and the page size are decided here, so no call site can
 * forget either.
 *
 * @throws PrestashopTruncatedReadException when the row budget runs out first
 */
export async function readAllPrestashopResourcePages<T>(
  client: IPrestashopWebserviceClient,
  resource: string,
  filters: PrestashopQueryFilters | undefined,
  ctx: Omit<PrestashopPagedReadContext, 'resource' | 'pageSize'>
): Promise<T[]> {
  return readAllPrestashopPages<T>(
    (limit, offset) => client.listResources<T>(resource, withStableOrder(filters), limit, offset),
    { ...ctx, resource, pageSize: prestashopPageSizeOf(client) }
  );
}

/**
 * Sorted, page-sized, budgeted scan for the first matching row.
 *
 * @throws PrestashopTruncatedReadException when the row budget runs out first
 */
export async function findAcrossPrestashopResourcePages<T>(
  client: IPrestashopWebserviceClient,
  resource: string,
  filters: PrestashopQueryFilters | undefined,
  matches: (row: T) => boolean,
  ctx: Omit<PrestashopPagedReadContext, 'resource' | 'pageSize'>
): Promise<T | null> {
  return findAcrossPrestashopPages<T>(
    (limit, offset) => client.listResources<T>(resource, withStableOrder(filters), limit, offset),
    matches,
    { ...ctx, resource, pageSize: prestashopPageSizeOf(client) }
  );
}

/**
 * A caller that asked for its own order keeps it - it presumably needs those
 * rows in that order. Everything else gets primary key order, without which the
 * pages have no guarantee of tiling the collection.
 */
function withStableOrder(
  filters: PrestashopQueryFilters | undefined
): PrestashopQueryFilters | undefined {
  if (filters?.sort !== undefined && filters.sort.length > 0) {
    return filters;
  }

  return { ...(filters ?? {}), sort: ['id_ASC'] };
}
