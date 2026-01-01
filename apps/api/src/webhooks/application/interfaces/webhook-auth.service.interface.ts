/**
 * Webhook Authentication Service Interface
 *
 * Defines the contract for webhook signature verification and replay protection.
 * Implemented by WebhookAuthService to provide authentication capabilities for
 * inbound webhook requests.
 *
 * @module apps/api/src/webhooks/application/interfaces
 * @see {@link WebhookAuthService} for the implementation
 */

export interface IWebhookAuthService {
  /**
   * Verify webhook signature
   *
   * Validates the HMAC SHA256 signature of the webhook request.
   * Signature scheme: HMAC_SHA256(secret, timestamp + '.' + rawBody)
   *
   * @param provider - Provider identifier (e.g., 'prestashop')
   * @param connectionId - Connection identifier (UUID)
   * @param timestamp - Unix timestamp in milliseconds (from X-OpenLinker-Timestamp header)
   * @param rawBody - Raw request body bytes
   * @param signature - Signature from X-OpenLinker-Signature header (format: sha256=<hex>)
   * @returns Promise resolving to true if signature is valid, false otherwise
   * @throws WebhookAuthenticationException if signature format is invalid or verification fails
   */
  verifySignature(
    provider: string,
    connectionId: string,
    timestamp: string,
    rawBody: Buffer,
    signature: string,
  ): Promise<boolean>;

  /**
   * Validate timestamp for replay protection
   *
   * Checks if the timestamp is within the allowed skew window (default ±5 minutes).
   *
   * @param timestamp - Unix timestamp in milliseconds (string)
   * @param skewWindowMs - Allowed skew window in milliseconds (default: 300000 = 5 minutes)
   * @returns true if timestamp is valid, false otherwise
   * @throws WebhookReplayException if timestamp is outside the allowed window
   */
  validateTimestamp(timestamp: string, skewWindowMs?: number): boolean;
}

