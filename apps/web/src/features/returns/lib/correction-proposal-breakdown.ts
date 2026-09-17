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

/** Mirrors the panel's own constant — see its docblock for why. */
const NEEDS_ATTENTION_NO_MATCH_REASON = 'ambiguous-invoice-line';

export interface CorrectionProposalBreakdown {
  /** Sum of every resolved line's credit. Rounded to cents. */
  totalCredit: number;
  /** `matched` lines — OpenLinker resolved these without asking. */
  automaticCount: number;
  /** `ambiguous` lines — the operator must pick before this credits anything. */
  needsPickCount: number;
  /** `no-match` lines — excluded, each with its own reason. */
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

/** One resolved line's own credit — `0` when it cannot be priced yet. */
export function lineCredit(line: ReturnCorrectionProposalLine): number {
  if (line.status !== 'matched' || line.newQuantity === null) return 0;
  const candidate = selectedCandidate(line);
  if (candidate === null) return 0;
  const deltaQty = candidate.quantity - line.newQuantity;
  return Math.round(deltaQty * candidate.unitPriceGross * 100) / 100;
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
      automaticCount += 1;
      totalCredit += lineCredit(line);
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
