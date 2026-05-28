/**
 * PrestaShop WebService Client Interface
 *
 * Defines the contract for PrestaShop WebService API HTTP client operations.
 * Implementations handle authentication, request building, response parsing,
 * and error handling.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http
 */

/**
 * PrestaShop query filters for list operations
 */
export interface PrestashopQueryFilters {
  ids?: (string | number)[];
  dateFrom?: Date;
  dateTo?: Date;
  updatedSince?: Date;
  status?: string | string[];
  custom?: Record<string, string | number | (string | number)[]>;
  /**
   * Field selection override (defaults to `'full'`). Use e.g. `'[id]'` for
   * enumeration-only paths to skip full body payload.
   */
  display?: string;
}

/**
 * PrestaShop WebService Client Interface
 *
 * HTTP client for PrestaShop WebService API operations.
 */
/**
 * Optional control flags for a PrestaShop WebService write (POST/PUT).
 *
 * `sendEmail` maps to the `?sendmail=1` *query* param PrestaShop reads to fire
 * the order-state customer email on an `order_histories` write (#858). It is a
 * PS-WS-protocol concern, so the client owns the wire mapping; callers express
 * intent (`{ sendEmail: true }`). Opt-in per call — never a client default —
 * so non-order writes (carts, customers, …) never email.
 */
export interface PrestashopWriteOptions {
  sendEmail?: boolean;
}

export interface IPrestashopWebserviceClient {
  /**
   * Get a single resource by ID
   *
   * @param resource - Resource name (e.g., 'products', 'orders')
   * @param id - Resource ID
   * @returns Parsed resource data
   * @throws PrestashopResourceNotFoundException if resource not found
   * @throws PrestashopAuthenticationException if authentication fails
   * @throws PrestashopApiException for other API errors
   */
  getResource<T = unknown>(resource: string, id: string | number): Promise<T>;

  /**
   * List resources with optional filters
   *
   * @param resource - Resource name (e.g., 'products', 'orders')
   * @param filters - Optional filter criteria
   * @param limit - Maximum number of results
   * @param offset - Number of results to skip
   * @returns Array of parsed resource data
   * @throws PrestashopAuthenticationException if authentication fails
   * @throws PrestashopApiException for other API errors
   */
  listResources<T = unknown>(
    resource: string,
    filters?: PrestashopQueryFilters,
    limit?: number,
    offset?: number,
  ): Promise<T[]>;

  /**
   * Create a new resource
   *
   * @param resource - Resource name (e.g., 'products', 'orders')
   * @param data - Resource data to create
   * @returns Created resource data with ID
   * @throws PrestashopAuthenticationException if authentication fails
   * @throws PrestashopApiException for other API errors
   */
  createResource<T = unknown>(
    resource: string,
    data: Record<string, unknown>,
    options?: PrestashopWriteOptions,
  ): Promise<T>;

  /**
   * Update an existing resource (PUT).
   *
   * PrestaShop's WebService PUT contract requires the **full resource body**
   * (not a partial patch). Callers should read the resource first, overlay
   * the fields they want to change, and then pass the merged object as `data`.
   * The resource's `id` must be present in `data` — PS WS validates that the
   * body's id matches the path id.
   *
   * @param resource - Resource name (e.g., 'order_carriers', 'orders')
   * @param id - Resource ID (target of the PUT)
   * @param data - Full resource data, including `id`
   * @returns Updated resource data
   * @throws PrestashopAuthenticationException if authentication fails
   * @throws PrestashopResourceNotFoundException if resource not found
   * @throws PrestashopApiException for other API errors
   */
  updateResource<T = unknown>(
    resource: string,
    id: string | number,
    data: Record<string, unknown>,
    options?: PrestashopWriteOptions,
  ): Promise<T>;
}




