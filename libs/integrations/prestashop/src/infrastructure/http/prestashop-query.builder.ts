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
  updatedSince?: Date;

  /**
   * Status filters
   */
  status?: string | string[];

  /**
   * Custom filters (key-value pairs)
   */
  custom?: Record<string, string | number | (string | number)[]>;

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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const shopId: number | undefined = typedConfig.shopId;
      if (shopId !== undefined && typeof shopId === 'number' && shopId > 0) {
        params.push(`id_shop=${shopId}`);
      }
    }

    // Date filtering: PrestaShop requires date=1 to enable date filters
    const hasDateFilters = filters?.dateFrom || filters?.dateTo || filters?.updatedSince;
    if (hasDateFilters) {
      params.push('date=1');
    }

    // ID filters
    if (filters?.ids && filters.ids.length > 0) {
      const idsParam = filters.ids.map(String).join(',');
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
    if (filters?.updatedSince) {
      const dateStr = this.formatDate(filters.updatedSince);
      params.push(`filter[date_upd]=>[${dateStr}]`);
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

    // Pagination
    if (limit !== undefined && limit > 0) {
      params.push(`limit=${limit}`);
    }

    if (offset !== undefined && offset > 0) {
      params.push(`offset=${offset}`);
    }

    return params.join('&');
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
