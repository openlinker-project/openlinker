/**
 * Return Correction Matching (#2374, `W2-38`, ADR-060 / ADR-044)
 *
 * The rule that decides WHICH line of an issued document a disposed return line
 * is correcting — and, far more often than is comfortable, that it cannot tell.
 *
 * ## Pure, and deliberately not a service
 *
 * No I/O, no injected dependency, no framework import, no clock, no mutation of
 * its arguments. The shape every shipped rule engine in this tree takes, and the
 * shape its three neighbours in this directory already take
 * (`return-custody-transitions`, `refund-outcome`, `restock-outcome`).
 *
 * ## The whole problem in one paragraph
 *
 * `CorrectionLine.originalLineNumber` is a **1-based array position**.
 * `InvoiceLine` is `{name, quantity, unitPriceGross, taxRate, unit?}` — no id, no
 * sku. `ReturnLine` carries `sku` and `name` and **no price**. So `name` is the
 * only shared axis, and an order that repeats one offer across two lines produces
 * two identically-named invoice lines that no data in either record can tell
 * apart. That is not a gap to be closed with a cleverer heuristic; it is the
 * reason `ambiguous` exists.
 *
 * ## Four rules, each of which is a decision
 *
 * 1. **Nothing fuzzier than exact-after-normalisation.** Trim, collapse internal
 *    whitespace, case-fold. A fuzzy match on a fiscal document is a guess wearing
 *    a confidence score, and a transmitted correction cannot be withdrawn.
 *
 * 2. **Deliberately NOT diacritic-folded**, unlike `DestinationCategory.searchText`
 *    — a reader will assume that precedent applies, so the refusal is recorded
 *    rather than left implicit. Both names descend from the same catalogue through
 *    the same order, so folding buys nothing here, while it can collapse two
 *    genuinely distinct products onto one candidate set and MANUFACTURE an
 *    ambiguity that does not exist.
 *
 * 3. **A candidate that invoiced fewer units than are being returned is filtered
 *    out**, because you cannot return more of a line than it sold. Emitting it
 *    would produce a negative post-correction quantity the provider rejects after
 *    the operator has moved on. If that filter empties a non-empty by-name set the
 *    line is `no-match` / `quantity-exceeds-invoiced` — a different operator
 *    action from `no-line-by-name`, so a different reason.
 *
 * 4. **Quantity only; never money.** The delta carries
 *    `newQuantity = candidate.quantity - quantityDisposed` and no price: a return
 *    does not change a unit price. Core computes no net and rounds nothing
 *    (ADR-063) — the integer subtraction of units is not a money computation, and
 *    the rounding rule for a rate stays in the provider adapter.
 *
 * `candidatesPriceOrRateDiffer` reports whether the candidates disagree on price
 * or rate, because § 5.8's copy needs it. It is EVIDENCE, never a resolution: an
 * ambiguous line stays ambiguous even when every candidate would credit the same
 * amount, since picking one on that basis stamps a specific `originalLineNumber`
 * into a fiscal document on the strength of a coincidence.
 *
 * @module libs/core/src/returns/domain/domain-services
 * @see docs/specs/product-spec-oms-returns-operator-ux.md § 5.8
 */
import { assertNever } from '@openlinker/shared/types';

import type {
  ReturnCorrectionCandidate,
  ReturnCorrectionNoMatchReason,
  ReturnCorrectionProposalLine,
} from '../types/return-correction-proposal.types';

/**
 * One line of the issued document, as the #1297 snapshot stores it. Structurally
 * `InvoiceLine`, restated locally so this pure rule takes no cross-context import
 * (the classifier is a property of two shapes, not of the invoicing context).
 */
export interface CorrectionSnapshotLine {
  name: string;
  quantity: number;
  unitPriceGross: number;
  taxRate: string;
  unit?: string;
}

/** The projection of one disposed return line these rules read. */
export interface CorrectionReturnLineInput {
  returnLineId: string;
  lineIndex: number;
  name: string | null;
  sku: string | null;
  /** `quantityRestocked + quantityScrapped` — book-confirmed disposal only. */
  quantityDisposed: number;
  /**
   * Whether the line holds an outstanding `blocked` / `in_doubt` disposition act
   * (#2370 rule 1: such units never reached the counters). Read from the act
   * ledger by the caller; the rule itself performs no I/O.
   */
  hasUnconfirmedDisposition: boolean;
}

/**
 * Collapse a display name to its comparison form. Rules 1 and 2 above.
 * Exported so a consumer can explain a near-miss to an operator without
 * re-deriving the rule and drifting from it.
 */
export function normalizeCorrectionLineName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Classify every disposed return line against the issued document's lines.
 *
 * Order-preserving: the result is one entry per input line, in input order, so a
 * caller never has to re-associate. Lines with `quantityDisposed <= 0` are the
 * caller's to exclude — this rule classifies what it is given.
 */
export function classifyReturnCorrectionLines(
  lines: readonly CorrectionReturnLineInput[],
  snapshotLines: readonly CorrectionSnapshotLine[]
): ReturnCorrectionProposalLine[] {
  const byName = indexSnapshotByName(snapshotLines);

  return lines.map((line) => classifyOne(line, byName));
}

