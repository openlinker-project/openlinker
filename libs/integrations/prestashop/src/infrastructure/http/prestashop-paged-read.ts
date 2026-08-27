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
 * Ordering. `PrestashopQueryFilters` exposes no sort, and PrestaShop answers an
 * unsorted collection read in primary-key order, so the pages tile the
 * collection as long as nothing inserts into it mid-scan. A concurrent insert
 * can still shift a row across a page boundary; that hole is far smaller than
 * the one being closed, which fired on every read of a collection over one page.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http
 */
import { PrestashopTruncatedReadException } from '../../domain/exceptions/prestashop-truncated-read.exception';

/**
 * PrestaShop's own default collection page size.
 */
export const PRESTASHOP_PAGE_SIZE = 100;

/**
 * Page budget for a read narrowed by a filter - one order's lines, one product's
 * combinations, one customer's addresses, one tax group's rules. 5 000 rows is
 * far past any real shop's value for those, so filling it means the filter did
 * not narrow what the caller thought it did, and the loud failure is the point.
 */
export const PRESTASHOP_NARROWED_MAX_PAGES = 50;

/**
 * Page budget for a read that deliberately enumerates a whole shop-wide
 * collection - categories, feature values, attribute values. These legitimately
 * run to tens of thousands of rows on a large catalogue, so the narrowed budget
 * would refuse a read that is simply big. 50 000 rows is the point past which we
 * would rather an operator hear about it than keep spending requests.
 */
export const PRESTASHOP_UNNARROWED_MAX_PAGES = 500;

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
  /** Defaults to {@link PRESTASHOP_NARROWED_MAX_PAGES}. */
  maxPages?: number;
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
  const pageSize = ctx.pageSize ?? PRESTASHOP_PAGE_SIZE;
  const maxPages = ctx.maxPages ?? PRESTASHOP_NARROWED_MAX_PAGES;
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
  const pageSize = ctx.pageSize ?? PRESTASHOP_PAGE_SIZE;
  const maxPages = ctx.maxPages ?? PRESTASHOP_NARROWED_MAX_PAGES;

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
