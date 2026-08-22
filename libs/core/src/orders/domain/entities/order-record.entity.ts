/**
 * Order Record Domain Entity
 *
 * Represents a persisted order record in OpenLinker. Stores minimal order data
 * (OrderRecord + SyncState) for retry/debug support without re-polling source systems.
 * Order snapshot is PII-aware (respects OL_STORE_PII configuration).
 *
 * @module domain/entities
 */
import type { OrderRecordStatus } from '../types/order-record.types';
import type { OrderSyncStatus, SyncAttempt } from '../types/order-sync.types';
import { PaymentStatusValues } from '../types/payment-status.types';
import type { PaymentStatus } from '../types/payment-status.types';
import type { CodToCollect } from '../types/cod-to-collect.types';
import type { FulfillmentRollupState } from '../types/order-fulfillment.types';
import type { OrderDispatchWindow } from '../types/order.types';
import type { OrderAmendmentChange } from '../order-amendment-diff';
import type {
  SalesDocumentGateBlockReason,
  SalesDocumentUnresolvedReason,
} from '@openlinker/core/sales-documents';

export type { OrderSyncStatus, SyncAttempt } from '../types/order-sync.types';

/**
 * Order Record Domain Entity
 *
 * Stores minimal order data for retry/debug support. Order snapshot contains
 * the full order data (PII-aware), and syncStatus tracks sync state per destination.
 *
 * recordStatus='awaiting_mapping': snapshot holds raw IncomingOrder (external refs, no internal IDs).
 * recordStatus='ready': snapshot holds resolved Order (internal product/variant IDs).
 *
 * `syncAttempts` is the per-destination append-only history; the constructor
 * defaults it to `[]` so existing call sites that pre-date the column compile
 * unchanged (the field is hydrated from the JSONB column by the repository).
 *
 * Neither `syncStatus` nor `syncAttempts` is ever sourced from an ingestion
 * payload: no order source reports OL's own destination sync state, and
 * `updateSyncStatus` is their sole writer, so the ingestion path passes `[]`
 * and the upsert excludes both columns entirely (#2140). A record handed back
 * by that upsert therefore reports both empty whatever the row holds.
 */
