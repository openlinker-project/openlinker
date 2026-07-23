/**
 * Webhook Status Types
 *
 * Operator-facing view of a connection's inbound-webhook state (#1770),
 * derived from recorded deliveries + whether a signing secret is stored.
 * Two independent axes: whether the subscription has ever delivered
 * (activation) and whether HMAC signature verification is configured
 * (signature, optional per the inFakt model).
 *
 * @module apps/api/src/integrations/application/types
 */

export const WebhookActivationValues = ['not-registered', 'verified'] as const;
export type WebhookActivation = (typeof WebhookActivationValues)[number];

/**
 * `mismatch` was removed (#1770 review): a bad-secret or missing-secret
 * delivery is rejected by `WebhookService.processWebhook` (auth failure)
 * *before* any `webhook_deliveries` row is written, so `signatureValid` is
 * only ever recorded as `true` - this service can never observe a real
 * signature mismatch. Distinguishing "never registered" from "registered
 * but every delivery is auth-failing" needs a durable signal for rejected
 * deliveries, which is a bigger change than this PR - tracked as a
 * follow-up in #1814.
 */
export const WebhookSignatureStateValues = ['off', 'configured'] as const;
export type WebhookSignatureState = (typeof WebhookSignatureStateValues)[number];

export interface WebhookStatus {
  /**
   * Activation is a heuristic: OpenLinker cannot read back a platform's
   * subscription state, so any recorded delivery is treated as proof the
   * endpoint is registered and verified; none means not-registered. This
   * also covers "registered but every delivery is being rejected before
   * it's recorded" (e.g. no signing secret yet) - see the `off` signature
   * state and the operator copy that pairs with it.
   */
  activation: WebhookActivation;
  /** `off` = no secret stored (every delivery WILL fail auth); `configured` = secret stored. */
  signature: WebhookSignatureState;
  lastDeliveryAt: string | null;
  lastDeliveryEvent: string | null;
  lastDeliveryResult: string | null;
}
