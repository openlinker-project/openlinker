/**
 * Shopify API Error
 *
 * A non-2xx HTTP answer from the Admin API or from the token endpoint.
 * Carries the status, and for a refused token request the grant error code,
 * so the tester and the classifiers decide on fields, never on message text.
 * The body is echoed only in a bounded copy: Shopify error bodies carry no
 * secrets, but a stand-in proxy page could be anything.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

const MAX_DETAIL_LENGTH = 300;

export const ShopifyApiErrorSourceValues = ['admin-api', 'token-endpoint'] as const;
export type ShopifyApiErrorSource = (typeof ShopifyApiErrorSourceValues)[number];

export class ShopifyApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly detail?: string,
    readonly source: ShopifyApiErrorSource = 'admin-api',
    /** The token endpoint's error code (`invalid_client`, `app_not_installed`, ...), when it named one. */
    readonly grantError: string | null = null,
  ) {
    super(
      `Shopify ${source === 'token-endpoint' ? 'token request' : 'API'} returned HTTP ${statusCode}` +
        (grantError !== null ? ` (${grantError})` : '') +
        (detail !== undefined && detail.length > 0 ? `: ${detail.slice(0, MAX_DETAIL_LENGTH)}` : ''),
    );
    this.name = 'ShopifyApiError';
    Error.captureStackTrace(this, this.constructor);
  }

  /** The Admin API rejected the token: missing, expired or revoked (Shopify answers 401 for all three). */
  isAuthRejection(): boolean {
    return this.source === 'admin-api' && this.statusCode === 401;
  }

  isTokenRequestRefused(): boolean {
    return this.source === 'token-endpoint';
  }
}
