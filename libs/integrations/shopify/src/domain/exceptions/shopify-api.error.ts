/**
 * Shopify API Error
 *
 * A non-2xx HTTP answer from the Admin API (or the token endpoint). Carries
 * the status so the retry and auth-failure classifiers can decide without
 * parsing messages. The body is echoed only in a bounded copy: Shopify error
 * bodies carry no secrets, but a stand-in proxy page could be anything.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

const MAX_DETAIL_LENGTH = 300;

export class ShopifyApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly detail?: string,
  ) {
    super(
      `Shopify API returned HTTP ${statusCode}` +
        (detail !== undefined && detail.length > 0 ? `: ${detail.slice(0, MAX_DETAIL_LENGTH)}` : ''),
    );
    this.name = 'ShopifyApiError';
    Error.captureStackTrace(this, this.constructor);
  }

  /** The token is missing, expired or revoked; Shopify answers 401 for all three. */
  isAuthRejection(): boolean {
    return this.statusCode === 401;
  }
}
