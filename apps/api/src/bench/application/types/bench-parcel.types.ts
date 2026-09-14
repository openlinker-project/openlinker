/**
 * Pack-bench parcel view types (#2418, `W3b-5`, spec §§ 2.4–2.6)
 *
 * One box: what must go in it, how far it has got, what paper belongs with it,
 * and — when it must not be packed at all — why.
 *
 * ## This is the replacement for reading the order through `/orders`
 *
 * #2413 closed `OrdersController` to `packer` because `orderSnapshot` carries
 * the buyer's name, email and BOTH un-redacted addresses under the default
 * `OL_STORE_PII=true` — a superset of the customer register it had just closed.
 * The bench still has to know what goes in the box, so it reaches the parcel
 * **through the work**, and this is that projection.
 *
 * It is an explicit ALLOWLIST, field by field, never a spread. The list below IS
 * the surface, and it is also the proof for story D4: an interruption fires when
 * this projection changes, and there is no address, no email, no phone, no
 * total and no price in it — so *"an interruption that fires on a buyer's
 * address edit"* is not something to be careful about, it is not expressible.
 *
 * `buyerName` is the one PII field, and it is #2416's already-decided
 * disclosure: it is the name about to go on the label the same session is
 * allowed to print.
 *
 * @module apps/api/src/bench/application/types
 */
import type {
  ParcelReopenRefusal,
  ParcelVerificationRefusal,
} from '@openlinker/core/fulfillment';
import type { HoldReason } from '@openlinker/core/order-lifecycle';
import type {
  SalesDocumentGateBlockReason,
  SalesDocumentUnresolvedReason,
} from '@openlinker/core/sales-documents';

/**
 * Why this parcel must not be packed (story D2).
 *
 * Derived from `deriveBenchWorkState` — the SAME rule the work list colours a
 * row with, so the two can never disagree. `null` means the parcel may be
 * packed; it says nothing about whether the goods are on the shelf.
 *
 * `'not-at-this-bench'` is deliberately absent: a work that is not this bench's
 * at all answers **404**, because a packer has no business reading another
 * executor's parcel contents in order to be told they may not pack them.
 */
export const BenchParcelRefusalValues = ['held', 'cancelled'] as const;
export type BenchParcelRefusal = (typeof BenchParcelRefusalValues)[number];

/** One line of the box, and how much of it is verified in. */
export interface BenchParcelLineView {
  readonly workLineId: string;
  readonly productVariantId: string;
  /**
   * What a packer reads on the shelf label — the PRODUCT's name.
   *
   * `null` where the variant or its product is not in OpenLinker's catalogue,
   * which is an honest answer rather than a placeholder: the surface shows the
   * codes instead, and a packer can still match the box.
   */
  readonly name: string | null;
  readonly sku: string | null;
  /** The two barcodes the catalogue holds. Either may be `null`. */
  readonly ean: string | null;
  readonly gtin: string | null;
  /**
   * Units this line still requires — `totalQuantity − cancelledQuantity`,
   * the one definition, shared with the work list's `unitsToVerify` and with the
   * close predicate.
   */
  readonly requiredQuantity: number;
  /** Units verified into the box. Never greater than `requiredQuantity`. */
  readonly verifiedQuantity: number;
}

/** One parcel at the bench. */
export interface BenchParcelView {
  readonly workId: string;
  /** The optimistic token. Required on a reopen; a stale one is refused. */
  readonly version: number;
  readonly orderReference: string;
  readonly buyerName: string | null;
  /**
   * Which parcel of the order this is, and how many there are (story D3).
   *
   * Always rendered, never suppressed for a single-parcel order: the surface
   * must be explicit about which box this is rather than letting a packer read
   * one parcel's contents as the whole order.
   */
  readonly parcelIndex: number;
  readonly parcelTotal: number;
  /** `null` when the parcel may be packed. See `BenchParcelRefusal`. */
  readonly refusal: BenchParcelRefusal | null;
  /** Why it is held, when it is held. `null` otherwise. */
  readonly holdReason: HoldReason | null;
  /** When the last verification shut the box (D18), or `null` while it is open. */
  readonly closedAt: string | null;
  /** The last verifier (D13). `null` while the box is open. */
  readonly packedByUserId: string | null;
  readonly lines: readonly BenchParcelLineView[];
}

/** What a verification answers — the outcome, and the parcel as it now stands. */
export interface BenchVerificationResultView {
  readonly outcome: 'verified' | 'deduplicated' | 'refused';
  /** `null` on anything but a refusal. */
  readonly reason: ParcelVerificationRefusal | null;
  /**
   * The whole parcel, re-projected.
   *
   * Returned on every outcome INCLUDING a refusal, so a surface that refused a
   * scan is still holding the truth rather than a stale view it must re-fetch —
   * and so a refusal can never leave the counters looking as though something
   * changed.
   */
  readonly parcel: BenchParcelView;
}

/** What a reopen answers. */
export interface BenchReopenResultView {
  readonly outcome: 'reopened' | 'refused';
  readonly reason: ParcelReopenRefusal | null;
  readonly parcel: BenchParcelView;
}

