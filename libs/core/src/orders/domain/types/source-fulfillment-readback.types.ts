/**
 * Source Fulfillment Readback Types
 *
 * The neutral shape of "what does the SOURCE marketplace itself say about this
 * order's fulfilment, right now" (#3365).
 *
 * OpenLinker writes a dispatch mark and, where it has one, a waybill back to
 * the marketplace through `OrderStatusWriteback` — a relay that ADR-027 makes
 * deliberately fire-and-forget, so nothing in the tree has ever been able to
 * confirm the write landed. Every existing "the marketplace was told" check is
 * an assertion about an OpenLinker row or about a mock, and the two specs that
 * come closest say so in their own headers. This is the shape that lets a
 * caller ask the marketplace instead.
 *
 * ## An absent answer is a STATE, never a silent null
 *
 * Three things a caller must be able to tell apart, because the operator's next
 * action differs for each:
 *
 *   - `unsupported` — this source has no readback at all. Nothing is wrong and
 *     nothing will ever be readable here.
 *   - `unavailable` — the source could not be reached or refused. Transient;
 *     worth retrying, and worth alerting on if it persists.
 *   - `read` — the marketplace answered. `rawStatus` is what it said, verbatim.
 *
 * Collapsing those into one nullable status is how "we did not ask" becomes
 * indistinguishable from "it is not sent", which is precisely the confusion the
 * readback exists to remove.
 *
 * ## `rawStatus` is the marketplace's own word and is never interpreted here
 *
 * The neutral `dispatched` flag is a derived convenience and is `null` whenever
 * the adapter cannot map the raw value — an unrecognised status must read as
 * "we do not know", never as "not dispatched", or an operator would be told a
 * parcel is unsent on the strength of a vocabulary OpenLinker has not learnt.
 *
 * ## Waybills are OPTIONAL and their absence asserts nothing
 *
 * `waybills: null` means this source does not report attached waybills back —
 * NOT that none is attached, and NOT that a read failed to find any. An empty
 * array is the different, stronger claim that the source answered and listed
 * none. A caller that collapses the two will eventually tell an operator no
 * tracking number was attached on the strength of a call that never succeeded.
 *
 * Allegro reports them (verified live on the sandbox, 2026-09-27: two orders
 * OpenLinker had dispatched itself read back with both waybills under
 * `carrierId: "INPOST"`), and does so from a SEPARATE resource, so reading
 * them costs a second request. That call is best-effort by contract: an
 * adapter whose status read succeeded and whose waybill read did not must
 * report the status with `waybills: null` rather than failing the whole
 * answer.
 *
 * @module libs/core/src/orders/domain/types
 */

/** Why a readback carries no marketplace answer, or that it does. */
export const SourceFulfillmentReadbackOutcomeValues = ['read', 'unsupported', 'unavailable'] as const;

export type SourceFulfillmentReadbackOutcome =
  (typeof SourceFulfillmentReadbackOutcomeValues)[number];

/** A waybill the source reports as attached to the order. */
export interface SourceFulfillmentWaybill {
  /** The tracking number as the marketplace reports it. */
  readonly waybill: string;
  /** The marketplace's own carrier identifier, verbatim. */
  readonly carrierId?: string;
  /** A free-text carrier name where the marketplace carries one. */
  readonly carrierName?: string;
}

/** What the source marketplace says about an order's fulfilment. */
export interface SourceFulfillmentReadback {
  readonly outcome: SourceFulfillmentReadbackOutcome;
  /**
   * The marketplace's own fulfilment status string, verbatim and un-normalised
   * (Allegro: `SENT`, `NEW`, `CANCELLED`, …). `null` on any outcome other than
   * `read`, and also when the source answered without naming a status.
   */
  readonly rawStatus: string | null;
  /**
   * `true` / `false` only where the adapter recognised `rawStatus`; `null`
   * whenever it did not, which a caller must read as "unknown" and never as
   * "not dispatched".
   */
  readonly dispatched: boolean | null;
  /**
   * Waybills the source reports. `null` means this source does not report them
   * — a stronger and different statement from `[]`, which means it answered and
   * listed none.
   */
  readonly waybills: readonly SourceFulfillmentWaybill[] | null;
  /**
   * Why the answer is absent, for `unsupported` / `unavailable`. Operator-facing
   * and safe to log: it never carries a credential or a buyer detail.
   */
  readonly detail?: string;
}

/** An adapter that declares no readback at all. */
export function unsupportedSourceFulfillmentReadback(detail: string): SourceFulfillmentReadback {
  return { outcome: 'unsupported', rawStatus: null, dispatched: null, waybills: null, detail };
}

/** The source could not be reached, or refused. Transient by nature. */
export function unavailableSourceFulfillmentReadback(detail: string): SourceFulfillmentReadback {
  return { outcome: 'unavailable', rawStatus: null, dispatched: null, waybills: null, detail };
}
