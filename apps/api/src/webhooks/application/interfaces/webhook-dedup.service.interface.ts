/**
 * Webhook Deduplication Service Interface
 *
 * Defines the contract for webhook deduplication operations. Implemented by
 * WebhookDedupService to provide two-phase deduplication (processing → done)
 * to prevent lost events and ensure idempotent webhook processing.
 *
 * @module apps/api/src/webhooks/application/interfaces
 * @see {@link WebhookDedupService} for the implementation
 */
export interface IWebhookDedupService {
  /**
   * Mark webhook event as processing
   *
   * Attempts to mark an event as "processing" using Redis SET NX.
   * Returns true if the event is new (marking succeeded), false if already processing/done.
   *
   * @param provider - Provider identifier (e.g., 'prestashop')
   * @param connectionId - Connection identifier (UUID)
   * @param eventId - Event identifier (from webhook payload)
   * @param ttlSeconds - TTL for processing marker in seconds (default: 60)
   * @returns Promise resolving to true if new event, false if duplicate
   */
  markProcessing(
    provider: string,
    connectionId: string,
    eventId: string,
    ttlSeconds?: number,
  ): Promise<boolean>;

  /**
   * Mark webhook event as done
   *
   * Marks an event as "done" after successful processing. Uses Redis SET XX
   * to ensure the key exists (was in "processing" state).
   *
   * @param provider - Provider identifier
   * @param connectionId - Connection identifier
   * @param eventId - Event identifier
   * @param ttlSeconds - TTL for done marker in seconds (default: 604800 = 7 days)
   * @returns Promise that resolves when done marker is set
   */
  markDone(
    provider: string,
    connectionId: string,
    eventId: string,
    ttlSeconds?: number,
  ): Promise<void>;

  /**
   * Clear processing marker
   *
   * Removes the processing marker to allow retries. Used when publish fails
   * after marking as processing, to prevent permanent suppression of retries.
   *
   * @param provider - Provider identifier
   * @param connectionId - Connection identifier
   * @param eventId - Event identifier
   * @returns Promise that resolves when marker is cleared
   */
  clearProcessing(
    provider: string,
    connectionId: string,
    eventId: string,
  ): Promise<void>;
}

