/**
 * Reservation Obligation Predicate (#2346, REVIEW § 3 C1, design § 4.2 amendment 3)
 *
 * The question the expiry sweep must answer before it releases anything: *does a
 * live OpenLinker-executed obligation still stand on this order?*
 *
 * **The sweep fails closed, and that asymmetry is the entire point.** A naive
 * expiry releases a fraud-held order's reservation, republishes stock that is
 * still promised, and the later dispatch oversells — with every counter
 * internally consistent, so nothing alerts. The safe direction is therefore to
 * EXTEND whenever an obligation cannot be *ruled out*, and to release only on a
 * positive, confirmed absence.
 *
 * ## `order_holds` does not exist yet, and this module is shaped around that
 *
 * The Wave-2 obligation kind is an open order hold, whose table (#2339) is not
 * on this branch — every reference in the tree is a placeholder
 * (`derive-order-lifecycle-phase.ts`, `order-record.repository.ts`,
 * `orders.controller.ts` all pass `null` and say "Wave 2"). So the shipped
 * reader for that kind is {@link UnavailableOrderHoldReader}, which answers
 * `'indeterminate'` unconditionally; every candidate is therefore extended and
 * **nothing is ever released** until a real reader is bound.
 *
 * Two mechanisms keep that from rotting into an inert pass that merely *reads*
 * as working:
 *
 * 1. **{@link ObligationReaders} is a MAPPED TYPE over
 *    {@link ReservationObligationKindValues}.** Wave 3 adding
 *    `accepted-fulfillment-work` to the union cannot compile until a reader is
 *    supplied for it — a compile error to handle, never a silent omission.
 * 2. **A spec asserts that no reservation is ever released while
 *    `UnavailableOrderHoldReader` is bound.** Forgetting to swap it keeps the
 *    safe behaviour; swapping it is a deliberate act.
 *
 * When #2339 lands, the ONLY change here is binding a real reader for
 * `'open-order-hold'`. That reader must return `'absent'` **only when it has
 * positively confirmed there is no open hold** — never as a default, never as
 * the fallback arm of a failed read. That distinction is the difference between
 * a safe swap and a silent oversell.
 *
 * Pure per `docs/engineering-standards.md § The pure-rule exception`: the fold
 * IS the rule for the verdict union it sits with, and the two change together.
 *
 * @module libs/core/src/inventory/domain/types
 * @see docs/architecture/adrs/061-advisory-reservations-and-availability-authority.md
 */

/**
 * The kinds of live obligation that forbid releasing a hold.
 *
 * One member in Wave 2. Wave 3's `accepted-fulfillment-work` is deliberately
 * ABSENT rather than declared-and-unimplemented: declaring it now would compile
 * against a reader that cannot exist, which is the opposite of the guarantee
 * this union is here to provide.
 */
export const ReservationObligationKindValues = ['open-order-hold'] as const;

export type ReservationObligationKind = (typeof ReservationObligationKindValues)[number];

/**
 * What one reader can say about one order.
 *
 * `'indeterminate'` is a first-class answer, not an error: "I cannot see the
 * data that would tell me" is exactly the state this codebase is in for
 * `open-order-hold`, and collapsing it into `'absent'` is the oversell.
 */
export const ObligationVerdictValues = ['present', 'indeterminate', 'absent'] as const;

export type ObligationVerdict = (typeof ObligationVerdictValues)[number];

/**
 * Answers "does this kind of obligation stand on this order?".
 *
 * Returning `'absent'` is a claim, not a default. A reader that throws, times
 * out, or finds its source unavailable answers `'indeterminate'`.
 */
export type ObligationReader = (orderRecordId: string) => Promise<ObligationVerdict>;

/**
 * One reader per declared kind.
 *
 * A mapped type rather than a partial record or a list: a kind added to
 * {@link ReservationObligationKindValues} without a reader is a COMPILE ERROR.
 */
export type ObligationReaders = {
  readonly [K in ReservationObligationKind]: ObligationReader;
};

/**
 * Combine every reader's answer into the one that decides the sweep's action.
 *
 * **`present` > `indeterminate` > `absent`.** A reader that cannot answer must
 * never be outvoted into a release by one that can: if any obligation may still
 * stand, the hold stays. An EMPTY set of answers folds to `'indeterminate'`,
 * not `'absent'` — asking nobody is not evidence of absence, and the empty case
 * is reachable if a future refactor filters the reader set.
 */
export function foldObligationVerdicts(
  verdicts: readonly ObligationVerdict[]
): ObligationVerdict {
  if (verdicts.length === 0) return 'indeterminate';
  if (verdicts.includes('present')) return 'present';
  if (verdicts.includes('indeterminate')) return 'indeterminate';
  return 'absent';
}

/**
 * Ask every reader about one order and fold the answers.
 *
 * A reader that REJECTS is folded as `'indeterminate'` rather than propagating:
 * one unavailable source must degrade the sweep to "extend", never abort a run
 * that could still safely extend the rest of its page.
 */
export async function resolveObligation(
  readers: ObligationReaders,
  orderRecordId: string
): Promise<ObligationVerdict> {
  const answers = await Promise.all(
    ReservationObligationKindValues.map(async (kind): Promise<ObligationVerdict> => {
      try {
        return await readers[kind](orderRecordId);
      } catch {
        return 'indeterminate';
      }
    })
  );

  return foldObligationVerdicts(answers);
}
