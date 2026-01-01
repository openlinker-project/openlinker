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
import { WebhookRequestDto } from '../../http/dto/webhook-request.dto';

export interface IWebhookService {
  /**
   * Process an inbound webhook request
   *
   * Orchestrates the complete webhook processing flow:
   * 1. Validate connection exists and is active
   * 2. Verify signature (via IWebhookAuthService)
   * 3. Validate timestamp (replay protection)
   * 4. Check deduplication (via IWebhookDedupService)
   * 5. Publish event (via IWebhookEventPublisher)
   * 6. Mark as done (via IWebhookDedupService)
   *
   * @param provider - Provider identifier (e.g., 'prestashop')
   * @param connectionId - Connection identifier (UUID)
   * @param request - Webhook request DTO
   * @param rawBody - Raw request body bytes for signature verification
   * @param headers - Request headers (including X-OpenLinker-Timestamp and X-OpenLinker-Signature)
   * @throws WebhookAuthenticationException if signature is invalid
   * @throws WebhookReplayException if timestamp is out of window
   * @throws Error if connection not found or processing fails
   */
  processWebhook(
    provider: string,
    connectionId: string,
    request: WebhookRequestDto,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<void>;
}

