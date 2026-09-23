/**
 * Pack-bench parcel and document types (#2418, `W3b-5`, spec §§ 2.4–2.6)
 *
 * The browser's view of the five parcel and document reads.
 *
 * ## No `z.enum` on any server-owned vocabulary, for the list's own reason
 *
 * `refusal`, a verification `outcome`, a refusal `reason`, an invoice `state`
 * and a label `state` are all plain strings here. `bench-work.types.ts` records
 * why: an enum means that the day the backend adds a value the whole response
 * fails to parse, and this surface would then tell a packer standing in front of
 * a full box that there is nothing to pack. An unrecognised value degrades in
 * the copy layer, where it can be said out loud.
 *
 * ## What is NOT on this wire, and why that is the point
 *
 * No address, no email, no phone. The API projects field by field rather than
 * by spread, and this mirror is the same allowlist one layer out — so a
 * surface built on it cannot render what it was never handed.
 *
 * `totalAmount`/`currency`/`carrierName`/`dispatchByAt` on `BenchParcel`, and
 * `imageUrl`/`attributes`/`binCode`/the weight+dimension fields on
 * `BenchParcelLine`, are a DELIBERATE reversal of the original "no total, no
 * price" exclusion (#3409/#3410, mockup-parity epic #3401) — see the API
 * type's own docblock for the reasoning.
 *
 * @module apps/web/src/features/bench/api
 */

/** One line of one box. */
export interface BenchParcelLine {
  readonly workLineId: string;
  readonly productVariantId: string;
  /** `null` when the variant is not in the catalogue — the codes are shown instead. */
  readonly name: string | null;
  readonly sku: string | null;
  readonly ean: string | null;
  readonly gtin: string | null;
  /** Units this line still requires. Never a claim that they are on a shelf. */
  readonly requiredQuantity: number;
  /** Units verified into the box. Never greater than `requiredQuantity`. */
  readonly verifiedQuantity: number;
  /** The parent product's first image, or `null`. */
  readonly imageUrl: string | null;
  /** The variant's distinguishing attributes (colour, size, …), or `null`. */
  readonly attributes: Record<string, string> | null;
  /** Operator-authored bin/shelf code, or `null` when never recorded. */
  readonly binCode: string | null;
  /** Display-only physical master data. `null` on any field means "not recorded". */
  readonly weightGrams: number | null;
  readonly lengthMm: number | null;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
}

/** One box, as the bench sees it. */
export interface BenchParcel {
  readonly workId: string;
  /** Optimistic token. Sent back on a reopen. */
  readonly version: number;
  readonly orderReference: string;
  readonly buyerName: string | null;
  /** The order's total, in the source's own currency. */
  readonly totalAmount: number | null;
  readonly currency: string | null;
  /** The source's own delivery-method label; `null` when the source reports none. */
  readonly carrierName: string | null;
  readonly dispatchByAt: string | null;
  readonly parcelIndex: number;
  readonly parcelTotal: number;
  /**
   * `held` | `cancelled`, or an unrecognised value from a newer API. `null`
   * means the box may be packed.
   */
  readonly refusal: string | null;
  readonly holdReason: string | null;
  /** When the last verification shut the box, or `null` while it is open. */
  readonly closedAt: string | null;
  readonly packedByUserId: string | null;
  /**
   * Who this parcel is assigned to, or `null` for the unassigned pool.
   *
   * A raw OL user id, like `packedByUserId` beside it — never a name, and
   * never rendered directly. Carried so a lost claim race can name who
   * actually holds the parcel now, rather than a refusal that names nobody.
   */
  readonly assignedToUserId: string | null;
  /**
   * When this parcel's invoice was FIRST printed, or `null` if never. A
   * reprint never moves it — the question is whether it was ever printed,
   * because that is what the pack-bench completion confirm reads.
   */
  readonly invoicePrintedAt: string | null;
  /** The label sibling of `invoicePrintedAt`. Same reading. */
  readonly labelPrintedAt: string | null;
  /**
   * When an operator declared this parcel finished and off the bench, or
   * `null` until that act. A distinct, later instant from `closedAt` — the
   * box can be correctly packed for a while before anyone confirms the label
   * is on it and it has actually left.
   */
  readonly completedAt: string | null;
  readonly lines: readonly BenchParcelLine[];
}

/** What one verification did. `parcel` comes back on every outcome, refusals included. */
export interface BenchVerificationResult {
  /** `verified` | `deduplicated` | `refused`, or something newer. */
  readonly outcome: string;
  /** `not-packable` | `parcel-closed` | `no-such-line` | `over-packed`, or `null`. */
  readonly reason: string | null;
  readonly parcel: BenchParcel;
}

export interface BenchReopenResult {
  /** `reopened` | `refused`. */
  readonly outcome: string;
  /** `shipped` | `not-closed`, or `null`. */
  readonly reason: string | null;
  readonly parcel: BenchParcel;
}

/**
 * What declaring a parcel finished and off the bench answers (pack-bench
 * completion).
 *
 * `parcel` comes back on every outcome, exactly as it does on a verification —
 * a refusal re-renders the box as it now stands rather than leaving a stale
 * one on screen.
 */
export interface BenchCompleteResult {
  /** `completed` | `refused`. */
  readonly outcome: string;
  /**
   * `not-closed` | `already-completed` | `version-conflict` |
   * `not-claimable-by-viewer`, or `null` on `completed`, or something newer.
   */
  readonly reason: string | null;
  readonly parcel: BenchParcel;
}

/**
 * What taking back a completion answers.
 *
 * The counterpart to `BenchCompleteResult` — a completion used to be a
 * one-way door, and this clears `completedAt` alone. Every scan and the
 * closed box stand; the box is not reopened.
 */