export class OrderRecord {
  constructor(
    public readonly internalOrderId: string,
    public readonly customerId: string | null,
    public readonly sourceConnectionId: string,
    public readonly sourceEventId: string | null,
    public readonly orderSnapshot: Record<string, unknown>,
    public readonly syncStatus: OrderSyncStatus[],
    public readonly recordStatus: OrderRecordStatus,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly syncAttempts: SyncAttempt[] = [],
    /**
     * Derived marketplace dispatch (ship-by) deadline (#927) — the `.to` of the
     * source dispatch window, denormalized to a top-level column so the orders
     * list can sort/filter on the SLA without parsing the snapshot. `null` when
     * the source exposes no dispatch SLA. Re-derived on every persist so a
     * re-pulled order with a changed window stays fresh.
     */
    public readonly dispatchByAt: Date | null = null,
    /**
     * Per-order fulfillment rollup (#1108) — a denormalized projection of the
     * order's shipment lifecycle, pushed from the shipping context via
     * `updateFulfillmentState`. `null` ≡ `not-shipped` (no backfill needed).
     * Lets the orders list show/filter "has this shipped?" without reaching
     * into the shipping context.
     *
     * Never sourced from an ingestion payload: no order source reports a
     * fulfillment state, and `updateFulfillmentState` is the column's sole
     * writer, so the ingestion path leaves this field at its `null` default
     * and the upsert excludes the column entirely (#2101).
     */
    public readonly fulfillmentState: FulfillmentRollupState | null = null,
    /**
     * Operator-facing reason the item resolution failed at ingestion (#1689),
     * set alongside `recordStatus = 'awaiting_mapping' | 'source_deleted'`.
     * `null` for a `'ready'` record, or a historical row predating the column.
     */
    public readonly mappingFailureReason: string | null = null,
    /**
     * Instant the source reported this order cancelled (#1984). `null` = never
     * cancelled (or a historical row the backfill migration could not derive a
     * proxy timestamp for). Independent of `recordStatus` — an order can be
     * `ready` (all items resolved) and cancelled at the same time. Set once
     * and never cleared: `markCancelled` is the sole writer of this column
     * and applies a first-write-wins (`COALESCE`) update, so the
     * first-observed instant survives every later re-persist.
     */
    public readonly cancelledAt: Date | null = null,
    /**
     * Why OpenLinker issued no fiscal document for this order (#2100, ADR-041
     * decision 11), or `null` when nothing is blocking it — including the
     * ordinary cases of "already invoiced", "no invoicing connection", and
     * "waiting for its trigger condition". Independent of `recordStatus`: an
     * order can be `ready` and fully `synced` while still carrying a block.
     *
     * Level-triggered: `AutoIssueTriggerService` re-decides it on EVERY order
     * transition and `updateSalesDocumentBlock` writes the answer through,
     * `null` included — so a reason never outlives the misconfiguration that
     * caused it. Deliberately NOT round-tripped through the repository's
     * `toOrm`, for the same reason as `cancelledAt`: that writer is the single
     * owner of all three `salesDocument*` columns.
     */
    public readonly salesDocumentBlockReason: SalesDocumentGateBlockReason | null = null,
    /**
     * The routing reason that travelled alongside a `'unresolved-routing'` block
     * (ADR-041 §107) — today always `'ambiguous-connection-no-primary'`. `null`
     * for every other block reason and for an unblocked order. This is the value
     * the operator-facing copy keys on, because "routing was unresolved" is not
     * actionable while "no primary invoicing connection" is.
     */
    public readonly salesDocumentUnresolvedReason: SalesDocumentUnresolvedReason | null = null,
    /**
     * PII-FREE elaboration of `salesDocumentBlockReason` (ids and counts only,
     * e.g. "3 invoicing connections, none marked primary"), rendered verbatim to
     * the operator. `null` when the reason needs no elaboration.
     */
    public readonly salesDocumentBlockDetail: string | null = null,
    /**
     * Reporting currency the order's total was stamped into (#2124, ADR-040).
     * `null` ≡ NOT stamped — the canonical test, since `exchangeRateId` is
     * legitimately `null` on the same-currency path. Written only by
     * `stampFxIfAbsent`; the ingestion upsert omits the column.
     */
    public readonly reportingCurrency: string | null = null,
    /**
     * The order total expressed in `reportingCurrency`, rounded to 2dp.
     * `null` whenever `reportingCurrency` is (the group CHECK guarantees the
     * pair moves together).
     */
    public readonly reportingTotalAmount: number | null = null,
    /**
     * `exchange_rates.id` the conversion used; `null` when the order's own
     * currency already equalled the reporting currency, so no rate was needed.
     */
    public readonly exchangeRateId: string | null = null,
    /**
     * Which published day's rate the stamp was taken against (an `FxRateRule`
     * value). A bare `string` rather than the union: this is read back out of
     * the database, and a value written by a newer deployment must surface
     * as-is rather than be coerced or dropped. Set by the intent claim too, so
     * a non-null `fxRule` does NOT imply the order is stamped.
     */
    public readonly fxRule: string | null = null,
    /**
     * Instant the stamp attempt reached a terminal answer. `null` while an
     * attempt is still deferred to the retry job.
     */
    public readonly fxStampedAt: Date | null = null,
    /**
     * The reporting currency pinned at the FIRST stamp attempt, before any rate
     * lookup — so a retry or the sweep stamps against the same currency the
     * inline attempt resolved even if the system setting changed in between.
     */
    public readonly fxIntendedCurrency: string | null = null,
    /**
     * Instant an operator marked this order packed (#2287). A plain operator
     * FACT, not a state: it is deliberately independent of `recordStatus`,
     * `fulfillmentState`, `slaState` and `OrderHealth`, and carries no pack
     * policy (no scan verification, no dispatch gating) per ADR-045. It is
     * therefore meaningful for 100% of orders, including `omp_fulfilled` ones
     * OpenLinker never dispatches. `null` = not packed.
     *
     * Single-writer, like `cancelledAt` and the FX columns: only the guarded
     * `markPacked` / `clearPacked` statements write it, and the ingestion
     * upsert excludes it entirely, so a re-poll can never reset it.
     */
    public readonly packedAt: Date | null = null,
    /**
     * The OL user id of whoever marked this order packed (#2287). Moves as one
     * group with `packedAt` — a repeat mark is a no-op replay, so the FIRST
     * actor is preserved. No FK to `users`: a deleted user leaving a dangling
     * id the UI renders raw is the honest outcome for an audit fact.
     */
    public readonly packedByUserId: string | null = null,
    /**
     * Instant OpenLinker last observed the SOURCE amend this order after it was
     * already ingested (#2283) — a line removed, added or re-quantified, or the
     * shipping address edited. `null` = never observed amended.
     *
     * An internal FACT, not a lifecycle state: it appears in no status union, no
     * relay event and no health bucket, and nothing is gated on it. It exists
     * because ingestion overwrites `orderSnapshot` wholesale, so before this the
     * amendment left no trace whatsoever.
     *
     * Single-writer, like `cancelledAt` / `packedAt` / the FX columns: only the
     * narrow `recordAmendment` statement writes it, and the ingestion upsert
     * excludes it, so the re-poll that DETECTS the amendment cannot also erase it.
     */
    public readonly lastAmendedAt: Date | null = null,
    /**
     * What changed at that instant (#2283) — the most recent observation only,
     * not a history. Moves as one group with `lastAmendedAt`.
     *
     * PII-free by construction: line ids, SKUs and quantities verbatim, and for
     * an address change only the NAMES of the fields that moved. It is persisted
     * and rendered to operators, so carrying address values would put buyer PII
     * into a second store with none of the `OL_STORE_PII` discipline the snapshot
     * itself has.
     */
    public readonly lastAmendmentChanges: OrderAmendmentChange[] | null = null
  ) {}

