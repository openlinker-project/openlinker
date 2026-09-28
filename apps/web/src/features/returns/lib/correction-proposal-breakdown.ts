/**
 * Correction-proposal headline + breakdown (#3090, returns spec § 5.8)
 *
 * Pure derivation over what the proposal already carries — no I/O, no
 * component concerns. Kept separate from the panel so the arithmetic is
 * testable without rendering anything.
 *
 * **Credit is a value delta, computed only for a RESOLVED line.** An
 * `ambiguous` line has no selected candidate to price against, and a
 * `no-match` line has none at all — crediting either would mean guessing,
 * which the model exists to refuse. Only `matched` lines with a reported
 * `newQuantity` contribute, and the delta is `(invoiced - after) × unitPrice`,
 * never assumed to be the full invoiced amount.
 *
 * **`status: 'ambiguous'` is retired (#3312).** The matcher never produces it
 * anymore — the same underlying condition now arrives as `status: 'no-match'`
 * with `noMatchReason: 'ambiguous-invoice-line'`. It must still count as
 * "needs your pick", not "can't credit": nothing about it is a closed
 * exclusion, it is the identical situation the old status described.
 *
 * @module apps/web/src/features/returns/lib
 */
import type { ReturnCorrectionProposalLine } from '../api/returns.types';

/**
 * The one `noMatchReason` value that must read as attention-worthy rather
 * than as a routine, closed exclusion — the residual case `status:
 * 'ambiguous'` used to carry before #3312 retired it. Declared exactly once,
 * here, and imported by the panel — a second, independent declaration is how
 * this drifted from a member of `ReturnCorrectionNoMatchReasonValues` before.
 */
export const NEEDS_ATTENTION_NO_MATCH_REASON = 'ambiguous-invoice-line';

export interface CorrectionProposalBreakdown {
  /** Sum of every resolved line's credit. Rounded to cents. */
  totalCredit: number;
  /**
   * `matched` lines that are actually PRICEABLE — a reported `newQuantity`
   * AND a resolvable selected candidate. This is the count the headline
   * credit is drawn from; a `matched` line missing either contributes `0` to
   * `totalCredit` and is counted in `cantCreditCount` instead, or the two
   * numbers would describe different sets of lines.
   */
  automaticCount: number;
  /** `ambiguous` lines — the operator must pick before this credits anything. */
  needsPickCount: number;
  /** `no-match` lines, plus an unpriceable `matched` line — each excluded from the credit for its own reason. */
  cantCreditCount: number;
}

function selectedCandidate(
  line: ReturnCorrectionProposalLine,
): ReturnCorrectionProposalLine['candidates'][number] | null {
  if (line.selectedOriginalLineNumber === null) return null;
  return (
    line.candidates.find(
      (candidate) => candidate.originalLineNumber === line.selectedOriginalLineNumber,
    ) ?? null
  );
}

/**
 * A `matched` line the server has actually priced — a reported `newQuantity`
 * and a selected candidate that still resolves against `candidates`. Both
 * `lineCredit` and the breakdown's `automaticCount` gate on this, so a line
 * missing either piece cannot silently count as "automatic" while
 * contributing nothing to the total.
 */
function isPriceable(line: ReturnCorrectionProposalLine): boolean {
  return (
    line.status === 'matched' && line.newQuantity !== null && selectedCandidate(line) !== null
  );
}

/** One resolved line's own credit — `0` when it cannot be priced yet. */
export function lineCredit(line: ReturnCorrectionProposalLine): number {
  if (!isPriceable(line)) return 0;
  // isPriceable already proved newQuantity and the candidate are both present.
  const candidate = selectedCandidate(line)!;
  const deltaQty = candidate.quantity - line.newQuantity!;
  // Clamped at 0 rather than let through: `newQuantity` and the selected
  // candidate are resolved by different parts of the matcher, so a mismatch
  // between them would otherwise produce a NEGATIVE credit that silently
  // reduces the headline instead of crediting nothing.
  return Math.max(0, Math.round(deltaQty * candidate.unitPriceGross * 100) / 100);
}

export function computeCorrectionProposalBreakdown(
  lines: ReturnCorrectionProposalLine[],
): CorrectionProposalBreakdown {
  let totalCredit = 0;
  let automaticCount = 0;
  let needsPickCount = 0;
  let cantCreditCount = 0;

  for (const line of lines) {
    if (line.status === 'matched') {
      if (isPriceable(line)) {
        automaticCount += 1;
        totalCredit += lineCredit(line);
      } else {
        // Reported as matched but missing what pricing it needs — reads as
        // "can't credit yet", the honest description, rather than being
        // counted as automatic while contributing nothing to the total.
        cantCreditCount += 1;
      }
    } else if (
      line.status === 'ambiguous' ||
      line.noMatchReason === NEEDS_ATTENTION_NO_MATCH_REASON
    ) {
      needsPickCount += 1;
    } else {
      cantCreditCount += 1;
    }
  }

  return {
    totalCredit: Math.round(totalCredit * 100) / 100,
    automaticCount,
    needsPickCount,
    cantCreditCount,
  };
}
