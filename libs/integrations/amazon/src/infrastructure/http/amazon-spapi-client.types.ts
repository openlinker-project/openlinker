/**
 * Amazon SP-API Client Types
 *
 * The request and response shapes of `AmazonSpApiClient`, shared by every
 * capability adapter that calls the Selling Partner API through it.
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */

/**
 * Query parameters. An array is sent comma-joined, which is how SP-API takes
 * list parameters such as `marketplaceIds`.
 */
export type AmazonQuery = Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>;

export interface AmazonSpApiResponse<T> {
  readonly status: number;
  readonly data: T;
  readonly requestId: string | undefined;
}

export const AmazonHttpMethodValues = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type AmazonHttpMethod = (typeof AmazonHttpMethodValues)[number];
