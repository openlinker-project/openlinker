/**
 * Parcel verification vocabulary (#2418, `W3b-5`, spec § 2.5, decisions D18/D19/D20)
 *
 * What the pack bench records while it fills one box, and the closed set of
 * reasons a unit can be turned away.
 *
 * ## D20 lives in the SHAPE of this file, not in a convention
 *
 * *"Manual confirmation is recorded identically to a scan."* `VerifyUnitInput`
 * names a LINE and nothing else — no barcode, no `source`, no
 * `confirmationMethod`. A scan and a hand-confirm reach the service through the
 * same method with the same arguments, so recording them differently is not
 * expressible rather than merely discouraged. The ledger row carries no such
 * column either, and `fulfillment-verification-indistinguishable.spec.ts`
 * asserts the absence on both halves.
 *
 * The cost is stated by the decision itself and accepted: dispute evidence is
 * weaker on a hand-confirmed line. What marking it would buy is worse — a
 * stigma, and the undetectable workaround it drives (scan a second unit of the
 * same SKU twice, after which the parcel closes looking perfectly verified).
 *
 * ## There is no `closeParcel`
 *
 * D18: *"the parcel closes on the last verification, with no confirmation
 * step."* The close is a consequence of `verifyUnit`, inside the same
 * transaction, so there is nothing for a commit control to call. That is why no
 * close input type appears here.
 *
 * @module libs/core/src/fulfillment/domain/types
 */

/**
 * Units a line still requires, and the ONE definition of it.
 *
 * Byte-identical to the expression the bench work list already publishes as
 * `unitsToVerify` (#2416), and shared rather than restated so the two cannot
 * drift: a packer shown "6 units to verify" beside a close predicate counting
 * to 7 is the shape of a box that never shuts.
 *
 * `cancelledQuantity` is subtracted because nobody will put those units in the
 * box. `fulfilledQuantity` is deliberately NOT consulted — it is progress
 * ingress's column (#2400), and reading it here would make the bench's target
 * move under a packer when an executor reported something.
 *
 * Pure, and living beside the type it is the rule for — the pure-rule exception
 * in `engineering-standards.md`, on all three counts.
 */
export function requiredUnitsForLine(line: {
  readonly totalQuantity: number;
  readonly cancelledQuantity: number;
}): number {
  return Math.max(0, line.totalQuantity - line.cancelledQuantity);
}

/**
 * Why a unit was not recorded.
 *
 * Closed, because every member is rendered to a packer in their own words and
 * an open set is a set the surface cannot render. Each one records **nothing**:
 * no ledger row, and no consumption of the gesture id, so the packer's next
 * correct scan of the same physical action is not deduplicated away.
 */
export const ParcelVerificationRefusalValues = [
  /** The work is not one this bench may pack — story D2's shared rule said so. */
  'not-packable',
  /** The box is already closed. Reopen it first (E6). */
  'parcel-closed',
  /** No such line on this work. */
  'no-such-line',
  /**
   * The line is already full (E3). The recorded quantity never exceeds the
   * line's requirement, so the extra unit is refused at the moment it happens
   * rather than clamped afterwards.
   */
  'over-packed',
] as const;

export type ParcelVerificationRefusal = (typeof ParcelVerificationRefusalValues)[number];

/** Why a reopen was refused. */
export const ParcelReopenRefusalValues = [
  /**
   * The goods left the building (D19). The box is gone, and reopening it in
   * software is a fiction.
   */
  'shipped',
  /** Nothing to reopen — the parcel is not closed. */
  'not-closed',
] as const;

export type ParcelReopenRefusal = (typeof ParcelReopenRefusalValues)[number];

/**
 * One unit, verified into the box.
 *
 * `gestureId` is #2416's client-minted, storage-durable per-gesture id, CONSUMED
 * here rather than designed: it is the uniqueness key, so a retried request is a
 * no-op returning the current state while two genuinely separate scans carry two
 * ids and record two units (story G3's *"a legitimate second scan is recorded as
 * a second unit"*). Emission of any of this to
 * `IFulfillmentProgressService` is #2420's and happens nowhere in this context.
 */