  /**
   * Typed, fail-safe read of the order's neutral payment status (#928) from the
   * snapshot. Pure derivation of an already-loaded field (ADR-011): no I/O, no
   * mutation. Centralises the `orderSnapshot.paymentStatus` key + narrowing in
   * the owning context so cross-context consumers (e.g. the #938 shipping
   * dispatch gate) bind to a typed contract rather than the snapshot's internal
   * JSON layout. Returns `undefined` when the source didn't populate payment
   * (graceful degradation — PrestaShop / legacy orders) or the stored value
   * isn't a recognised status.
   */
  get paymentStatus(): PaymentStatus | undefined {
    const value = this.orderSnapshot.paymentStatus;
    return typeof value === 'string' && (PaymentStatusValues as readonly string[]).includes(value)
      ? (value as PaymentStatus)
      : undefined;
  }

  /**
   * Typed, fail-safe read of the marketplace-sourced COD collect amount (#1435)
   * from the snapshot. Pure derivation of an already-loaded field (ADR-011): no
   * I/O, no mutation. Mirrors the {@link paymentStatus} getter — centralises the
   * `orderSnapshot.codToCollect` key + narrowing so the shipping dispatch gate
   * binds to a typed contract, not the JSON layout. Returns `undefined` when the
   * source didn't supply it (prepaid orders, legacy/non-Allegro COD) or the
   * stored value isn't a well-formed `{ amount, currency }` pair.
   */
  get codToCollect(): CodToCollect | undefined {
    const value = this.orderSnapshot.codToCollect;
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const { amount, currency } = value as Record<string, unknown>;
    return typeof amount === 'string' && typeof currency === 'string'
      ? { amount, currency }
      : undefined;
  }

  /**
   * Typed, fail-safe read of the source-side delivery method id (#1791) from
   * the snapshot. Pure derivation of an already-loaded field (ADR-011): no
   * I/O, no mutation. Mirrors {@link paymentStatus} / {@link codToCollect} —
   * centralises the `orderSnapshot.shipping.methodId` key so cross-context
   * consumers (the delivery-routing-resolution projection) bind to a typed
   * contract, not the JSON layout. Same key the shipping dispatch seam
   * (`ShipmentDispatchInput.sourceDeliveryMethodId`) resolves against.
   * Returns `null` when the order carries no shipping method (the source
   * didn't expose one, or the snapshot predates the field).
   */
  get sourceDeliveryMethodId(): string | null {
    const shipping = this.orderSnapshot.shipping;
    if (typeof shipping !== 'object' || shipping === null) {
      return null;
    }
    const { methodId } = shipping as Record<string, unknown>;
    return typeof methodId === 'string' ? methodId : null;
  }

