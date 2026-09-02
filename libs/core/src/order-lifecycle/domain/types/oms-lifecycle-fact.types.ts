/**
 * OMS Lifecycle Fact — internal only, NEVER relayed (#2305, ADR-059; design §6.6)
 *
 * The OMS's own lifecycle facts. This union is the "split" half of design
 * §6.6's **split, not grown** rule, and the split is the entire point of the
 * file.
 *
 * **Why these are not `OrderLifecycleEvent` members.**
 * `OrderLifecycleEvent` (`libs/core/src/orders/domain/types/order-lifecycle-event.types.ts`,
 * whose union is `['dispatched','cancelled']`) is the **relay** payload: every
 * member obliges every `OrderStatusWriteback` adapter — Allegro, Erli,
 * PrestaShop, WooCommerce — to answer for it FOREVER, and #2286 made that
 * obligation a compile error rather than a silent mis-route. Adding `held` or
 * `short-picked` there would ask four marketplace adapters to express an
 * internal warehouse fact they have no verb for. So the relay union grows by
 * exactly one member in v1 (`amended`, a LATER wave — #2286's guards are not
 * touched by this issue), and everything else lives here, never crossing an
 * adapter boundary.
 *
 * The practical consequence: **members of this union may be widened freely in
 * later waves**, because no out-of-tree adapter is compiled against it. That is
 * the freedom the relay union does not have, and it is why the split is worth a
 * second union rather than a shared one.
 *
 * Payloads are deliberately minimal in this slice — the vocabulary is what
 * #2307 onward needs; the per-member detail follows the persistence that
 * produces it.
 *
 * @module libs/core/src/order-lifecycle/domain/types
 * @see docs/architecture/adrs/059-order-lifecycle-derived-phase.md
 */
import type { HoldReason } from './hold-reason.types';
import type { OrderAmendmentKind } from './order-amendment-kind.types';

/**
 * The nine internal fact types.
 *
 * Order-grain: `held`, `released`, `amendment-requested`, `amendment-confirmed`,
 * `amendment-declined`. Work-grain: `routed`, `work-accepted`, `work-rejected`,
 * `short-picked`.
 */
export const OmsLifecycleFactTypeValues = [
  'held',
  'released',
  'routed',
  'work-accepted',
  'work-rejected',
  'short-picked',
  'amendment-requested',
  'amendment-confirmed',
  'amendment-declined',
] as const;

export type OmsLifecycleFactType = (typeof OmsLifecycleFactTypeValues)[number];

/**
 * Discriminated on `type`, mirroring `OrderLifecycleEvent`'s shape so a reader
 * moving between the two files is not also switching modelling idiom — the
 * difference between them is the boundary they cross, not their form.
 *
 * `internalOrderId` is OL's own id throughout: these facts never reach an
 * adapter, so there is no external id to resolve and no identifier mapping to
 * perform.
 */
export type OmsLifecycleFact =
  | { type: 'held'; internalOrderId: string; reason: HoldReason }
  | { type: 'released'; internalOrderId: string; reason: HoldReason }
  | { type: 'routed'; internalOrderId: string; workId: string }
  | { type: 'work-accepted'; internalOrderId: string; workId: string }
  | { type: 'work-rejected'; internalOrderId: string; workId: string }
  | { type: 'short-picked'; internalOrderId: string; workId: string }
  | {
      type: 'amendment-requested';
      internalOrderId: string;
      kind: OrderAmendmentKind;
    }
  | {
      type: 'amendment-confirmed';
      internalOrderId: string;
      kind: OrderAmendmentKind;
    }
  | {
      type: 'amendment-declined';
      internalOrderId: string;
      kind: OrderAmendmentKind;
    };

/**
 * Coerce an untrusted value to the fact-type union. Pure; no default.
 */
export function isOmsLifecycleFactType(
  value: unknown,
): value is OmsLifecycleFactType {
  return (
    typeof value === 'string' &&
    (OmsLifecycleFactTypeValues as readonly string[]).includes(value)
  );
}
