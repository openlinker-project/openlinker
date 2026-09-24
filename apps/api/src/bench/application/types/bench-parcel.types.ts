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
 * this projection changes.
 *
 * `buyerName` is the one buyer-PII field, and it is #2416's already-decided
 * disclosure: it is the name about to go on the label the same session is
 * allowed to print. There is still no address, no email and no phone —
 * #2413's PII-minimization reasoning stands for those three.
 *
 * ## `totalAmount`/`currency`/`carrierName`/`dispatchByAt` (#3409, epic #3401)
 *
 * #2413's original docblock cited "no total, no price" as proof for D4's
 * guarantee. That exclusion is REVERSED here, by explicit product decision:
 * the mockup's order-head shows the total, carrier and ship-by deadline as
 * fielded values, and the epic's own audit concluded these are real
 * operator requirements rather than PII to withhold. D4's guarantee is
 * unaffected — it was never about these four fields specifically, it is
 * about the projection being an allowlist AT ALL, so a field this list does
 * not name still cannot silently start leaking (an address edit, for
 * instance, still cannot fire an interruption — it still is not
 * expressible). `totalAmount`/`currency` come straight off `OrderRecord`'s
 * own indexed columns (#1985's read model), never the jsonb snapshot;
 * `carrierName` reads `OrderRecord.sourceDeliveryMethodName` (#1792, already
 * a typed getter — source-dependent and `null` when the source reports
 * none); `dispatchByAt` mirrors the identical field already on
 * `BenchWorkView`.
 *
 * @module apps/api/src/bench/application/types
 */
import {
  FulfillmentCompletionRefusalValues,
  FulfillmentCompletionUndoRefusalValues,
  type ParcelReopenRefusal,
  type ParcelUndoRefusal,
  ParcelVerificationRefusalValues,
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
  /**
   * The parent PRODUCT's first image (#3410, epic #3401). `ProductVariant`
   * carries no image field of its own — a simple product's variant renders
   * its parent's picture, and no per-variant image is invented for a
   * multi-variant one either. `null` when the product has none, or is not
   * in the catalogue.
   */
  readonly imageUrl: string | null;
  /**
   * The variant's own distinguishing attributes (colour, size, …), verbatim
   * from `ProductVariant.attributes` (#3410). `null` for a simple product's
   * synthetic variant, which carries none.
   */
  readonly attributes: Record<string, string> | null;
  /**
   * Operator-authored bin/shelf code (#3402/#3410) — first non-null across
   * the variant's live inventory positions. `null` when nothing was ever
   * recorded, never a placeholder.
   */
  readonly binCode: string | null;
  /**
   * Physical master data (#3403/#3410) — display-only, never captured here.
   * `null` on any field means "not recorded", not zero.
   */
  readonly weightGrams: number | null;
  readonly lengthMm: number | null;
  readonly widthMm: number | null;
  readonly heightMm: number | null;
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
  /**
   * The order's total, as `OrderRecord.totalAmount` holds it — the source's
   * OWN currency, never the reporting-currency stamp (#2124, ADR-040), which
   * would answer a different question ("how much in the deployment's
   * reporting currency") than the one the mockup's order-head asks ("what
   * did this buyer pay"). `null` mirrors the column: not yet known, or the
   * order predates the field.
   */
  readonly totalAmount: number | null;
  readonly currency: string | null;
  /**
   * The source's own delivery-method label (#1792), `null` when the source
   * reports none. Not every source reports a carrier name.
   */
  readonly carrierName: string | null;
  /** The order's dispatch deadline, mirroring the same field on `BenchWorkView`. */
  readonly dispatchByAt: string | null;
  /** `null` when the parcel may be packed. See `BenchParcelRefusal`. */
  readonly refusal: BenchParcelRefusal | null;
  /** Why it is held, when it is held. `null` otherwise. */
  readonly holdReason: HoldReason | null;
  /** When the last verification shut the box (D18), or `null` while it is open. */
  readonly closedAt: string | null;
  /** The last verifier (D13). `null` while the box is open. */
  readonly packedByUserId: string | null;
  /**
   * When this parcel's invoice was FIRST printed (pack-bench completion), or `null` if never.
   * A reprint never moves it — see `FulfillmentWorkView.invoicePrintedAt`.
   */
  readonly invoicePrintedAt: string | null;
  /**
   * Who this parcel is assigned to, or `null` for the unassigned pool (#3415).
   *
   * A RAW user id, matching `packedByUserId` and `completedByUserId` on this
   * same view - masking is `bench-presence`'s own concern, and that is about
   * live viewers rather than about attribution. Carried so a packer who loses
   * a claim race can be shown who actually holds it now, rather than a
   * refusal that names nobody.
   */
  readonly assignedToUserId: string | null;

  /** The label sibling of `invoicePrintedAt` (pack-bench completion). Same reading. */
  readonly labelPrintedAt: string | null;
  /**
   * When an operator declared this parcel finished and off the bench
   * (pack-bench completion), or `null` until that act — a distinct, later completion instant
   * from `closedAt`. See `POST :workId/completion`.
   */
  readonly completedAt: string | null;
  readonly lines: readonly BenchParcelLineView[];
}

/**
 * Why a SCAN was refused (#3415).
 *
 * A WIDER union than core's own `ParcelVerificationRefusalValues`, the same
 * shape and for the same reason as `BenchCompletionRefusalValues` below:
 * `'not-claimable-by-viewer'` is the ADR-074 pre-assignment lock, which
 * depends on WHO is scanning, and core's verification service never learns a
 * viewer id.
 *
 * It exists because the lock used to be reported as `'not-packable'`, the
 * reason a HELD or CANCELLED parcel gets - so a packer whose supervisor locked
 * the box mid-pack was told *"this box must not be packed - take it back to
 * the trolley"*. That box is perfectly fine; it simply is not theirs any more,
 * and sending a good parcel back to the trolley is an operational error rather
 * than a wording one.
 */
export const BenchVerificationRefusalValues = [
  ...ParcelVerificationRefusalValues,
  'not-claimable-by-viewer',
] as const;

export type BenchVerificationRefusal = (typeof BenchVerificationRefusalValues)[number];

/** What a verification answers — the outcome, and the parcel as it now stands. */
export interface BenchVerificationResultView {
  readonly outcome: 'verified' | 'deduplicated' | 'refused';
  /** `null` on anything but a refusal. */
  readonly reason: BenchVerificationRefusal | null;
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
 * What an undo-last-scan answers (#3405).
 *
 * `workLineId` is `null` except on `outcome: 'voided'` — carried so the FE can
 * highlight which line's count just went down without re-diffing the whole
 * projected parcel against its previous view.
 */
export interface BenchUndoResultView {
  readonly outcome: 'voided' | 'refused';
  readonly reason: ParcelUndoRefusal | null;
  readonly workLineId: string | null;
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

/**
 * One entry of a parcel's recent-activity log (#3411, epic #3401) — the
 * verification ledger, projected with the line's product name so the
 * surface can render e.g. "Linen tea towel — verified, 2 of 2" the way the
 * mockup does, rather than a bare id.
 */
export interface BenchActivityEntryView {
  readonly workLineId: string;
  /** `null` when the line's variant is not in the catalogue — matches `BenchParcelLineView.name`. */
  readonly name: string | null;
  /** `'verified'` while active, `'undone'` once voided — see `ParcelVerificationEvent.voidedAt`. */
  readonly kind: 'verified' | 'undone';
  /** The instant of the event THIS ENTRY reports — `voidedAt` for `'undone'`, `verifiedAt` otherwise. */
  readonly at: string;
  readonly byUserId: string | null;
}

/**
 * Why a self-claim was refused (#3412, epic #3401).
 *
 * ## `'not-claimable'` and `'not-claimable-by-viewer'` name ONE state on
 * purpose, and this is the one place that says why (#3438 review)
 *
 * Both come from `isClaimableByViewer` — the ADR-074 lock. `claimParcel`
 * refuses with the first; `verifyUnit`, `reopenParcel` and `undoLastScan`
 * refuse with the second. Two names for one condition is normally a smell, so
 * the argument has to be somewhere, and this is it rather than a sentence on
 * each.
 *
 * They are kept apart because the ACT differs and the packer's next step
 * differs with it:
 *
 *   - refusing a CLAIM means *you cannot take this one* — the remedy is to
 *     take a different parcel, and the copy says so
 *     (`benchWorkCopy.tabs.takeNextLocked`: "That one is already assigned to
 *     someone. Try a different one.");
 *   - refusing an ACT on a parcel already open means *this box is not yours
 *     to work* — the remedy is to put it down, and the copy says that instead
 *     (`benchParcelCopy…notYours` / `…refusedLocked`).
 *
 * Collapsing them would make one of those two sentences wrong for the
 * situation it appeared in, and "try a different one" told to a packer
 * standing over an open box is the worse direction of the two.
 *
 * `bench-parcel-presentation.test.ts` asserts the two sentences stay
 * DISTINGUISHABLE, so a later tidy that routes both to one string fails
 * rather than quietly undoing this.
 */
export const BenchClaimRefusalValues = [
  'held',
  'cancelled',
  'not-claimable',
  /**
   * A peer claimed this parcel between the read that offered it and the write
   * (#3415). NOT `'not-claimable'`: that is the ADR-074 lock, a standing fact
   * about who this parcel is for, whereas this one is a race a packer can
   * simply lose and retry past. Telling them "this is not yours" about a
   * parcel that was theirs to take a moment ago sends them to a supervisor
   * for nothing.
   */
  'claimed-by-someone-else',
] as const;
export type BenchClaimRefusal = (typeof BenchClaimRefusalValues)[number];

/** What claiming ONE chosen parcel answers (#3412). */
export interface BenchClaimResultView {
  readonly outcome: 'claimed' | 'refused';
  readonly reason: BenchClaimRefusal | null;
  readonly parcel: BenchParcelView;
}

/**
 * Why a completion was refused (pack-bench completion).
 *
 * A WIDER union than core's own `FulfillmentCompletionRefusalValues`, the
 * `BenchClaimRefusalValues` shape: `'not-claimable-by-viewer'` is the ADR-074
 * pre-assignment lock, checked here rather than in core because it depends
 * on WHO is asking — core's verification service never learns a viewer id.
 */
export const BenchCompletionRefusalValues = [
  ...FulfillmentCompletionRefusalValues,
  'not-claimable-by-viewer',
] as const;

export type BenchCompletionRefusal = (typeof BenchCompletionRefusalValues)[number];

/** What declaring a parcel completed answers (pack-bench completion). */
export interface BenchCompleteResultView {
  readonly outcome: 'completed' | 'refused';
  readonly reason: BenchCompletionRefusal | null;
  readonly parcel: BenchParcelView;
}

/**
 * Why taking back a completion was refused (#3415).
 *
 * A WIDER union than core's own `FulfillmentCompletionUndoRefusalValues`, the
 * same shape and the same reason as its two siblings above:
 * `'not-claimable-by-viewer'` is the ADR-074 lock, which depends on WHO is
 * asking, and core never learns a viewer id.
 */
export const BenchUndoCompletionRefusalValues = [
  ...FulfillmentCompletionUndoRefusalValues,
  'not-claimable-by-viewer',
] as const;

export type BenchUndoCompletionRefusal = (typeof BenchUndoCompletionRefusalValues)[number];

/**
 * What taking back a completion answers.
 *
 * `'undone'`, never `'reopened'`: the box stays packed and every scan stands.
 * Naming it after the reopen would invite a surface to render the two
 * together, and they leave the parcel in different states.
 */
export interface BenchUndoCompletionResultView {
  readonly outcome: 'undone' | 'refused';
  readonly reason: BenchUndoCompletionRefusal | null;
  readonly parcel: BenchParcelView;
}

/**
 * What "take next task" answers (#3412) — the server picks the top eligible
 * row from the ALREADY-sorted, already-eligibility-filtered worklist and
 * claims it. `'nothing-to-claim'` is a real, ordinary outcome (queue empty),
 * never an error — the worklist can legitimately have nothing this viewer
 * may take.
 *
 * `'refused'` is the THIRD outcome and is not the same fact. It means a
 * candidate WAS picked and the write then said no — almost always because
 * another packer claimed it in the moment between the read and the write. That
 * used to collapse into `'nothing-to-claim'`, which told a packer their queue
 * was empty while the rail in front of them was visibly full: the one reading
 * that makes the button look broken. It carries the reason rather than a flag,
 * so a surface can say which refusal it was without re-deriving it — and so a
 * reason added to `BenchClaimRefusalValues` later reaches this path for free.
 */
export type BenchClaimNextResultView =
  | { readonly outcome: 'claimed'; readonly parcel: BenchParcelView }
  | { readonly outcome: 'nothing-to-claim' }
  | { readonly outcome: 'refused'; readonly reason: BenchClaimRefusal };

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
