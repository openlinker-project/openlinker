/**
 * Return Correction Proposal Types (#2374, `W2-38`, ADR-060 / ADR-044)
 *
 * The vocabulary of a **credit-note correction proposal**: a diff of a return's
 * disposed lines against the invoice's issuance-time line snapshot (#1297),
 * classified per line, with the positional ambiguity SHOWN rather than resolved.
 *
 * ## Why every one of these values exists
 *
 * `CorrectionLine.originalLineNumber` is a **1-based position into the original
 * document's line array** — `InvoiceLine` carries no stable identifier, and
 * `ReturnLine` carries no price at all, so the only axis the two shapes share is
 * `name`. When one order repeats the same offer on more than one line (the shape
 * SPIKE-2375 found for Allegro commission refunds, where a claim keys on an order
 * LINE ITEM), the invoice holds two identically-named lines and nothing in either
 * record can say which one a return line refers to.
 *
 * A proposal that cannot say which line it corrects is not a proposal, it is a
 * guess about money — and a correction transmitted to a tax authority cannot be
 * withdrawn. So `ambiguous` is a first-class outcome that lists EVERY candidate
 * and selects none, and `no-match` always carries a reason the operator can act
 * on. Neither is a degraded `matched`.
 *
 * @module libs/core/src/returns/domain/types
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 * @see docs/architecture/adrs/044-order-changeset-proposed-then-confirmed.md
 * @see docs/specs/product-spec-oms-returns-operator-ux.md § 5.8
 */

/**
 * How confidently one disposed return line maps onto a line of the issued
 * document.
 *
 * `ambiguous` is never collapsed into `matched`, not even when every candidate
 * carries the same price and rate: selecting one would stamp a specific
 * `originalLineNumber` into a fiscal document on the strength of an amount
 * coincidence. See {@link ReturnCorrectionProposalLine.candidatesPriceOrRateDiffer},
 * which reports that coincidence as evidence for the operator rather than acting
 * on it.
 */
export const ReturnCorrectionLineStatusValues = ['matched', 'ambiguous', 'no-match'] as const;

export type ReturnCorrectionLineStatus = (typeof ReturnCorrectionLineStatusValues)[number];

/**
 * Why a disposed line carries no proposal.
 *
 * Four values rather than one, because each is a DIFFERENT operator action
 * (#2231's rule: a closed union that can only say "excluded" tells an operator
 * nothing they can act on).
 *
 * - `no-line-name` — the return line has no name, so there is nothing to match
 *   on. A data gap at ingestion, not a system fault.
 * - `no-line-by-name` — the document holds no line with that name. Usually the
 *   product was invoiced under a different description; the operator corrects by
 *   hand.
 * - `quantity-exceeds-invoiced` — a line of that name exists, but every one of
 *   them invoiced FEWER units than are being returned. Proposing it would emit a
 *   negative post-correction quantity, which the provider would reject after the
 *   operator had moved on.
 * - `disposition-not-confirmed` — the line holds an outstanding `blocked` or
 *   `in_doubt` disposition act whose units never reached the counters (#2370
 *   rule 1). OL does not know the goods were accepted back, so crediting for them
 *   would be a guess. The remediation is the same attestation a block already
 *   has, after which the proposal can be re-opened.
 */
export const ReturnCorrectionNoMatchReasonValues = [
  'no-line-name',
  'no-line-by-name',
  'quantity-exceeds-invoiced',
  'disposition-not-confirmed',
] as const;

export type ReturnCorrectionNoMatchReason =
  (typeof ReturnCorrectionNoMatchReasonValues)[number];