export interface VerifyUnitInput {
  readonly workId: string;
  readonly workLineId: string;
  readonly gestureId: string;
  /**
   * Who verified it. `null` only where no user is attributable; the bench
   * always has one, because the surface will not accept a scan while locked.
   */
  readonly verifiedByUserId: string | null;
}

/** Per-line verified counts, and whether the box is shut. */
export interface ParcelVerificationLineState {
  readonly workLineId: string;
  /** Units this line still requires — `totalQuantity − cancelledQuantity`. */
  readonly requiredQuantity: number;
  /** Units verified into the box. Never greater than `requiredQuantity`. */
  readonly verifiedQuantity: number;
}

/** The whole of what the bench needs to know about a parcel's progress. */
export interface ParcelVerificationState {
  readonly workId: string;
  /**
   * The work's optimistic token AS OF THIS ANSWER.
   *
   * Carried here rather than read off a work loaded before the write, and that
   * is load-bearing: `claimParcelClose` and `reopenParcel` both bump `version`
   * in SQL, so a caller projecting the pre-write value would hand a client a
   * token that is stale the moment it is issued. The client's very next act is
   * the one that needs it — E6's reopen is the only correction path this
   * surface has, and a packer reaches for it in the seconds after a mis-scan
   * shut the box. With a stale token that reopen is refused as `not-closed`
   * about a parcel the same screen is rendering as closed.
   */
  readonly version: number;
  readonly lines: readonly ParcelVerificationLineState[];
  /**
   * When the last verification shut the box (D18), or `null` while it is open.
   *
   * This is the completion instant #2413's ORM entity deliberately withheld —
   * *"no `packedAt` is added here because that would be a second completion
   * instant competing with the model #2418 owns"*.
   */
  readonly closedAt: Date | null;
  /**
   * Who shut it — the LAST verifier (D13), which under roaming benches may be
   * someone who checked one item of five. A reader must not take it as a
   * complete account of who handled the box; the ledger holds the rest.
   */
  readonly packedByUserId: string | null;
}

/** What `verifyUnit` answers. */
export type VerifyUnitResult =
  | {
      /** The unit was recorded. `closedAt` on the state says whether it was the last. */
      readonly outcome: 'verified';
      readonly state: ParcelVerificationState;
    }
  | {
      /**
       * This exact gesture had already been recorded — a retry, a sleeping
       * tablet, a reflex double-trigger on ONE physical action. Nothing changed
       * and the current state is returned.
       */
      readonly outcome: 'deduplicated';
      readonly state: ParcelVerificationState;
    }
  | {
      readonly outcome: 'refused';
      readonly reason: ParcelVerificationRefusal;
      readonly state: ParcelVerificationState;
    };

/**
 * Reopening a parcel closed by mistake (E6/D19).
 *
 * `hasShipped` is a REQUIRED ARGUMENT rather than a read, and that is
 * ADR-053's own discipline rather than a fudge: `fulfillment` is a registered
 * zero-sibling-edge leaf and may not read `shipping`, so the *rule* stays here —
 * in one place, refusing — while the *fact* arrives from the caller that is
 * allowed to know it. Required, never optional: an optional flag defaulting to
 * `false` would silently reopen a shipped parcel the day a second caller
 * forgot it.
 */
export interface ReopenParcelInput {
  readonly workId: string;
  readonly reopenedByUserId: string | null;
  readonly hasShipped: boolean;
  /**
   * The optimistic token, as every other guarded write on this aggregate takes
   * one. A reopen issued against a stale view is exactly D21's scenario — the
   * work moved underneath the packer — and answering `not-closed` for a version
   * mismatch is the correct, conservative outcome: nothing was written.
   *
   * That conservatism is only honest because `ParcelVerificationState.version`
   * is the POST-write token: a client reopening a box it has just watched close
   * holds the value the close produced, so the refusal it can receive is a real
   * conflict rather than an artefact of the answer it was handed.
   */
  readonly expectedVersion?: number;
}

/** What `reopenParcel` answers. */
export type ReopenParcelResult =
  | { readonly outcome: 'reopened'; readonly state: ParcelVerificationState }
  | {
      readonly outcome: 'refused';
      readonly reason: ParcelReopenRefusal;
      readonly state: ParcelVerificationState;
    };
