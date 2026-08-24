/**
 * Order Lifecycle Phase — frontend mirror + operator vocabulary (#2310)
 *
 * The FE half of the nine-value derived lifecycle phase (#2305, ADR-059). The
 * backend derives the phase (#2307) and projects it onto every order row and
 * onto `GET /orders/lifecycle-summary` (#2309); this file never re-derives it.
 * It owns exactly two things the backend cannot: the FE copy of the vocabulary,
 * and the operator-facing label / tone / "waiting on" line for each value.
 *
 * **`OrderLifecyclePhaseValues` below is a hand mirror of
 * `OrderLifecyclePhaseValues` in `libs/core/src/order-lifecycle/domain/types/
 * order-lifecycle-phase.types.ts` — same exported name, same nine literals, same
 * precedence order.** The order is contract, not presentation (it is the ordinal
 * the derivation and the SQL `CASE` both read), so this array is declared as one
 * quoted literal per line and nothing else, which is the shape #2311's mirror
 * check parses. Do not wrap it, nest it, rename it or move this file without
 * updating that check in the same commit.
 *
 * **Copy rule (#2081 / REVIEW P9):** no operator-visible string here may say
 * `authority`, `posture` or `FulfillmentWork`. Those are OL's internal design
 * vocabulary; an operator reads "what is this order waiting on". A colocated
 * test asserts it rather than trusting review.
 *
 * **The phase is a SECOND ORTHOGONAL PARTITION beside `OrderHealth`, never a
 * sixth health bucket** (ADR-059). Health answers "is something wrong", the
 * phase answers "what stage is it at" — a held order is usually also `synced`.
 * The badge therefore renders BESIDE the health badge, never instead of it.
 *
 * @module apps/web/src/features/orders/lib
 * @see docs/architecture/adrs/059-order-lifecycle-derived-phase.md
 */
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';

/**
 * The nine phases, in the backend's precedence order (highest first).
 *
 * Hand-mirrored from core per the FE-001 contract strategy. #2311 enforces the
 * byte-equality of this declaration against core's.
 */
export const OrderLifecyclePhaseValues = [
  'cancelled',
  'vendor_authoritative',
  'delivered',
  'in_transit',
  'fulfillment_failed',
  'held',
  'amending',
  'blocked',
  'ready',
] as const;

export type OrderLifecyclePhaseValue = (typeof OrderLifecyclePhaseValues)[number];

/**
 * Coerce an untrusted value — a URL search param, a field on an older payload —
 * to the union. Deliberately no fallback, matching core's `isOrderLifecyclePhase`:
 * there is no phase safe to assume, and defaulting an unknown value to `ready`
 * would report "nothing to do" about an order in an unknown state.
 */
export function isOrderLifecyclePhase(value: unknown): value is OrderLifecyclePhaseValue {
  return (
    typeof value === 'string' &&
    (OrderLifecyclePhaseValues as readonly string[]).includes(value)
  );
}

/**
 * Label + tone per phase. Same shape as `ORDER_SLA_META` / `ORDER_FULFILLMENT_META`
 * in `order-health.ts`; colour is never the only signal (`StatusBadge` pairs the
 * tone with the label text).
 *
 * `ready` is deliberately `neutral`, not `info`: on the most common row it sits
 * next to the health badge `awaiting_dispatch`, which is already `info`, and two
 * same-tone dot badges saying nearly the same thing compete for the operator's
 * attention (#2081 rule 2). Neutral reads correctly for a residual state.
 * `cancelled` is neutral for the same reason — it is an outcome, not a problem.
 */
export const ORDER_LIFECYCLE_PHASE_META: Record<
  OrderLifecyclePhaseValue,
  { label: string; tone: StatusBadgeTone }
> = {
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  vendor_authoritative: { label: 'Channel status', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  in_transit: { label: 'With carrier', tone: 'info' },
  fulfillment_failed: { label: 'Dispatch failed', tone: 'error' },
  held: { label: 'On hold', tone: 'warning' },
  amending: { label: 'Change pending', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'error' },
  ready: { label: 'Ready', tone: 'neutral' },
};

/**
 * One line per phase answering the operator's actual question — what is this
 * order waiting on, and who holds it up. Rendered under the detail header's
 * badge; the list row shows the label alone (the row has no space for a
 * sentence, and five vocabularies already compete there).
 */
export const ORDER_LIFECYCLE_PHASE_WAITING_ON: Record<OrderLifecyclePhaseValue, string> = {
  cancelled: 'This order was cancelled.',
  vendor_authoritative: "The sales channel reports this order's status.",
  delivered: 'Delivered — nothing outstanding.',
  in_transit: 'With the carrier, waiting on delivery.',
  fulfillment_failed: 'Dispatch failed — the shipment needs attention.',
  held: 'On hold — someone paused it; release it to continue.',
  amending: 'A requested change is waiting for the channel to confirm.',
  blocked: 'Waiting on OpenLinker — the order cannot be matched yet.',
  ready: 'Ready — waiting to be dispatched.',
};

/** What the badge renders: a label, a tone, and an optional attribution line. */
export interface OrderPhaseBadgeDescriptor {
  label: string;
  tone: StatusBadgeTone;
  /**
   * Present only for `vendor_authoritative` carrying a vendor-reported label:
   * says who the rendered string came from, so an operator never mistakes the
   * channel's own words for OL's classification.
   */
  attribution?: string;
}

/**
 * Resolve the badge for an order's phase, mirroring `slaBadge`'s shape.
 *
 * Returns `null` ONLY for an absent or unrecognised value — a payload predating
 * #2309, or a phase this build does not know. Every known phase always renders:
 * suppressing one (e.g. because the Shipment column already says "Delivered")
 * would make the badge's absence ambiguous with an older payload, and is
 * derived-state cleverness no mirror check can verify.
 *
 * `vendorLabel` renders the channel's own string VERBATIM — never re-worded into
 * OL vocabulary, which is the whole point of the `vendor_authoritative` phase.
 * No `vendorLifecycleLabel` field exists on `OrderRecord` yet (Wave 4 persists
 * it); this parameter is the seam, exercised today by a synthetic fixture.
 */
export function phaseBadge(
  phase: string | null | undefined,
  vendorLabel?: string | null,
): OrderPhaseBadgeDescriptor | null {
  if (!isOrderLifecyclePhase(phase)) return null;
  const meta = ORDER_LIFECYCLE_PHASE_META[phase];
  if (phase === 'vendor_authoritative' && vendorLabel) {
    return { label: vendorLabel, tone: meta.tone, attribution: 'reported by the sales channel' };
  }
  return { label: meta.label, tone: meta.tone };
}
