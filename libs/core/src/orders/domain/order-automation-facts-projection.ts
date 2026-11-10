/**
 * Order → Automation Subject Facts Projection (#2363)
 *
 * Build the `AutomationSubjectFacts` projection #2359's evaluator matches
 * conditions against, from one persisted `OrderRecord`.
 *
 * ## Why it is here, and why it has two callers
 *
 * The `AutomationSubjectFacts` docblock states that assembling the object is the
 * CALLER's job — the evaluator is pure and must never reach for its own subject.
 * Both callers live on this side of the boundary: `OrderRecordService`'s T5
 * `order.packed` emission (which really fires), and #2363's §5.6(a) dry run
 * (which previews). Those two must agree, because a preview built from a
 * different projection than the firing is a preview of something else — and the
 * one thing an operator does with it is decide whether to arm a rule that spends
 * money.
 *
 * So the projection is one exported pure function rather than a private helper
 * plus a copy. It was extracted from `readSnapshotCountry`, whose single caller
 * was that emission.
 *
 * ## Absence means UNKNOWN, and every branch here honours that
 *
 * Not "false", not "empty" — unknown. `OrderRecord.orderSnapshot` is a
 * `Record<string, unknown>` and under `OL_STORE_PII=false` it carries far less,
 * so every read narrows defensively and returns `undefined` on any shape it does
 * not recognise. #2359's evaluator turns that into a `unknown` condition outcome
 * the trace renders, so an order that cannot answer produces an explanation
 * rather than a silent non-match.
 *
 * `holdReason` is deliberately NOT projected: `order_holds` does not exist yet
 * (#2339), and asserting a reason from a table that does not exist would be a
 * guess on a fact the T1/T2/T3 rules key on.
 *
 * @module libs/core/src/orders/domain
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.5
 */
import type { AutomationSubjectFacts } from '@openlinker/core/automation';

import type { OrderRecord } from './entities/order-record.entity';

/** The buyer's country, or `undefined` for any snapshot shape that cannot answer. */
export function readSnapshotCountry(snapshot: Record<string, unknown>): string | undefined {
  const shipping = snapshot.shippingAddress;
  if (typeof shipping !== 'object' || shipping === null) return undefined;
  const country = (shipping as Record<string, unknown>).countryIso2;
  return typeof country === 'string' && country.length > 0 ? country : undefined;
}

/**
 * Project one order record onto the automation facts vocabulary.
 *
 * @param occurredAt when the triggering fact occurred. Required and explicit:
 * it is the retroactivity floor's input (spec §5.2), and it is a property of the
 * EVENT rather than of the order — the packed emission passes the pack instant,
 * the deadline sweep passes the window crossing, and the dry run passes the
 * order's own placement. Defaulting it here would let one of those three be
 * silently wrong.
 */
export function buildOrderAutomationFacts(
  record: OrderRecord,
  occurredAt: Date | undefined
): AutomationSubjectFacts {
  return {
    subjectKind: 'order',
    subjectId: record.internalOrderId,
    occurredAt,
    sourceConnectionId: record.sourceConnectionId,
    country: readSnapshotCountry(record.orderSnapshot),
    // `?? undefined` rather than passing the `null` through: a nullable column
    // and an absent fact are different vocabularies, and the evaluator's whole
    // unknown-handling contract is written against `undefined`.
    totalGross: record.totalAmount ?? undefined,
    currency: record.currency ?? undefined,
  };
}
