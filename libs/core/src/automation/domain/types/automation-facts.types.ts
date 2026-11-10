/**
 * Automation Subject Facts (#2359, Wave-2 spec §5.5)
 *
 * The already-assembled PROJECTION `evaluateAutomationRules` matches conditions
 * against — never an `Order` entity, never an injected `orders` token. The
 * `SalesDocumentOrderFacts` shape (#2170) is the precedent and the reason: a
 * pure evaluator that reaches for the subject itself is not pure, cannot back a
 * dry run, and drags a cross-context edge into the domain layer. Assembling
 * this object is the caller's job (#2360's emitter, #2363's dry run).
 *
 * ## Every fact is optional, and absence means UNKNOWN
 *
 * Not "false", not "empty", not "no hold" — **unknown**. This is the one rule a
 * future edit must not soften. ADR-063 widened `buyerHasTaxId` from `boolean`
 * to `boolean | undefined` for exactly this reason, and #2170's evaluator
 * relies on an absent fact comparing unequal to both `true` and `false`.
 * Collapsing an unknown into a known one here would make a rule fire — and,
 * for A1/A2, spend money — on a fact nobody asserted.
 *
 * The evaluator therefore has a THIRD per-condition outcome (`unknown`) beside
 * true/false, and reports it in the trace so the dry run can say *"we could not
 * tell"* rather than *"it did not match"*. Those are different sentences and
 * they lead the operator to different fixes.
 *
 * ## `totalGross` is a number, and its currency is a separate fact
 *
 * A number, matching `SalesDocumentOrderFacts.totalGross` — the condition's own
 * amount is persisted as a decimal STRING (a `jsonb` round-trip concern,
 * #2358), and the evaluator parses it once at comparison time. The currency is
 * carried separately because a mismatch is **never** resolved by conversion
 * (spec §5.5, and the ADR-040 stamp is analytics-only): the rule simply does
 * not match, and the trace says why.
 *
 * ## `occurredAt` is the retroactivity floor
 *
 * Spec §5.2: *"a rule created today acts only on facts that occur after it was
 * saved"* — a new rule must not fire against the 40 orders already on hold,
 * because it would surprise the operator by spending money on 40 labels. The
 * comparison is against `AutomationRule.createdAt`, which is why that column is
 * behavioural rather than an audit timestamp. Absent means unknown, and an
 * unknown occurrence time does NOT waive the floor — see the evaluator.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.2, §5.5
 */
import type { HoldReason } from '@openlinker/core/order-lifecycle';

import type { AutomationRunSubjectKind } from './automation-run.types';

export interface AutomationSubjectFacts {
  /** Which object the trigger fired about, and which one a run row will name. */
  readonly subjectKind: AutomationRunSubjectKind;
  readonly subjectId: string;
  /**
   * When the triggering fact occurred. Absent = unknown, which is NOT a licence
   * to fire — see `AutomationNonFiringReason.fact-time-unknown`.
   */
  readonly occurredAt?: Date;
  /** The connection the order came from. Absent = unknown. */
  readonly sourceConnectionId?: string;
  /** ISO-3166-1 alpha-2 of the order's country. Absent = unknown. */
  readonly country?: string;
  /** Gross total in the order's OWN currency. Absent = unknown. */
  readonly totalGross?: number;
  /** ISO-4217 of `totalGross`. Absent = unknown; never inferred from the country. */
  readonly currency?: string;
  /**
   * The reason of the hold this firing is ABOUT (T1/T2/T3). Absent = unknown,
   * which is also how a subject with no hold at all presents — both mean the
   * evaluator cannot assert a reason, and both must read as unknown rather than
   * as a non-match, because they are not statements about the operator's rule.
   */
  readonly holdReason?: HoldReason;
}
