/**
 * Webhook Status Types
 *
 * Operator-facing view of a connection's inbound-webhook state (#1770),
 * derived from recorded deliveries + whether a signing secret is stored.
 * Two independent axes: whether the subscription has ever delivered
 * (activation) and whether HMAC signature verification is configured
 * (signature). A stored signing secret is required in practice - a
 * delivery with a missing or invalid secret is rejected before it is
 * recorded - so `off` means the connection cannot yet accept any
 * delivery, not that signing is genuinely optional.
 *
 * @module apps/api/src/integrations/application/types
 */

/**
 * `auth-failing` (#1814): deliveries ARE arriving but every one is rejected at
 * signature verification (missing/wrong secret) before a `webhook_deliveries`
 * row can be written (ADR-005). Derived from the durable per-connection
 * `webhook_auth_rejections` signal, it makes an actively-failing integration
 * visually distinct from an inert `not-registered` one. Self-healing:
 * `verified` wins once a real delivery lands after the fix, and the state
 * reverts to `not-registered` once rejections stop (freshness window).
 */
export const WebhookActivationValues = ['not-registered', 'verified', 'auth-failing'] as const;
export type WebhookActivation = (typeof WebhookActivationValues)[number];

/**
 * `mismatch` was removed (#1770 review): a bad-secret or missing-secret
 * delivery is rejected by `WebhookService.processWebhook` (auth failure)
 * *before* any `webhook_deliveries` row is written, so `signatureValid` is
 * only ever recorded as `true` - this service can never observe a real
 * signature mismatch. The "registered but every delivery is auth-failing"
 * case is surfaced on the separate `activation: 'auth-failing'` axis (#1814),
 * derived from the durable `webhook_auth_rejections` signal.
 */
export const WebhookSignatureStateValues = ['off', 'configured'] as const;
export type WebhookSignatureState = (typeof WebhookSignatureStateValues)[number];

export interface WebhookStatus {
  /**
   * Activation is a heuristic: OpenLinker cannot read back a platform's
   * subscription state, so it is inferred from delivery/rejection history — a
   * verified delivery means `verified`; a recent auth rejection with no newer
   * verified delivery means `auth-failing`; neither means `not-registered`.
   */
  activation: WebhookActivation;
  /** `off` = no secret stored (every delivery WILL fail auth); `configured` = secret stored. */
  signature: WebhookSignatureState;
  lastDeliveryAt: string | null;
  lastDeliveryEvent: string | null;
  lastDeliveryResult: string | null;
}
