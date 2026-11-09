/**
 * Restock destination sentence (#2380)
 *
 * Turns the backend-resolved `restockTarget` into the § 5.3 sentence that names
 * where stock will land.
 *
 * **The name is never derived here.** It arrives from the same resolver the
 * dispose write uses, so the sentence and the book cannot disagree; a
 * client-side pick over `enabledCapabilities` could confidently name a
 * connection the write never touches, which costs the operator a manual
 * reconciliation to discover.
 *
 * `ambiguous-inventory-master` deliberately does NOT name a candidate: that
 * status means the restock will be REFUSED, so naming one would promise a write
 * that is going to be blocked.
 *
 * @module apps/web/src/features/returns/lib
 */
import { getMessages, interpolate } from '../../../shared/i18n';
import type { ReturnRestockTarget } from '../api/returns.types';

/** Whether a restock can land at all — `false` means the write will be refused. */
export function isRestockAvailable(target: ReturnRestockTarget): boolean {
  return target.status === 'resolved';
}

/**
 * One sentence naming the destination, or saying honestly why there isn't one.
 *
 * A `resolved` status with no name is treated as unreportable rather than
 * rendered as "Stock will be added in ." — the two fields travel together, and
 * an interpolated blank is worse than the honest sentence.
 */
export function describeRestockTarget(target: ReturnRestockTarget): string {
  const copy = getMessages('returns').custody.restockTarget;

  if (target.status === 'resolved') {
    return target.connectionName === null || target.connectionName.trim() === ''
      ? copy['adapter-unresolved']
      : interpolate(copy.resolved, { name: target.connectionName });
  }

  if (target.status === 'ambiguous-inventory-master' || target.status === 'ambiguous-owner') {
    return interpolate(copy[target.status], { n: String(target.candidateCount ?? 0) });
  }

  return copy[target.status];
}
