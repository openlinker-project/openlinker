/**
 * Return Correction Proposal Service Interface (#2374, `W2-38`, ADR-060 / ADR-044)
 *
 * ## What this is, and what it is NOT
 *
 * It **is** a diff and a recommendation: OpenLinker reads the invoice's
 * issuance-time line snapshot (#1297), matches the return's disposed lines
 * against it, and reports — per line — the single line it would correct, or every
 * line it cannot choose between, or the reason it proposes nothing at all.
 *
 * It is **NOT an issuance**. Nothing here calls `CorrectionIssuer`,
 * `IInvoiceService.issueCorrection`, or any adapter; nothing here crosses a
 * provider boundary; and holding a proposal confers no authority to issue one.
 * Issuing is the operator's confirmed act through the existing correction flow
 * (#2376 / #2382), and a spec asserts that this file names neither symbol.
 *
 * That separation is the point rather than a nicety: **a correction transmitted
 * to a tax authority cannot be withdrawn**, and the single thing this service is
 * built to surface — the positional-line ambiguity — is precisely the thing a
 * machine must not resolve on its own. Auto-issue stays gated on `InvoiceLine`
 * gaining a stable reference; it has none today (ADR-060 § Decision).
 *
 * @module libs/core/src/returns/application/services
 */
import type { ReturnCorrectionProposalResult } from '../../domain/types/return-correction-proposal.types';

/** What a caller supplies to build (and record) a proposal. */
export interface BuildReturnCorrectionProposalInput {
  returnId: string;
  /** The OL user asking, or `null` for a system-initiated build. */
  actorUserId: string | null;
}

export interface IReturnCorrectionProposalService {
  /**
   * Build the credit-note correction proposal for a return, and record it as an
   * ADR-044 `order_changes` row when there is something to confirm.
   *
   * Refuses an ORPHAN through the single seam
   * `IReturnsService.assertAttributedForTrigger('invoice_correction')` (#2332),
   * raising `ReturnNotAttributedError` — a correction against a phantom order is
   * a fiscal event against the wrong document, so it cannot proceed by omission.
   * `ReturnNotFoundError` stays distinct.
   *
   * Every OTHER non-proposing exit is a named `outcome` value rather than a
   * throw, because those are states an operator reads and acts on, not failures.
   * The proposal body is still returned whenever a document with lines was
   * reached, so an excluded line always states its reason.
   *
   * Recomputes on every call and keeps the persisted row identical to what it
   * returns: an open row whose payload still matches is reused; one that no
   * longer matches is `abandon`ed and replaced. The row consequently holds **no
   * operator picks** — a pick for an ambiguous line belongs to the confirm
   * request, or it would be destroyed by the next build.
   */
  buildProposal(
    input: BuildReturnCorrectionProposalInput
  ): Promise<ReturnCorrectionProposalResult>;
}