/**
 * The invoice, in the three states a packer can be in (story F2).
 *
 * `missing` never blocks packing (D17). A tax-rate gap is an office problem the
 * packer cannot fix; refusing to pack piles boxes at a bench while somebody
 * hunts for an admin, and the order still needs shipping.
 */
export type BenchInvoiceView =
  | {
      /** Issued AND the provider can produce something printable. */
      readonly state: 'ready';
      readonly invoiceId: string;
      readonly documentNumber: string | null;
      readonly issuedAt: string | null;
    }
  | {
      /**
       * Issued, but nothing this bench can put in a box.
       *
       * A real and separate state rather than a nicety: the machine-readable
       * source document is XML, and telling a packer "ready to print" and then
       * answering 409 when they press it is precisely the silent failure F2
       * exists to prevent.
       */
      readonly state: 'issued-not-printable';
      readonly invoiceId: string;
      readonly documentNumber: string | null;
      readonly issuedAt: string | null;
    }
  | {
      readonly state: 'missing';
      /**
       * #2100's existing vocabulary, reused rather than restated. `null` when
       * nothing recorded a reason — which is itself an answer the surface says
       * plainly instead of inventing one.
       */
      readonly blockReason: SalesDocumentGateBlockReason | null;
      readonly unresolvedReason: SalesDocumentUnresolvedReason | null;
    };

/** The label (stories F3, F4). */
export type BenchLabelView =
  | {
      readonly state: 'ready';
      readonly shipmentId: string;
      readonly carrier: string | null;
      readonly trackingNumber: string | null;
    }
  | {
      /** Packed and unlabelled — the state Surface F exists for. */
      readonly state: 'unavailable';
      readonly shipmentId: string;
      readonly carrier: string | null;
      /**
       * The carrier's own short discriminator. NOT redacted, because it is a
       * code rather than prose — the distinction `ShipmentResponseDto` already
       * draws.
       */
      readonly providerCode: string | null;
      /**
       * The carrier's own words, or `null` for a caller that may not see them.
       *
       * Gated on `shipments:write` exactly as `ShipmentResponseDto` gates it:
       * the raw rejection text may embed address fragments, and a `packer` holds
       * no permissions at all. A second, ungated path to a field the tree
       * redacts would undo that decision for the narrowest role in the system.
       */
      readonly carrierMessage: string | null;
      /**
       * Whether a reason exists that this caller may not see.
       *
       * Without it the surface cannot tell *"the carrier gave no reason"* from
       * *"the reason is hidden from your role"*, and a `packer` — who never sees
       * the prose — would be shown the first sentence whenever the second is
       * true. That is the surface stating something false, which costs more than
       * the one boolean it takes to avoid.
       */
      readonly carrierMessageRedacted: boolean;
      readonly failedAt: string | null;
    }
  | {
      /** No shipment for this parcel yet — the ordinary state before dispatch. */
      readonly state: 'none';
    };

/**
 * There is deliberately no `retryable` flag on the `unavailable` arm.
 *
 * The first draft carried one, and it could only ever be `false`: `ready` is
 * decided by a shipment HAVING a `providerShipmentId`, so the `unavailable` arm
 * is reached only when none does — and a "re-fetch the label" affordance needs
 * exactly the label that classification has already routed elsewhere. A control
 * the backend cannot serve is dead code that type-checks, which is the shape
 * this programme has removed twice.
 *
 * What remains is honest and covers the real cases: a label that exists is
 * `ready` and its Print control re-fetches every time it is pressed, so a
 * transient fetch failure is retried by pressing it again; and a label that was
 * never produced is `unavailable`, which the bench cannot fix, because buying one
 * needs a recipient and operator-typed parcel dimensions — precisely the data
 * this surface is shaped not to hold. Dispatch owns that, and the surface says
 * so.
 */

/** What goes INSIDE the box, and what goes ON it. */
export interface BenchDocumentsView {
  readonly workId: string;
  readonly invoice: BenchInvoiceView;
  readonly label: BenchLabelView;
}

/** One packed parcel with no label on it (story F4). */
export interface BenchUnlabelledParcelView {
  readonly workId: string;
  readonly orderReference: string;
  readonly parcelIndex: number;
  readonly parcelTotal: number;
  readonly closedAt: string | null;
  readonly carrier: string | null;
  readonly providerCode: string | null;
}

/** The whole answer to "which boxes are finished and cannot go out". */
export interface BenchUnlabelledParcelListView {
  readonly parcels: readonly BenchUnlabelledParcelView[];
  /**
   * How many unlabelled parcels this read FOUND — always `parcels.length`.
   *
   * Deliberately not "how many exist": the label test is applied above the
   * database, so a count taken from the query would include labelled boxes and
   * tell an operator there is work waiting that is not.
   */
  readonly total: number;
  /**
   * Whether the read hit its cap and there may be more.
   *
   * Reported rather than left implicit, the `BENCH_WORK_HARD_CAP` discipline the
   * work list already applies: at 1000 parcels a day a silently truncated list
   * is a box nobody looks for.
   */
  readonly truncated: boolean;
}
