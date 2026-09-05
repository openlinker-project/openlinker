/**
 * Parcel verification (#2418, `W3b-5`, spec § 2.5)
 *
 * What the pack bench does to one box: verify a unit into it, read where it has
 * got to, and — only when it was closed by mistake — open it again.
 *
 * ## There is no `closeParcel`, and that absence is the contract
 *
 * Decision D18: *"the parcel closes on the last verification, with no
 * confirmation step."* The close is a consequence of `verifyUnit`, inside the
 * same transaction, so **there is nothing for a commit control to call**. A
 * "Done" button on the bench is not merely discouraged, it has no method — and
 * `no-parcel-commit-control.spec.ts` asserts that this interface never grows
 * one.
 *
 * ## One method for a scan and for a hand-confirm
 *
 * Decision D20. `VerifyUnitInput` names a LINE; the scanned value is resolved to
 * one above this seam and then discarded. So the two paths are not merely
 * recorded the same way, they are the same call — which is what makes
 * *"indistinguishable in storage"* a property of the type rather than a
 * convention somebody has to keep.
 *
 * ## What this does NOT do
 *
 * It emits nothing. Telling the rest of the system that a parcel was packed —
 * `IFulfillmentProgressService`, the order-grain derivation, the desktop
 * worklist — is #2420's, and this context deliberately does not reach for it.
 * `fulfillment_work_lines.fulfilledQuantity` is likewise untouched: its own
 * column docblock reserves it for progress ingress.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 */
import type {
  ParcelVerificationState,
  ReopenParcelInput,
  ReopenParcelResult,
  VerifyUnitInput,
  VerifyUnitResult,
} from '../../domain/types/fulfillment-verification.types';

export interface IFulfillmentVerificationService {
  /**
   * Where this parcel has got to. A pure read; it closes nothing.
   *
   * Raises `FulfillmentWorkNotFoundError` for an unknown work, because a bench
   * asking about a parcel that does not exist is a different fact from a parcel
   * with nothing verified yet.
   */
  getState(workId: string): Promise<ParcelVerificationState>;

  /**
   * Verify one unit into the box (stories E1, E3, E4) — and shut the box when it
   * was the last (E5/D18).
   *
   * Never throws for a modelled refusal: an over-pack, a closed parcel and an
   * unknown line are all ordinary answers a packer must be shown, not errors.
   * Each records **nothing** — no ledger row, and no consumption of the gesture
   * id, so the packer's next correct scan of the same physical action is not
   * deduplicated away.
   */
  verifyUnit(input: VerifyUnitInput): Promise<VerifyUnitResult>;

  /**
   * Open a parcel closed by mistake (story E6, decision D19).
   *
   * Every active verification is voided, so verification resumes from zero —
   * forced, because a closed parcel's counts are by definition full and keeping
   * them would re-shut the box on the next recount. It is also the honest
   * answer to the case E6 exists for: a mis-scan completed the count, and
   * nobody knows which unit was wrong.
   */
  reopenParcel(input: ReopenParcelInput): Promise<ReopenParcelResult>;
}