/**
 * What `buildProposal` did.
 *
 * Every non-proposing exit is a NAMED value, never an empty result — a silent
 * decline is the defect class this programme keeps closing (ADR-041 § 54's
 * principle, applied one context over).
 *
 * - `proposed` — at least one line is `matched` or `ambiguous`; an `order_changes`
 *   row was opened or reused.
 * - `nothing-correctable` — a document exists and its lines were classified, but
 *   none is correctable. The proposal body is STILL returned in full so the
 *   operator reads every exclusion reason; no row is opened, because a slot must
 *   not be held for a proposal with nothing to confirm.
 * - `no-invoice` — the order holds no `issued` invoice record.
 * - `no-line-snapshot` — the target document predates the #1297 snapshot column.
 *   REFUSED, never diffed against the order's current state: correcting against
 *   an order that has since changed is precisely the defect #1297 exists to
 *   prevent.
 * - `no-disposed-lines` — nothing has been disposed yet, so there is nothing to
 *   credit.
 */
export const ReturnCorrectionProposalOutcomeValues = [
  'proposed',
  'nothing-correctable',
  'no-invoice',
  'no-line-snapshot',
  'no-disposed-lines',
] as const;

export type ReturnCorrectionProposalOutcome =
  (typeof ReturnCorrectionProposalOutcomeValues)[number];

/**
 * One line of the issued document a return line could be correcting.
 *
 * `originalLineNumber` is 1-based and is exactly what
 * `CorrectionLine.originalLineNumber` expects, so the confirm act (#2376) needs
 * no second translation step.
 */
export interface ReturnCorrectionCandidate {
  originalLineNumber: number;
  name: string;
  quantity: number;
  unitPriceGross: number;
  /** Neutral rate code as issued (`23`, `0`, `zw`, …) — never re-derived here. */
  taxRate: string;
  unit?: string;
}

/** One disposed return line, and what the document says about it. */
export interface ReturnCorrectionProposalLine {
  returnLineId: string;
  lineIndex: number;
  name: string | null;
  sku: string | null;
  /** `quantityRestocked + quantityScrapped` — book-confirmed disposal only. */
  quantityDisposed: number;
  status: ReturnCorrectionLineStatus;
  /**
   * EVERY candidate, always — the acceptance criterion. An `ambiguous` line lists
   * all of them and selects none; a `matched` line lists the single one it
   * selected; a `no-match` line lists whatever was found before a filter emptied
   * the set, so the operator can see what was considered.
   */
  candidates: ReturnCorrectionCandidate[];
  /** Set ONLY on `matched`. `null` on `ambiguous` — the operator picks. */
  selectedOriginalLineNumber: number | null;
  /** The post-correction quantity for the selected candidate; `null` unless matched. */
  newQuantity: number | null;
  /** Set only on `no-match`. */
  noMatchReason: ReturnCorrectionNoMatchReason | null;
  /**
   * Whether the candidates disagree on `unitPriceGross` or `taxRate`.
   *
   * Named for the two fields it actually compares so § 5.8's copy — *"the
   * correction amount is the same either way **unless these lines were priced
   * differently**"* — maps onto it without a lookup. `false` on an ambiguous line
   * is evidence the operator may act on; it is never grounds for OL to pick.
   */
  candidatesPriceOrRateDiffer: boolean;
}

/**
 * The proposal itself — DATA. Nothing in this shape issues anything, and holding
 * one confers no authority to issue.
 */
export interface ReturnCorrectionProposal {
  returnId: string;
  internalOrderId: string;
  /** The `InvoiceRecord` being corrected — always the latest ISSUED one (see D7). */
  invoiceRecordId: string;
  invoiceConnectionId: string;
  /** Human-facing document number, `null` for a provider that numbers its own. */
  invoiceDocumentNumber: string | null;
  /** ISO 4217, echoed from the snapshot. Core neither converts nor rounds. */
  currency: string;
  lines: ReturnCorrectionProposalLine[];
}

/** What {@link IReturnCorrectionProposalService.buildProposal} answers. */
export interface ReturnCorrectionProposalResult {
  outcome: ReturnCorrectionProposalOutcome;
  /** `null` for the three exits that never reached a document with lines. */
  proposal: ReturnCorrectionProposal | null;
  /**
   * The ADR-044 row id, or `null` when no row was opened (`nothing-correctable`
   * and every non-proposing exit).
   */
  changeId: string | null;
  /** `false` when an identical open proposal was reused rather than re-opened. */
  opened: boolean;
}
