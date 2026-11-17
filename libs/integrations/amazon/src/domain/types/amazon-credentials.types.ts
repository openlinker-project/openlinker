/**
 * Amazon Credentials Types
 *
 * The secret half of an Amazon connection. Every SP-API call is authorized
 * with a short-lived LWA access token minted from these three values, whatever
 * way the refresh token was obtained:
 *
 *   - `self-authorized` - the operator registered a PRIVATE SP-API app and
 *     authorized it for their own seller account in Seller Central, then
 *     pasted the refresh token here. No redirect, no public-app obligations;
 *     Amazon allows ten self-authorizations per app.
 *   - `oauth` - a PUBLIC app: the seller was redirected to Amazon and the
 *     `spapi_oauth_code` was exchanged for the refresh token. Written by the
 *     OAuth completion step (a later child of the epic, it needs a registered
 *     public app).
 *
 * The two differ only in how the refresh token was obtained, so the runtime
 * (token provider, client, tester, classifiers) is shared. The source is
 * recorded so the connection page can say how to re-authorize.
 *
 * @module libs/integrations/amazon/src/domain/types
 */

export const AmazonCredentialSourceValues = ['self-authorized', 'oauth'] as const;
export type AmazonCredentialSource = (typeof AmazonCredentialSourceValues)[number];

export interface AmazonCredentials {
  /** LWA client identifier of the SP-API app (`amzn1.application-oa2-client...`). */
  readonly clientId: string;
  readonly clientSecret: string;
  /** Long-lived LWA refresh token (`Atzr|...`) for one selling partner. */
  readonly refreshToken: string;
  /** Absent reads as `self-authorized`, the only source the foundation can produce. */
  readonly source?: AmazonCredentialSource;
  /** Seller id Amazon returns on an OAuth authorization; informational. */
  readonly sellingPartnerId?: string;
  /**
   * AWS access key allowed to read and delete messages on the notification
   * queue (#4179). Both or neither; needed only with a notification queue.
   */
  readonly awsAccessKeyId?: string;
  readonly awsSecretAccessKey?: string;
}
