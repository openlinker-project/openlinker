/**
 * Pack-bench work-list view types (#2416, `W3b-3`, spec § 2.2)
 *
 * What the bench is handed for one packable parcel, and the two facts the
 * surface needs about the list as a whole.
 *
 * ## An explicit ALLOWLIST, and one of its fields is buyer PII
 *
 * The same discipline `FulfillmentWorkView` states: field-by-field, never a
 * spread, because this reaches a browser on a warehouse floor. `buyerName` is a
 * deliberate disclosure — it is on the label about to be stuck on the box, and
 * it is how a packer tells two parcels apart — and it is the ONLY thing taken
 * from the order snapshot besides the reference and the deadline. No address,
 * no email, no phone, no totals, no line prices.
 *
 * That is consistent with #2413 rather than a loosening of it: the bench's
 * LOCKED screen withholds every one of these, because a shared floor terminal is
 * routinely unattended. A signed-in packer is a different question from an
 * unattended screen.
 *
 * ## Nothing here may state or imply readiness (story B2)
 *
 * There is no `picked`, no `gathered`, no `ready`. `unitsToVerify` is what a
 * packer must confirm against the box; it is deliberately NOT derived from
 * `fulfilledQuantity`, because OpenLinker cannot see a shelf and a number that
 * implies otherwise sends someone to fetch something that is not there.
 *
 * @module apps/api/src/bench/application/types
 */
import type { FulfillmentWorkAction } from '@openlinker/core/fulfillment';
import type { HoldReason } from '@openlinker/core/order-lifecycle';

/**
 * How a row must be treated, as a VALUE rather than as a colour.
 *
 * Story B4: state is carried by colour *and* position or text, never colour
 * alone. A consumer renders this as words and as its own section; the colour is
 * an addition to that, never the carrier.
 *
 * `packable` says nothing about whether the goods are on the shelf — see the
 * module note above. It means only that nothing known to OpenLinker forbids
 * packing it.
 */
export const BenchWorkStateValues = ['packable', 'held', 'cancelled'] as const;
export type BenchWorkState = (typeof BenchWorkStateValues)[number];

/** One parcel on the bench's list. */
export interface BenchWorkView {
  readonly workId: string;
  /** The optimistic token. Required on any action; a stale one answers 409. */
  readonly version: number;
  readonly orderId: string;
  /**
   * What a human calls this order — the source's own reference where it has
   * one, and the internal id otherwise.
   *
   * Never null: it is what the search field matches and what a packer reads
   * back to a colleague, so an absent source reference degrades to the id
   * rather than to a blank.
   */
  readonly orderReference: string;
  /**
   * The buyer's name as the source reported it, or `null`.
   *
   * `null` is a real and ordinary answer, not a failure: under `OL_STORE_PII=false`
   * the persisted snapshot's address is redacted, so there is no name to report.
   * A consumer renders nothing, never a placeholder that reads like a name.
   */
  readonly buyerName: string | null;
  /** The marketplace's dispatch deadline, or `null` when the source names none. */
  readonly dispatchByAt: string | null;
  /** Which parcel of the order this is, 1-based, and how many there are in all. */
  readonly parcelIndex: number;
  /** See `parcelIndex`. Counts EVERY parcel of the order, not only packable ones. */
  readonly parcelTotal: number;
  readonly lineCount: number;
  /** Units a packer must confirm against the box. Never a readiness claim. */
  readonly unitsToVerify: number;
  readonly state: BenchWorkState;
  /** Why the parcel is held, when it is. `null` on every other state. */
  readonly holdReason: HoldReason | null;
  readonly holdPlacedAt: string | null;
  /** When somebody pushed this ahead of deadline order (D22), or `null`. */
  readonly expeditedAt: string | null;
  /**
   * What is legal on this parcel right now, decided SERVER-side.
   *
   * Carried so the expedite control's direction is never a client-side
   * derivation. A cancelled parcel carries `[]` — it is terminal, so no action
   * applies to it at all, including no expedite.
   */
  readonly supportedActions: readonly FulfillmentWorkAction[];
}

/**
 * Whether packing work can reach this bench at all.
 *
 * The two empty states are DIFFERENT FACTS and story B3 exists because
 * conflating them is what makes a bench look broken: "nothing to pack right
 * now" is a healthy install with an empty queue, and "nothing is set up to send
 * work here" will stay empty however long the screen is open.
 *
 * A discriminated block rather than a bare boolean, so the reason travels with
 * the answer and a surface cannot render the wrong sentence by reading a `false`
 * it has no explanation for.
 */
export type BenchRoutingReadiness =
  | { readonly ready: true }
  | {
      /**
       * No active connection is set to carry out packing in OpenLinker, so
       * routing has nowhere to send a parcel here. The remedy is an assignment,
       * not an inventory location — see `BenchWorkService`.
       */
      readonly ready: false;
      readonly reason: 'no-packing-connection';
    };

/** The whole answer to "what is at this bench". */
export interface BenchWorkListView {
  readonly works: readonly BenchWorkView[];
  /**
   * The name of the connection whose work this is.
   *
   * The bench is the human interface of ONE executor (spec § 1.2), and this is
   * how the surface says whose work it is showing. `null` when nothing is set
   * up, which is exactly when `routing.ready` is false.
   *
   * Deliberately NOT a warehouse or location name: nothing in the product tells
   * a bench which location it stands in, so naming one would be a claim
   * OpenLinker cannot support. See `BenchWorkService`.
   */
  readonly executorName: string | null;
  readonly routing: BenchRoutingReadiness;
  /**
   * How many parcels match, which may exceed `works.length`.
   *
   * Reported so the surface can say plainly that it is showing part of the
   * work rather than quietly truncating. See `BENCH_WORK_HARD_CAP`.
   */
  readonly total: number;
}
