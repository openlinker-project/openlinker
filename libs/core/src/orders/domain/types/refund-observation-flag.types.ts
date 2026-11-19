/**
 * Refund observation switch (#4100)
 *
 * Observing a source channel's refunds costs one extra channel call
 * (Allegro: `GET /payments/refunds`, up to ten pages) on every paid-order sync,
 * so it ships OFF and an operator opts in with `OL_REFUND_OBSERVATION_ENABLED=true`.
 * The single resolution helper: every caller asks here, none reads the env itself.
 *
 * @module libs/core/src/orders/domain/types
 */

export const REFUND_OBSERVATION_ENV_VAR = 'OL_REFUND_OBSERVATION_ENABLED';

export function isRefundObservationEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const raw = env[REFUND_OBSERVATION_ENV_VAR];
  return typeof raw === 'string' && ['true', '1'].includes(raw.trim().toLowerCase());
}
