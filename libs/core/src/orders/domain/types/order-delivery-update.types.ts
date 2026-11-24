/**
 * Order Delivery Update Types
 *
 * Vocabulary of relaying a changed delivery point / shipping method to the
 * destination copy of an order (#4195): what a destination answers, what the
 * order's sync status remembers about it, and the value fingerprint that makes
 * the relay idempotent on WHAT was carried rather than on the event that
 * announced it.
 *
 * @module domain/types
 */
import { createHash } from 'node:crypto';

import type { OrderPickupPoint, OrderShipping } from './order.types';

/**
 * Why a destination declined to edit its copy. Closed: the operator-facing
 * surface renders each, and an unknown reason would read as a bare failure.
 *
 * - `cancelled` - the copy was cancelled at the destination.
 * - `fulfilled` - the copy is already (partly) fulfilled; its shipping line no
 *   longer describes a parcel that has not gone out.
 * - `closed` - the copy is closed or archived.
 * - `not-found` - the destination no longer has the order.
 */
export const OrderDeliveryRefusalReasonValues = [
  'cancelled',
  'fulfilled',
  'closed',
  'not-found',
] as const;
export type OrderDeliveryRefusalReason = (typeof OrderDeliveryRefusalReasonValues)[number];

/** What an `OrderDeliveryUpdater` answers for one call. A refusal is an answer, never a throw. */
export type OrderDeliveryUpdateResult =
  /** `detail` carries a caveat the operator should see (something the edit could not carry over). */
  | { outcome: 'updated'; detail?: string }
  /** The copy already carried the delivery point; nothing was edited. */
  | { outcome: 'unchanged' }
  | { outcome: 'refused'; reason: OrderDeliveryRefusalReason; detail?: string };

/**
 * What the sync status remembers of the last delivery relay to one
 * destination.
 *
 * - `updated` / `unchanged` - the copy carries the current delivery point.
 * - `refused` - the destination declined; `reason` says why.
 * - `unsupported` - the destination cannot be edited after create.
 * - `failed` - the call threw; the next re-ingestion asks again.
 */
export const OrderDeliveryUpdateOutcomeValues = [
  'updated',
  'unchanged',
  'refused',
  'unsupported',
  'failed',
] as const;
export type OrderDeliveryUpdateOutcome = (typeof OrderDeliveryUpdateOutcomeValues)[number];

export interface OrderDeliveryUpdateReport {
  outcome: OrderDeliveryUpdateOutcome;
  reason?: OrderDeliveryRefusalReason;
  /** Operator-facing elaboration (a refusal's sentence, a failure's message). */
  detail?: string;
  at: Date;
}

export function isOrderDeliveryUpdateOutcome(value: unknown): value is OrderDeliveryUpdateOutcome {
  return (
    typeof value === 'string' && (OrderDeliveryUpdateOutcomeValues as readonly string[]).includes(value)
  );
}

export function isOrderDeliveryRefusalReason(value: unknown): value is OrderDeliveryRefusalReason {
  return (
    typeof value === 'string' && (OrderDeliveryRefusalReasonValues as readonly string[]).includes(value)
  );
}

/**
 * A stable digest of the fields a destination copy carries about delivery: the
 * shipping method and the pickup point (id, name, description). Compared with
 * the digest stored when the copy was created or last updated, so the same
 * change delivered twice is relayed once. Whitespace is trimmed so a source
 * re-padding a label does not read as a change.
 */
export function computeDeliveryFingerprint(order: {
  shipping?: OrderShipping;
  pickupPoint?: OrderPickupPoint;
}): string {
  const clean = (value: string | undefined): string => (value ?? '').trim();
  const canonical = JSON.stringify([
    clean(order.shipping?.methodId),
    clean(order.shipping?.methodName),
    clean(order.pickupPoint?.id),
    clean(order.pickupPoint?.name),
    clean(order.pickupPoint?.description),
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}
