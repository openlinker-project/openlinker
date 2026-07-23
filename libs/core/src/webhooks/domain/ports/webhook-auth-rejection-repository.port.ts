/**
 * Webhook Auth Rejection Repository Port
 *
 * Persistence contract for the per-connection auth-rejection signal (#1814).
 * `recordRejection` upserts one rolling row per `(provider, connectionId)`,
 * incrementing the counter and refreshing `lastRejectedAt`/`lastReason`.
 * `find` reads the current row for the webhook-status projection.
 *
 * @module libs/core/src/webhooks/domain/ports
 */
import type { WebhookAuthRejection } from '../entities/webhook-auth-rejection.entity';

export interface WebhookAuthRejectionRecordInput {
  provider: string;
  connectionId: string;
  reason?: string | null;
  rejectedAt?: Date;
}

export interface WebhookAuthRejectionRepositoryPort {
  /**
   * Record one auth-rejected delivery attempt for a connection. Upsert keyed on
   * `(provider, connectionId)`: inserts the first row (count 1) or increments
   * the existing counter and refreshes `lastRejectedAt`/`lastReason`.
   */
  recordRejection(input: WebhookAuthRejectionRecordInput): Promise<void>;

  /** Read the rolling rejection record for a connection, or `null` if none. */
  find(provider: string, connectionId: string): Promise<WebhookAuthRejection | null>;
}
