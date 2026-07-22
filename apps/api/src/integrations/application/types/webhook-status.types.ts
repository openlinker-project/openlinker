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

export const WebhookSignatureStateValues = ['off', 'configured', 'mismatch'] as const;
export type WebhookSignatureState = (typeof WebhookSignatureStateValues)[number];

export interface WebhookStatus {
  /**
   * Activation is a heuristic: OpenLinker cannot read back a platform's
   * subscription state, so any recorded delivery is treated as proof the
   * endpoint is registered and verified; none means not-registered.
   */
  activation: WebhookActivation;
  /**
   * `off` = no secret stored; `configured` = secret stored; `mismatch` = a
   * secret is stored but the most recent delivery failed signature check.
   */
  signature: WebhookSignatureState;
  lastDeliveryAt: string | null;
  lastDeliveryEvent: string | null;
  lastDeliveryResult: string | null;
}
