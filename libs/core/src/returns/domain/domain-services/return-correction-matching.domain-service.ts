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
 * `InvoiceLine` is `{name, quantity, unitPriceGross, taxRate, unit?, orderLineId?}`
 * — historically no id, no sku. `ReturnLine` carries `sku` and `name` and **no
 * price**. So `name` was the only shared axis, and an order that repeats one
 * offer across two lines produced two identically-named invoice lines that no
 * data in either record could tell apart.
 *
 * ## The id-first resolution (#3312)
 *
 * `ReturnLine.resolvedOrderLineId` (#3171/#3172) names the exact `OrderItem` a
 * return line came from, and `InvoiceLine.orderLineId` (#3312) now carries that
 * same id onto the issued snapshot. When both are present and resolve to
 * EXACTLY ONE snapshot line, that line is the match — no name lookup performed,
 * no ambiguity possible. This is tried FIRST, ahead of the by-name rules below.
 *
 * By-name matching remains the FALLBACK for three cases, all legitimate rather
 * than degraded: a return line whose own join is unresolved
 * (`resolvedOrderLineId === null`, which happens on returns ingested TODAY, not
 * only historically — see `return-order-line-resolution.domain-service.ts`); an
 * invoice issued before `orderLineId` existed on the snapshot (every `orderLineId`
 * on every line is `undefined`); or an id that resolves to nothing in THIS
 * invoice's snapshot. None of these is guessed at — falling back to the
 * existing by-name rule is exactly today's shipped behaviour, not a new guess.
 *
 * ## Four rules, each of which is a decision (the by-name fallback)
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
 * or rate, because § 5.8's copy needs it. It is EVIDENCE, never a resolution: a
 * line left unresolved by BOTH the id and by-name paths stays unresolved even
 * when every candidate would credit the same amount, since picking one on that
 * basis stamps a specific `originalLineNumber` into a fiscal document on the
 * strength of a coincidence.
 *
 * ## `status: 'ambiguous'` is retired, not removed (#3312)
 *
 * Before #3312, an unresolved by-name match with more than one candidate
 * produced `status: 'ambiguous'`. It never does anymore: the SAME condition
 * now produces `status: 'no-match', noMatchReason: 'ambiguous-invoice-line'` —
 * a highlighted, non-blocking row, never a candidate-picker (#3091 retired
 * that interaction). `ReturnCorrectionLineStatusValues` still contains
 * `'ambiguous'` so nothing that already pattern-matches on it breaks, but this
 * rule no longer produces it. Removing the dead value from the union is a
 * separate, later cleanup.
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
  /**
   * Mirrors `InvoiceLine.orderLineId` (#3312) — restated for the same reason
   * every other field here is: no cross-context import. `undefined` on a line
   * from a pre-#3312 snapshot, or on a synthesized line (shipping) no single
   * order item backs.
   */
  orderLineId?: string;
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
  /**
   * The order line this return line was resolved to at ingestion (#3171/#3172),
   * or `null` if that join is itself unresolved. `null` is a routine, ongoing
   * state — not only a historical one — since the resolver can genuinely fail
   * to disambiguate a SKU (#3312).
   */
  resolvedOrderLineId: string | null;
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
  const byOrderLineId = indexSnapshotByOrderLineId(snapshotLines);

  return lines.map((line) => classifyOne(line, byOrderLineId, byName));
}

/**
 * Index the snapshot by `orderLineId` — the #3312 id-first lookup. A line
 * carrying no `orderLineId` (pre-#3312 snapshot, or a synthesized shipping
 * line) contributes no entry, so it can never be found and always falls
 * through to the by-name index instead.
 */
function indexSnapshotByOrderLineId(
  snapshotLines: readonly CorrectionSnapshotLine[]
): Map<string, ReturnCorrectionCandidate[]> {
  const index = new Map<string, ReturnCorrectionCandidate[]>();

  snapshotLines.forEach((snapshotLine, position) => {
    if (snapshotLine.orderLineId === undefined) {
      return;
    }
    const candidate: ReturnCorrectionCandidate = {
      originalLineNumber: position + 1,
      name: snapshotLine.name,
      quantity: snapshotLine.quantity,
      unitPriceGross: snapshotLine.unitPriceGross,
      taxRate: snapshotLine.taxRate,
      ...(snapshotLine.unit === undefined ? {} : { unit: snapshotLine.unit }),
    };

    const existing = index.get(snapshotLine.orderLineId);
    if (existing === undefined) {
      index.set(snapshotLine.orderLineId, [candidate]);
      return;
    }
    existing.push(candidate);
  });

  return index;
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
  byOrderLineId: Map<string, ReturnCorrectionCandidate[]>,
  byName: Map<string, ReturnCorrectionCandidate[]>
): ReturnCorrectionProposalLine {
  // Checked FIRST, ahead of BOTH lookups: a line whose disposal OL could not
  // confirm must not be credited even when its join is perfectly known. The
  // reason an operator needs is "attest the blocked restock", not a match
  // outcome — and any match answer would be the one they act on instead.
  if (line.hasUnconfirmedDisposition) {
    return noMatch(line, 'disposition-not-confirmed', []);
  }

  // Also ahead of both lookups, deliberately: a line with no name recorded is
  // never matched even when its order-line join is known, because every
  // downstream candidate still carries a `name` the operator reads, and this
  // line has none to compare it against for a sanity check (#3312 review).
  if (line.name === null || line.name.trim() === '') {
    return noMatch(line, 'no-line-name', []);
  }

  // #3312 — id-first: deterministic, no name lookup, when the return's own
  // order-line join resolves and that id is present on THIS invoice's
  // snapshot. Absent from the index (pre-#3312 snapshot, or an id this
  // invoice's lines never carried) falls through to by-name below — exactly
  // today's shipped behaviour, not a new guess.
  if (line.resolvedOrderLineId !== null) {
    const idCandidates = byOrderLineId.get(line.resolvedOrderLineId);
    if (idCandidates !== undefined) {
      return classifyAgainstCandidates(line, idCandidates);
    }
  }

  const byNameCandidates = byName.get(normalizeCorrectionLineName(line.name)) ?? [];
  if (byNameCandidates.length === 0) {
    return noMatch(line, 'no-line-by-name', []);
  }

  return classifyAgainstCandidates(line, byNameCandidates);
}

/**
 * Resolve a line against a candidate set found by EITHER lookup (id-first or
 * by-name) — rules 3 and 4 from the module docblock, plus the #3312 residual:
 * more than one feasible candidate is `no-match('ambiguous-invoice-line')`,
 * never `status: 'ambiguous'`.
 */
function classifyAgainstCandidates(
  line: CorrectionReturnLineInput,
  candidates: readonly ReturnCorrectionCandidate[]
): ReturnCorrectionProposalLine {
  const feasible = candidates.filter((candidate) => candidate.quantity >= line.quantityDisposed);
  if (feasible.length === 0) {
    // Every candidate is surfaced anyway — the operator needs to see WHAT was
    // considered to understand why none of it fits.
    return noMatch(line, 'quantity-exceeds-invoiced', [...candidates]);
  }

  if (feasible.length > 1) {
    return noMatch(line, 'ambiguous-invoice-line', feasible);
  }

  const [selected] = feasible;
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
    candidatesPriceOrRateDiffer: hasDivergentPriceOrRate(feasible),
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
    case 'ambiguous-invoice-line':
      return 'This return could not be matched to exactly one invoice line automatically. Check the invoice by hand before crediting it.';
    default:
      return assertNever(reason, 'ReturnCorrectionNoMatchReason');
  }
}
