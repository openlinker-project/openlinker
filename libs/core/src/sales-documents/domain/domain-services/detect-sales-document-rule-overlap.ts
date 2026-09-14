/**
 * Detect whether a draft rule could match the same order as an existing one (#3190)
 *
 * The engine has no priorities: when two rules match one order it resolves
 * `unresolved` / `conflicting-rules-equal-priority` and the order is HELD
 * (ADR-041 - never silently pick one, because for a fiscal document a wrong
 * pick is a legal event). That is correct and it is also invisible: the
 * operator discovers it days later as a hanging order. This moves the finding
 * to the one moment somebody is still there to act on it - before the save.
 *
 * Pure, side-effect-free, and deliberately a domain service rather than a
 * method on the application service: it is the rule for the condition
 * vocabulary, so it lives beside `evaluateSalesDocumentRules`, takes the rival
 * rules as an argument, and can be exercised without a database.
 *
 * **Three outcomes, never two.** A pair either provably CAN both match, or
 * provably CANNOT, or this build cannot tell. The third is reported rather
 * than folded into either neighbour: silence would read as "no conflict",
 * which is the false reassurance this whole check exists to remove.
 *
 * **Decidable only because the vocabulary is closed and the composer is
 * AND-only.** Every condition is a bound on one field and a rule is their
 * conjunction, so two rules intersect iff every field's bounds intersect. An
 * OR tree would make exactly the interesting cases undecidable, which is why
 * `SalesDocumentCondition` has no disjunction and must not grow one without
 * revisiting this function.
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 */
import {
  compareDecimalAmountStrings,
  isSalesDocumentCondition,
  type SalesDocumentCondition,
} from '../types/sales-document-condition.types';

/** Why two rules provably cannot match the same order. */
export const SalesDocumentOverlapDisjointReasonValues = [
  /** Their amounts are priced in different currencies, which are compared and never converted. */
  'currency',
  /** Same currency, but no total satisfies both rules' bounds. */
  'amount-range',
  /** One wants a buyer with a tax id, the other a buyer without one. */
  'buyer-tax-id',
  /** They are scoped to different delivery countries. */
  'order-country',
  /** Their effective windows do not overlap, so they are never live together. */
  'effective-window',
] as const;
export type SalesDocumentOverlapDisjointReason =
  (typeof SalesDocumentOverlapDisjointReasonValues)[number];

/** Why this build declines to answer for a pair. */
export const SalesDocumentOverlapUndecidedReasonValues = [
  /** A persisted condition this build cannot narrow - never read as "no conflict". */
  'unreadable-condition',
  /**
   * A rule bounding the total in more than one currency. The composer cannot
   * author one, and such a rule matches nothing at all, so calling it
   * "provably disjoint" would explain the wrong thing to an operator staring
   * at a rule that simply never fires.
   */
  'multi-currency-rule',
] as const;
export type SalesDocumentOverlapUndecidedReason =
  (typeof SalesDocumentOverlapUndecidedReasonValues)[number];

/** The draft being checked. `excludeRuleId` is the row being edited, if any. */
export interface SalesDocumentRuleOverlapCandidate {
  readonly conditions: readonly unknown[];
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly excludeRuleId?: string;
}

