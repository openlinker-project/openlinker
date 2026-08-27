/**
 * PrestaShop Query Builder
 *
 * Builds PrestaShop WebService API query strings for filters, pagination,
 * sorting, and field selection. Handles PrestaShop-specific query syntax
 * including automatic `date=1` addition for date filtering.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http
 */
import type { PrestashopConnectionConfig } from '@openlinker/integrations-prestashop';

import { PrestashopInvalidFilterException } from '../../domain/exceptions/prestashop-invalid-filter.exception';

/**
 * PrestaShop query filters
 *
 * Internal representation of filters before conversion to PrestaShop query syntax.
 */
export interface PrestashopQueryFilters {
  /**
   * Filter by IDs (array of IDs)
   */
  ids?: (string | number)[];

  /**
   * Date range filters
   */
  dateFrom?: Date;
  dateTo?: Date;

  /**
   * `date_upd` lower bound, exclusive, as the shop's own wall clock
   * (`YYYY-MM-DD HH:MM:SS`) and emitted verbatim.
   *
   * A string, not a `Date` (#2605). PrestaShop's `date_upd` is a zone-less
   * `DATETIME` written by the shop, so formatting a `Date` here read the
   * worker's clock and compared it against the shop's - the same naive string
   * only by accident, and a different one the moment the container's timezone
   * changed. Offset the wrong way and the filter excludes real orders while the
   * cursor stays put. The caller therefore hands over the shop's own reading and
   * nothing here interprets it.
   */
  updatedAfter?: string;

  /**
   * Status filters
   */
  status?: string | string[];

  /**
   * Custom filters (key-value pairs)
   */
  custom?: Record<string, string | number | (string | number)[]>;

  /**
   * Result ordering, one entry per column, e.g. `['date_upd_ASC', 'id_ASC']`.
   *
   * PrestaShop answers an unsorted collection read in primary-key order. For a
   * read whose cursor is a value other than the primary key - the order feed's
   * `date_upd` watermark - that is not the same order, so a row with a higher id
   * and an older timestamp ends a page and is then never revisited (#2605). A
   * paged read whose cursor is not the sort key is unsound, so the sort is
   * stated rather than inherited, and stated as a closed union so a sweep
   * cannot ship a typo that PrestaShop would answer with a 400 (#2593).
   */
  sort?: PrestashopSort[];

  /**
   * Field selection override.
   *
   * Defaults to `'full'`. Set to `'[id]'` (or another PrestaShop display clause)
   * for enumeration-only paths where body payload is wasted bandwidth — e.g.,
   * initial catalog discovery fan-out.
   */
  display?: string;
}

/**
 * Sortable columns, as a closed union rather than a runtime allow-list.
 *
 * A caller naming a column the resource does not have gets a PrestaShop 400,
 * so the check has to exist; making it a type puts it at compile time, where a
 * sweep cannot ship a typo. `date_upd` is here because the incremental and
 * resumable catalogue passes order on it.
 */
export const PrestashopSortFieldValues = [
  'id',
  'date_upd',
  'date_add',
  'reference',
] as const;
export type PrestashopSortField = (typeof PrestashopSortFieldValues)[number];

export type PrestashopSortDirection = 'ASC' | 'DESC';

/**
 * One sort entry: an allowed column plus PrestaShop's own direction suffix.
 *
 * A template literal rather than a `{field, direction}` pair because the wire
 * form is a single token, so the type that callers write is the token that goes
 * out - there is no shape to get wrong between the two.
 */
export type PrestashopSort = `${PrestashopSortField}_${PrestashopSortDirection}`;

/**
 * A PrestaShop WebService filter targets one database column, so the only shape
 * a key may take is a bare column name.
 */
const FILTER_FIELD_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * A sort entry is one bare column name plus PrestaShop's own direction suffix.
 * Same reasoning as the filter key: the builder owns the envelope, so a caller
 * that smuggles syntax through the value gets a refusal, not a query PrestaShop
 * quietly ignores.
 */
const SORT_ENTRY_PATTERN = /^[A-Za-z0-9_]+_(ASC|DESC)$/;

/**
 * PrestaShop Query Builder
 *
 * Builds query strings for PrestaShop WebService API requests.
 */