  /**
   * Typed, fail-safe read of the source-side delivery method's human label
   * (#1792) from the snapshot (`orderSnapshot.shipping.methodName`). Pure
   * derivation of an already-loaded field (ADR-011): no I/O, no mutation.
   * Mirrors {@link sourceDeliveryMethodId} — the delivery-rider heuristic keys
   * mainly on this label (a marketplace method id is typically opaque). Returns
   * `null` when the source exposed no label or the snapshot predates the field.
   */
  get sourceDeliveryMethodName(): string | null {
    const shipping = this.orderSnapshot.shipping;
    if (typeof shipping !== 'object' || shipping === null) {
      return null;
    }
    const { methodName } = shipping as Record<string, unknown>;
    return typeof methodName === 'string' ? methodName : null;
  }

  /**
   * Typed, fail-safe read of the ESTIMATED flag on the source dispatch window
   * (#1776) from the snapshot (`orderSnapshot.dispatchTime.estimated`). Pure
   * derivation of an already-loaded field (ADR-011): no I/O, no mutation.
   * Mirrors {@link paymentStatus} / {@link codToCollect} - centralises the
   * `orderSnapshot.dispatchTime` key + narrowing so the HTTP layer binds to a
   * typed boolean rather than casting the untrusted JSONB inline. `true` only
   * when the source marked the ship-by an OL-side estimate (Erli); `false` for
   * a malformed value, a missing window, or a marketplace-authoritative
   * deadline (Allegro).
   */
  get dispatchByEstimated(): boolean {
    const value = this.orderSnapshot.dispatchTime;
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    return (value as Partial<OrderDispatchWindow>).estimated === true;
  }

  /**
   * True once the source has reported this order cancelled (#1984). Pure
   * derivation of an already-loaded field (ADR-011): no I/O, no mutation.
   */
  get isCancelled(): boolean {
    return this.cancelledAt !== null;
  }

  /**
   * True once a reporting-currency figure has landed on this row (#2125). Pure
   * derivation of an already-loaded field (ADR-011).
   *
   * Reads `reportingCurrency`, NOT `exchangeRateId` (legitimately `null` on the
   * same-currency path) and NOT `fxStampedAt` (which a TERMINAL attempt also
   * writes, with no figure attached).
   */
  get isFxStamped(): boolean {
    return this.reportingCurrency !== null;
  }

  /**
   * Typed, fail-safe read of the order's own (native) currency and total from
   * the snapshot (#2125). Pure derivation of an already-loaded field (ADR-011):
   * no I/O, no mutation. Mirrors {@link codToCollect} - centralises the
   * `orderSnapshot.totals` keys so the FX stamp binds to a typed contract
   * rather than the snapshot's JSON layout.
   *
   * Deliberately NOT routed through `orderFromReadySnapshot`: that accessor
   * asserts `recordStatus === 'ready'` and throws when the buyer address is
   * PII-redacted, so a hash-only deployment (`OL_STORE_PII=false`) would lose
   * every FX stamp over a field the stamp does not read. `totals` is written by
   * BOTH persist paths and is never PII-gated.
   *
   * Returns `undefined` unless both halves are well-formed - a total with no
   * currency cannot be converted, and a currency with no total has nothing to
   * convert.
   */
  get nativeTotals(): { amount: number; currency: string } | undefined {
    const value = this.orderSnapshot.totals;
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const { total, currency } = value as Record<string, unknown>;
    return typeof total === 'number' && Number.isFinite(total) && typeof currency === 'string'
      ? { amount: total, currency }
      : undefined;
  }

  /**
   * Typed, fail-safe read of the buyer-placed-on-marketplace instant (#2125)
   * from the snapshot (`orderSnapshot.placedAt`, persisted as an ISO string).
   * Pure derivation of an already-loaded field (ADR-011).
   *
   * `undefined` for an absent OR unparseable value - the same no-fallback
   * semantics `orderFromReadySnapshot`'s `asOptionalDate` applies, so the two
   * rehydration paths cannot disagree about whether `placedAt` exists. There is
   * deliberately no fallback to `createdAt`: that is OpenLinker's ingestion
   * instant, not the sale date, and substituting it would stamp a rate against
   * a day the buyer never transacted on.
   */
  get placedAt(): Date | undefined {
    const value = this.orderSnapshot.placedAt;
    if (typeof value !== 'string' && !(value instanceof Date)) {
      return undefined;
    }
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
}
