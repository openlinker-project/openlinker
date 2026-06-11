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
   * 3. Verify signature via the decoder; replay-check the normalized timestamp
   * 4. Decode the body → route | ignore (202, no publish) | reject (400)
   * 5. Dedup gate → publish event → record delivery
   *
   * @param provider - Provider identifier (e.g., 'prestashop', 'inpost')
   * @param connectionId - Connection identifier (UUID)
   * @param rawBody - Raw request body bytes (the decoder verifies + parses these)
   * @param headers - Request headers (provider-specific signature/timestamp/topic)
   * @throws WebhookAuthenticationException if signature/connection is invalid (401)
   * @throws WebhookReplayException if timestamp is out of window (401)
   * @throws WebhookDecodeException if the body can't be decoded (400)
   */
  processWebhook(
    provider: string,
    connectionId: string,
    rawBody: Buffer,
    headers: Record<string, string>
  ): Promise<void>;
}
