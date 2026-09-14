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
 * No address, no email, no phone, no total, no price. The API projects field by
 * field rather than by spread, and this mirror is the same allowlist one layer
 * out — so a surface built on it cannot render what it was never handed.
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
}

/** One box, as the bench sees it. */
export interface BenchParcel {
  readonly workId: string;
  /** Optimistic token. Sent back on a reopen. */
  readonly version: number;
  readonly orderReference: string;
  readonly buyerName: string | null;
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