export class PrestashopQueryBuilder {
  /**
   * Build query string for PrestaShop API request
   *
   * @param resource - Resource name (e.g., 'products', 'orders')
   * @param filters - Filter criteria
   * @param config - Connection configuration
   * @returns Query string (without leading '?')
   */
  static buildQuery(
    _resource: string,
    filters?: PrestashopQueryFilters,
    config?: PrestashopConnectionConfig
  ): string {
    const params: string[] = [];

    // Field selection: default to display=full, allow override for id-only enumeration.
    params.push(`display=${filters?.display ?? 'full'}`);

    // Multi-store support: add id_shop if shopId is configured
    if (config !== undefined) {
      const typedConfig = config;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
      const shopId: number | undefined = typedConfig.shopId;
      if (shopId !== undefined && typeof shopId === 'number' && shopId > 0) {
        params.push(`id_shop=${shopId}`);
      }
    }

    // Date filtering: PrestaShop requires date=1 to enable date filters
    const hasDateFilters = filters?.dateFrom || filters?.dateTo || filters?.updatedAfter;
    if (hasDateFilters) {
      params.push('date=1');
    }

    // ID filters.
    //
    // Pipe-joined, never comma-joined: PrestaShop reads `[1,9]` as the RANGE
    // 1 to 9 and `[1|9]` as the OR list of exactly those two. A comma here
    // returned every id between the lowest and highest requested one, which on
    // a page of ids sampled from a large catalogue is most of the catalogue.
    if (filters?.ids && filters.ids.length > 0) {
      const idsParam = filters.ids.map(String).join('|');
      params.push(`filter[id]=[${idsParam}]`);
    }

    // Date range filters
    if (filters?.dateFrom) {
      const dateStr = this.formatDate(filters.dateFrom);
      params.push(`filter[date_add]=>[${dateStr}]`);
    }

    if (filters?.dateTo) {
      const dateStr = this.formatDate(filters.dateTo);
      params.push(`filter[date_add]=<=[${dateStr}]`);
    }

    // Updated since filter
    if (filters?.updatedAfter) {
      params.push(`filter[date_upd]=>[${filters.updatedAfter}]`);
    }

    // Result ordering
    if (filters?.sort && filters.sort.length > 0) {
      for (const entry of filters.sort) {
        this.assertSortEntry(entry);
      }
      params.push(`sort=[${filters.sort.join(',')}]`);
    }

    // Status filters
    if (filters?.status) {
      const statusArray = Array.isArray(filters.status) ? filters.status : [filters.status];
      const statusParam = statusArray.map(String).join(',');
      params.push(`filter[current_state]=[${statusParam}]`);
    }

    // Custom filters
    // PrestaShop filter syntax: filter[field]=[value]
    // Values must be URL-encoded to handle special characters (e.g., +, @, = in email addresses)
    if (filters?.custom) {
      for (const [key, value] of Object.entries(filters.custom)) {
        this.assertFilterKey(key);
        if (Array.isArray(value)) {
          const arrayParam = value.map((v) => encodeURIComponent(String(v))).join(',');
          params.push(`filter[${key}]=[${arrayParam}]`);
        } else {
          const encodedValue = encodeURIComponent(String(value));
          params.push(`filter[${key}]=[${encodedValue}]`);
        }
      }
    }

    return params.join('&');
  }

  /**
   * Build query string with pagination
   *
   * @param resource - Resource name
   * @param filters - Filter criteria
   * @param config - Connection configuration
   * @param limit - Maximum number of results
   * @param offset - Number of results to skip
   * @returns Query string with pagination
   */
  static buildQueryWithPagination(
    resource: string,
    filters?: PrestashopQueryFilters,
    config?: PrestashopConnectionConfig,
    limit?: number,
    offset?: number
  ): string {
    const baseQuery = this.buildQuery(resource, filters, config);
    const params: string[] = [baseQuery];

    // Pagination. PrestaShop's WebService has no standalone `offset` parameter:
    // paging is expressed entirely through `limit` using the `[offset,]count`
    // comma syntax (offset 0-indexed). e.g. `limit=200,200` = 200 rows starting
    // at element 201. A bare `offset=N` is silently ignored by PrestaShop, which
    // made every page return the same first `count` rows (issue #851). The comma
    // form requires a count, so an offset with no limit cannot be expressed and
    // is dropped — the only offset>0 caller (listExternalIds) always passes limit.
    if (limit !== undefined && limit > 0) {
      params.push(
        offset !== undefined && offset > 0 ? `limit=${offset},${limit}` : `limit=${limit}`
      );
    }

    return params.join('&');
  }

  /**
   * Reject a custom filter key the WebService cannot express.
   *
   * PrestaShop takes a bare field name inside the `filter[...]` envelope the
   * builder adds. A caller that passes an already-wrapped key produces
   * `filter[filter[reference]]`, which PrestaShop does not recognise: it drops
   * the condition, returns the first page unfiltered, and the caller reads that
   * as a legitimate result. On a catalogue larger than one page the row it was
   * looking for is simply absent, with no error anywhere. Worse, a caller that
   * writes back through `rows[0]` of such a page - as `updateStock` did - PATCHes
   * an arbitrary unrelated row (#2616). A wrong filter must therefore be louder
   * than a wrong answer.
   *
   * @param key - Custom filter field name
   * @throws PrestashopInvalidFilterException when the key is not a bare field name
   */
  private static assertFilterKey(key: string): void {
    if (FILTER_FIELD_PATTERN.test(key)) {
      return;
    }

    throw new PrestashopInvalidFilterException(key);
  }

  /**
   * Reject a sort entry the WebService cannot express.
   *
   * @param entry - Sort entry, e.g. `date_upd_ASC`
   * @throws PrestashopInvalidFilterException when the entry is not `<column>_ASC|DESC`
   */
  private static assertSortEntry(entry: string): void {
    if (SORT_ENTRY_PATTERN.test(entry)) {
      return;
    }

    throw new PrestashopInvalidFilterException(entry);
  }

  /**
   * Format date for PrestaShop API
   *
   * PrestaShop expects dates in format: YYYY-MM-DD HH:MM:SS
   *
   * @param date - Date to format
   * @returns Formatted date string
   */
  private static formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * Build resource URL path
   *
   * @param resource - Resource name (e.g., 'products', 'orders')
   * @param id - Optional resource ID
   * @returns Resource path (e.g., '/api/products/1' or '/api/products')
   */
  static buildResourcePath(resource: string, id?: string | number): string {
    if (id !== undefined) {
      return `/api/${resource}/${id}`;
    }
    return `/api/${resource}`;
  }
}