export interface BenchUndoCompletionResult {
  /** `undone` | `refused`. */
  readonly outcome: string;
  /**
   * `not-completed` | `version-conflict` | `not-claimable-by-viewer`, or
   * `null` on `undone`, or something newer.
   */
  readonly reason: string | null;
  readonly parcel: BenchParcel;
}

/** The paper that goes INSIDE the box. */
export interface BenchInvoice {
  /** `ready` | `issued-not-printable` | `missing`. */
  readonly state: string;
  readonly invoiceId: string | null;
  readonly documentNumber: string | null;
  readonly issuedAt: string | null;
  /** The persisted sales-document block reason, verbatim. Never blocks packing. */
  readonly blockReason: string | null;
  /** The routing half of the same answer. */
  readonly unresolvedReason: string | null;
}

/** The paper that goes ON the box. */
export interface BenchLabel {
  /** `ready` | `unavailable` | `none`. */
  readonly state: string;
  readonly shipmentId: string | null;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  /** The carrier's own short code. A discriminator, not prose. */
  readonly providerCode: string | null;
  /**
   * The carrier's own words — `null` for a caller without `shipments:write`,
   * which is every packer, because the raw rejection text may embed address
   * fragments.
   */
  readonly carrierMessage: string | null;
  /**
   * Whether a reason EXISTS that this caller may not see.
   *
   * Without it the surface cannot tell "the carrier gave no reason" from "the
   * reason is hidden from your role" — and for a packer, who never sees the
   * prose, it would print the first whenever the second is true.
   */
  readonly carrierMessageRedacted: boolean;
  readonly failedAt: string | null;
}

export interface BenchDocuments {
  readonly workId: string;
  readonly invoice: BenchInvoice;
  readonly label: BenchLabel;
}

/** One finished box with no label on it. Read by this bench and by dispatch alike. */
export interface BenchUnlabelledParcel {
  readonly workId: string;
  readonly orderReference: string;
  readonly parcelIndex: number;
  readonly parcelTotal: number;
  readonly closedAt: string | null;
  readonly carrier: string | null;
  readonly providerCode: string | null;
}

export interface BenchUnlabelledParcelList {
  readonly parcels: readonly BenchUnlabelledParcel[];
  readonly total: number;
  /** Whether the read hit its cap. Said out loud rather than truncating silently. */
  readonly truncated: boolean;
}

/** What an undo-last-scan answers (#3405, epic #3401). */
export interface BenchUndoResult {
  /** `voided` | `refused`. */
  readonly outcome: string;
  /** `parcel-closed` | `nothing-to-undo`, or `null`. */
  readonly reason: string | null;
  /** Which line's count just went down. `null` on any outcome but `voided`. */
  readonly workLineId: string | null;
  readonly parcel: BenchParcel;
}

/** What claiming this parcel answers (#3412). */
export interface BenchClaimResult {
  /** `claimed` | `refused`. */
  readonly outcome: string;
  /**
   * `held` | `cancelled` | `not-claimable` | `claimed-by-someone-else`, or
   * `null`.
   *
   * `not-claimable` is the standing ADR-074 lock; `claimed-by-someone-else`
   * is a peer winning the race between the read that offered this parcel and
   * the write — a different fact, and the two must read differently. See
   * `parcel.assignedToUserId` for who holds it now.
   */
  readonly reason: string | null;
  readonly parcel: BenchParcel;
}

/** What "take next task" answers (#3412). */
export interface BenchClaimNextResult {
  /**
   * `claimed` | `nothing-to-claim` | `refused`.
   *
   * The last two are different facts and must stay apart on screen:
   * `nothing-to-claim` means the queue was empty, `refused` means a parcel was
   * found and lost — usually to another packer, in the moment between the read
   * and the write, with the rail still showing the row.
   */
  readonly outcome: string;
  readonly parcel: BenchParcel | null;
  /**
   * `held` | `cancelled` | `not-claimable` | `claimed-by-someone-else`.
   * Non-null only on `refused`.
   */
  readonly reason: string | null;
}

/** One OTHER packer who currently has this parcel open (#3406). */
export interface BenchPresenceViewer {
  /**
   * Already masked by the API — "Anna Kowalska" arrives as "A. Kowalska".
   * Never a user id, and never a name this surface assembles itself.
   */
  readonly displayName: string;
}

/**
 * A collision signal (#3406) — advisory only, never a lock.
 *
 * `others` NEVER includes the viewer, and an empty array is the first-class
 * answer "nobody else". A FAILED read is not that answer: it throws, and the
 * surface renders no banner AND no reassurance, because a read that did not
 * happen has no standing to say the box is yours alone.
 */
export interface BenchPresence {
  /** Exactly `others.length > 0`. What the banner's visibility keys on. */
  readonly collision: boolean;
  /** Most recently seen first. */
  readonly others: readonly BenchPresenceViewer[];
}

/** One entry of a parcel's recent-activity log (#3411). */
export interface BenchActivityEntry {
  readonly workLineId: string;
  readonly name: string | null;
  /** `verified` | `undone`. */
  readonly kind: string;
  readonly at: string;
  readonly byUserId: string | null;
}

/** One row of the "Packed today" tab (#3413). */
export interface BenchPackedTodayRow {
  readonly workId: string;
  readonly orderReference: string;
  readonly buyerName: string | null;
  readonly parcelIndex: number;
  readonly parcelTotal: number;
  readonly closedAt: string;
  readonly packedByUserId: string | null;
}

export interface BenchPackedTodayList {
  readonly works: readonly BenchPackedTodayRow[];
  readonly total: number;
}

/** The bench metric row (#3413). */
export interface BenchMetrics {
  readonly packedToday: number;
  readonly packedYesterday: number;
  readonly toPackAllBenches: number;
}
