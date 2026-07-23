/**
 * Webhook Auth Rejection Domain Entity
 *
 * A durable, per-connection rolling record of inbound webhook deliveries that
 * were rejected during signature verification (missing/wrong signing secret)
 * BEFORE any `webhook_deliveries` row could be written. Kept in a table
 * separate from `webhook_deliveries` so that table stays reserved for
 * successfully-verified deliveries (ADR-005). Backs the `auth-failing`
 * operator-facing webhook status (#1814). Framework-agnostic.
 *
 * @module libs/core/src/webhooks/domain/entities
 */
export class WebhookAuthRejection {
  constructor(
    public readonly id: string,
    public readonly provider: string,
    public readonly connectionId: string,
    public readonly rejectionCount: number,
    public readonly firstRejectedAt: Date,
    public readonly lastRejectedAt: Date,
    public readonly lastReason: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}
}