function indexSnapshotByName(
  snapshotLines: readonly CorrectionSnapshotLine[]
): Map<string, ReturnCorrectionCandidate[]> {
  const index = new Map<string, ReturnCorrectionCandidate[]>();

  snapshotLines.forEach((snapshotLine, position) => {
    const key = normalizeCorrectionLineName(snapshotLine.name);
    const candidate: ReturnCorrectionCandidate = {
      // 1-based, matching `CorrectionLine.originalLineNumber` exactly, so the
      // confirm act needs no second translation.
      originalLineNumber: position + 1,
      name: snapshotLine.name,
      quantity: snapshotLine.quantity,
      unitPriceGross: snapshotLine.unitPriceGross,
      taxRate: snapshotLine.taxRate,
      ...(snapshotLine.unit === undefined ? {} : { unit: snapshotLine.unit }),
    };

    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, [candidate]);
      return;
    }
    existing.push(candidate);
  });

  return index;
}

function classifyOne(
  line: CorrectionReturnLineInput,
  byName: Map<string, ReturnCorrectionCandidate[]>
): ReturnCorrectionProposalLine {
  // Checked FIRST, before any name lookup: a line whose disposal OL could not
  // confirm must not be credited even when its name matches perfectly. The
  // reason an operator needs is "attest the blocked restock", not "no line by
  // that name" — and the by-name answer would be the one they act on.
  if (line.hasUnconfirmedDisposition) {
    return noMatch(line, 'disposition-not-confirmed', []);
  }

  if (line.name === null || line.name.trim() === '') {
    return noMatch(line, 'no-line-name', []);
  }

  const byNameCandidates = byName.get(normalizeCorrectionLineName(line.name)) ?? [];
  if (byNameCandidates.length === 0) {
    return noMatch(line, 'no-line-by-name', []);
  }

  const feasible = byNameCandidates.filter(
    (candidate) => candidate.quantity >= line.quantityDisposed
  );
  if (feasible.length === 0) {
    // Every candidate is surfaced anyway — the operator needs to see WHAT was
    // considered to understand why none of it fits.
    return noMatch(line, 'quantity-exceeds-invoiced', byNameCandidates);
  }

  const candidatesPriceOrRateDiffer = hasDivergentPriceOrRate(feasible);

  if (feasible.length > 1) {
    return {
      returnLineId: line.returnLineId,
      lineIndex: line.lineIndex,
      name: line.name,
      sku: line.sku,
      quantityDisposed: line.quantityDisposed,
      status: 'ambiguous',
      candidates: feasible,
      // The point of the whole feature: several candidates, none selected.
      selectedOriginalLineNumber: null,
      newQuantity: null,
      noMatchReason: null,
      candidatesPriceOrRateDiffer,
    };
  }

  const selected = feasible[0];
  return {
    returnLineId: line.returnLineId,
    lineIndex: line.lineIndex,
    name: line.name,
    sku: line.sku,
    quantityDisposed: line.quantityDisposed,
    status: 'matched',
    candidates: feasible,
    selectedOriginalLineNumber: selected.originalLineNumber,
    // Rule 4 — the post-correction quantity, and no price.
    newQuantity: selected.quantity - line.quantityDisposed,
    noMatchReason: null,
    candidatesPriceOrRateDiffer,
  };
}

function hasDivergentPriceOrRate(candidates: readonly ReturnCorrectionCandidate[]): boolean {
  if (candidates.length < 2) {
    return false;
  }
  const [first] = candidates;
  return candidates.some(
    (candidate) =>
      candidate.unitPriceGross !== first.unitPriceGross || candidate.taxRate !== first.taxRate
  );
}

function noMatch(
  line: CorrectionReturnLineInput,
  reason: ReturnCorrectionNoMatchReason,
  candidates: ReturnCorrectionCandidate[]
): ReturnCorrectionProposalLine {
  return {
    returnLineId: line.returnLineId,
    lineIndex: line.lineIndex,
    name: line.name,
    sku: line.sku,
    quantityDisposed: line.quantityDisposed,
    status: 'no-match',
    candidates,
    selectedOriginalLineNumber: null,
    newQuantity: null,
    noMatchReason: reason,
    candidatesPriceOrRateDiffer: hasDivergentPriceOrRate(candidates),
  };
}

/**
 * Operator-facing sentence for an exclusion.
 *
 * Lives here, beside the union it explains, so adding a reason makes this a
 * compile error via `assertNever` rather than a silent fallthrough to a generic
 * string — the same gate `return-custody-transitions` closes its switches with.
 * The copy is destination-neutral (ADR-026): no regime, provider or country
 * vocabulary appears.
 */
export function describeCorrectionNoMatchReason(reason: ReturnCorrectionNoMatchReason): string {
  switch (reason) {
    case 'no-line-name':
      return 'This returned line has no product name, so it cannot be matched to a line on the invoice.';
    case 'no-line-by-name':
      return 'The invoice has no line with this product name. Correct this line by hand if it should be credited.';
    case 'quantity-exceeds-invoiced':
      return 'More units are being returned than any matching invoice line sold, so no correction is proposed.';
    case 'disposition-not-confirmed':
      return 'This line has a disposition OpenLinker could not confirm. Attest it, then re-open the proposal.';
    default:
      return assertNever(reason, 'ReturnCorrectionNoMatchReason');
  }
}