/** An already-persisted rule the draft is checked against. */
export interface SalesDocumentRuleOverlapSubject {
  readonly id: string;
  readonly connectionId: string;
  readonly documentKind: string;
  readonly conditions: readonly unknown[];
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface SalesDocumentOverlapHit {
  readonly ruleId: string;
  readonly connectionId: string;
  readonly documentKind: string;
}
export interface SalesDocumentDisjointHit {
  readonly ruleId: string;
  readonly reason: SalesDocumentOverlapDisjointReason;
}
export interface SalesDocumentUndecidedHit {
  readonly ruleId: string;
  readonly reason: SalesDocumentOverlapUndecidedReason;
}

export interface SalesDocumentRuleOverlapVerdict {
  /** Rules that could match the same order. Non-empty means the save must be refused. */
  readonly overlapping: readonly SalesDocumentOverlapHit[];
  /** Rules that provably cannot, each with the reason to state back. */
  readonly disjoint: readonly SalesDocumentDisjointHit[];
  /** Rules this build could not decide about. Must be surfaced, never dropped. */
  readonly undecided: readonly SalesDocumentUndecidedHit[];
}

/**
 * Do two effective windows overlap? An absent end is open-ended, i.e. `+inf`.
 * Exported because the write-path conflict guard asks the same question, and
 * two answers to it would eventually disagree.
 */
export function salesDocumentRuleWindowsOverlap(
  aFrom: Date,
  aTo: Date | null,
  bFrom: Date,
  bTo: Date | null,
): boolean {
  const aEnd = aTo ?? new Date(8640000000000000);
  const bEnd = bTo ?? new Date(8640000000000000);
  return aFrom.getTime() <= bEnd.getTime() && bFrom.getTime() <= aEnd.getTime();
}

/** One rule's conjunction, reduced to a bound per field. */
interface RuleBounds {
  readonly buyerHasTaxId?: boolean;
  readonly orderCountry?: string;
  readonly currency?: string;
  /** Inclusive lower bound from `gte`. */
  readonly lower?: string;
  /** Exclusive upper bound from `lt`. */
  readonly upper?: string;
}

type BoundsResult =
  | { readonly ok: true; readonly bounds: RuleBounds }
  | { readonly ok: false; readonly reason: SalesDocumentOverlapUndecidedReason };

function reduceToBounds(conditions: readonly unknown[]): BoundsResult {
  let bounds: RuleBounds = {};
  for (const raw of conditions) {
    if (!isSalesDocumentCondition(raw)) {
      return { ok: false, reason: 'unreadable-condition' };
    }
    const condition: SalesDocumentCondition = raw;
    if (condition.field === 'buyerHasTaxId') {
      bounds = { ...bounds, buyerHasTaxId: condition.value };
      continue;
    }
    if (condition.field === 'orderCountry') {
      bounds = { ...bounds, orderCountry: condition.value.toUpperCase() };
      continue;
    }
    if (bounds.currency !== undefined && bounds.currency !== condition.currency) {
      return { ok: false, reason: 'multi-currency-rule' };
    }
    // Several `gte`s narrow to the largest, several `lt`s to the smallest -
    // the conjunction, not the last one written.
    if (condition.op === 'gte') {
      const lower =
        bounds.lower === undefined || compareDecimalAmountStrings(condition.amount, bounds.lower) > 0
          ? condition.amount
          : bounds.lower;
      bounds = { ...bounds, currency: condition.currency, lower };
    } else {
      const upper =
        bounds.upper === undefined || compareDecimalAmountStrings(condition.amount, bounds.upper) < 0
          ? condition.amount
          : bounds.upper;
      bounds = { ...bounds, currency: condition.currency, upper };
    }
  }
  return { ok: true, bounds };
}

/**
 * `null` when the two bound sets intersect (the rules could both match);
 * otherwise the reason they provably cannot.
 */
function disjointReason(a: RuleBounds, b: RuleBounds): SalesDocumentOverlapDisjointReason | null {
  if (
    a.buyerHasTaxId !== undefined &&
    b.buyerHasTaxId !== undefined &&
    a.buyerHasTaxId !== b.buyerHasTaxId
  ) {
    return 'buyer-tax-id';
  }
  if (a.orderCountry !== undefined && b.orderCountry !== undefined && a.orderCountry !== b.orderCountry) {
    return 'order-country';
  }
  if (a.currency !== undefined && b.currency !== undefined) {
    // The whole point of an inline amount: currencies are compared, never
    // converted, so two rules priced differently cannot describe one order.
    if (a.currency !== b.currency) return 'currency';
    const lower = pickTighter(a.lower, b.lower, 'max');
    const upper = pickTighter(a.upper, b.upper, 'min');
    // `gte lower` is inclusive and `lt upper` exclusive, so the intersection
    // is non-empty exactly while lower < upper.
    if (lower !== undefined && upper !== undefined && compareDecimalAmountStrings(lower, upper) >= 0) {
      return 'amount-range';
    }
  }
  return null;
}

function pickTighter(a: string | undefined, b: string | undefined, mode: 'max' | 'min'): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const cmp = compareDecimalAmountStrings(a, b);
  if (mode === 'max') return cmp >= 0 ? a : b;
  return cmp <= 0 ? a : b;
}

export function detectSalesDocumentRuleOverlap(
  candidate: SalesDocumentRuleOverlapCandidate,
  existing: readonly SalesDocumentRuleOverlapSubject[],
): SalesDocumentRuleOverlapVerdict {
  const overlapping: SalesDocumentOverlapHit[] = [];
  const disjoint: SalesDocumentDisjointHit[] = [];
  const undecided: SalesDocumentUndecidedHit[] = [];

  const candidateBounds = reduceToBounds(candidate.conditions);

  for (const subject of existing) {
    if (candidate.excludeRuleId !== undefined && subject.id === candidate.excludeRuleId) continue;

    if (
      !salesDocumentRuleWindowsOverlap(
        candidate.effectiveFrom,
        candidate.effectiveTo,
        subject.effectiveFrom,
        subject.effectiveTo,
      )
    ) {
      disjoint.push({ ruleId: subject.id, reason: 'effective-window' });
      continue;
    }

    if (!candidateBounds.ok) {
      undecided.push({ ruleId: subject.id, reason: candidateBounds.reason });
      continue;
    }
    const subjectBounds = reduceToBounds(subject.conditions);
    if (!subjectBounds.ok) {
      undecided.push({ ruleId: subject.id, reason: subjectBounds.reason });
      continue;
    }

    const reason = disjointReason(candidateBounds.bounds, subjectBounds.bounds);
    if (reason === null) {
      overlapping.push({
        ruleId: subject.id,
        connectionId: subject.connectionId,
        documentKind: subject.documentKind,
      });
    } else {
      disjoint.push({ ruleId: subject.id, reason });
    }
  }

  return { overlapping, disjoint, undecided };
}
