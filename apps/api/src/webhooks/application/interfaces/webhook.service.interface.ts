/**
 * Webhook Service Interface
 *
 * Defines the contract for webhook processing operations. Implemented by
 * WebhookService to orchestrate the complete webhook ingestion flow including
 * signature verification, deduplication, and event publishing.
 *
 * @module apps/api/src/webhooks/application/interfaces
 * @see {@link WebhookService} for the implementation
 */
export interface IWebhookService {
  /**
   * Process an inbound webhook request (ADR-021)
   *
   * Orchestrates the complete webhook processing flow:
   * 1. Resolve the per-provider decoder (default = OL-HMAC + WebhookRequestDto)
   * 2. Connection gate (exists, active, platformType matches)
   * 3. Subscription-verification handshake — if detected, return its echo
   *    body immediately (no verify/dedup/publish)
   * 4. Verify signature via the decoder; replay-check the normalized timestamp
   * 5. Decode the body → route | ignore (202, no publish) | reject (400)
   * 6. Dedup gate → publish event → record delivery
   *
   * @param provider - Provider identifier (e.g., 'prestashop', 'inpost')
   * @param connectionId - Connection identifier (UUID)
   * @param rawBody - Raw request body bytes (the decoder verifies + parses these)
   * @param headers - Request headers (provider-specific signature/timestamp/topic)
   * @returns the handshake echo body when the request is a subscription
   *   verification ping; otherwise resolves with no value
   * @throws WebhookAuthenticationException if signature/connection is invalid (401)
   * @throws WebhookReplayException if timestamp is out of window (401)
   * @throws WebhookDecodeException if the body can't be decoded (400)
   */
  processWebhook(
    provider: string,
    connectionId: string,
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<Record<string, unknown> | void>;
}
