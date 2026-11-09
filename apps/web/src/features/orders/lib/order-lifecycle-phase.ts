/**
 * Order Lifecycle Phase — frontend mirror + operator vocabulary (#2310)
 *
 * The FE half of the nine-value derived lifecycle phase (#2305, ADR-059). The
 * backend derives the phase (#2307) and projects it onto every order row and
 * onto `GET /orders/lifecycle-summary` (#2309); this file never re-derives it.
 * It owns exactly two things the backend cannot: the FE copy of the vocabulary,
 * and the operator-facing label / tone / "waiting on" line for each value.
 *
 * **The vocabulary itself lives in the sibling `order-lifecycle-phase.types.ts`**
 * (split out by #2441 review S10 so the transport module can name the phase
 * without transitively naming a component module) and is re-exported below, so
 * this remains the single import site for consumers that want label and tone
 * alongside. That file carries the hand-mirror contract with core and the note
 * about what #2311's parser actually compares.
 *
 * **Copy rule (#2081 / REVIEW P9):** no operator-visible string here may say
 * `authority`, `posture` or `FulfillmentWork`. Those are OL's internal design
 * vocabulary; an operator reads "what is this order waiting on". A colocated
 * test asserts it rather than trusting review.
 *
 * **The phase is a SECOND ORTHOGONAL PARTITION beside `OrderHealth`, never a
 * sixth health bucket** (ADR-059). Health answers "is something wrong", the
 * phase answers "what stage is it at" - a held order is usually also `synced`.
 * The badge therefore renders BESIDE the health badge, never instead of it.
 *
 * @module apps/web/src/features/orders/lib
 * @see docs/architecture/adrs/059-order-lifecycle-derived-phase.md
 */
import type { StatusBadgeTone } from '../../../shared/ui/status-badge';
import { getMessages, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import {
  OrderLifecyclePhaseValues,
  isOrderLifecyclePhase,
  type OrderLifecyclePhaseValue,
} from './order-lifecycle-phase.types';

// The vocabulary itself now lives in the sibling types-only module (#2441 review
// S10) so `api/orders.types.ts` can name the phase without transitively naming
// `shared/ui/status-badge` through this file. Re-exported here so every existing
// consumer — and every future one that wants label/tone alongside — keeps a
// single import site.
export {
  OrderLifecyclePhaseValues,
  isOrderLifecyclePhase,
  type OrderLifecyclePhaseValue,
};

type OrdersCopy = ResolvedCopy<Messages['orders']>;

/**
 * Tone per phase; the label is `orders.lifecyclePhase.labels[phase]`. Same
 * shape as `ORDER_SLA_TONE` / `ORDER_FULFILLMENT_TONE` in `order-health.ts`;
 * colour is never the only signal (`StatusBadge` pairs the tone with the label
 * text).
 *
 * `ready` is deliberately `neutral`, not `info`: on the most common row it sits
 * next to the health badge `awaiting_dispatch`, which is already `info`, and two
 * same-tone dot badges saying nearly the same thing compete for the operator's
 * attention (#2081 rule 2). Neutral reads correctly for a residual state.
 * `cancelled` is neutral for the same reason - it is an outcome, not a problem.
 */
export const ORDER_LIFECYCLE_PHASE_TONE: Record<OrderLifecyclePhaseValue, StatusBadgeTone> = {
  cancelled: 'neutral',
  vendor_authoritative: 'info',
  delivered: 'success',
  in_transit: 'info',
  fulfillment_failed: 'error',
  held: 'warning',
  amending: 'warning',
  blocked: 'error',
  ready: 'neutral',
};

/** The badge label for a phase, in the active language. */
export function orderLifecyclePhaseLabel(
  phase: OrderLifecyclePhaseValue,
  copy: OrdersCopy = getMessages('orders')
): string {
  return copy.lifecyclePhase.labels[phase];
}

/**
 * One line per phase answering the operator's actual question - what is this
 * order waiting on, and who holds it up. Rendered under the detail header's
 * badge; the list row shows the label alone (the row has no space for a
 * sentence, and five vocabularies already compete there).
 */
export function orderLifecyclePhaseWaitingOn(
  phase: OrderLifecyclePhaseValue,
  copy: OrdersCopy = getMessages('orders')
): string {
  return copy.lifecyclePhase.waitingOn[phase];
}

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
  copy: OrdersCopy = getMessages('orders'),
): OrderPhaseBadgeDescriptor | null {
  if (!isOrderLifecyclePhase(phase)) return null;
  const tone = ORDER_LIFECYCLE_PHASE_TONE[phase];
  if (phase === 'vendor_authoritative' && vendorLabel) {
    return { label: vendorLabel, tone, attribution: copy.lifecyclePhase.attribution };
  }
  return { label: copy.lifecyclePhase.labels[phase], tone };
}
