/**
 * Fulfilment-task transport types (#2411, `W3a-21`)
 *
 * The frontend view of the #2406 worklist read model (`GET /fulfillment/works`,
 * `POST /fulfillment/works/:workId/actions/:action`).
 *
 * ## Three vocabularies are deliberately typed `string`, not mirrored unions
 *
 * `supportedActions`, `status` and `requestStatus` are closed unions in
 * `@openlinker/core/fulfillment`, and every other backend vocabulary this app
 * consumes IS mirrored here with an `as const` array plus a guard script. These
 * three are not, for two independent reasons that happen to agree:
 *
 *   1. DESIGN §5.2 — *"the server tells the client what is legal next, which
 *      kills client-side state-machine drift across heterogeneous executors."*
 *      A mirrored `status` union is the raw material for the drift; there is
 *      nothing this app may correctly decide from one.
 *   2. `scripts/check-no-supported-actions-mirror.mjs` FAILS THE BUILD on any
 *      `const|let|var|enum|type FulfillmentWorkAction(Values)?` declaration
 *      anywhere under `apps/web/src`. Its second matcher is not about spelling —
 *      it is the repo saying this vocabulary does not get a frontend copy.
 *
 * The cost is real and accepted: a typo in an action name is not a compile
 * error here. What buys it back is that no code branches on these values — they
 * are looked up in a loose copy table (`lib/fulfillment-task.copy.ts`) that
 * falls back to the raw string, so an unrecognised value degrades to *shown but
 * unlabelled* rather than to *silently dropped*.
 *
 * ## Timestamps are ISO STRINGS
 *
 * The DTOs declare `Date`, which is what Nest serialises FROM; what arrives is
 * a string. Every schema in this app types them `z.string()` for that reason —
 * a `Date`-typed field holding a string type-checks and then throws on
 * `.toLocaleString()`.
 *
 * @module apps/web/src/features/fulfillment/api
 */
import type { ShipmentStatus } from '../../shipments';

/** One line's quantity counters. Counters, never a per-line status. */
export interface FulfillmentTaskLine {
  id: string;
  orderLineId: string;
  productVariantId: string;
  /**
   * What the line's product card shows (#3426, #3096): the parent product's
   * name, the variant's codes, a picture and its attributes. Every one is
   * `null` when the catalogue does not have it and `undefined` against an API
   * that predates it — the card falls back to `productVariantId` either way.
   *
   * `imageUrl` is the API's own PROXY path (`/products/:id/images/:index`),
   * behind the route guard, so it is fetched with the bearer token
   * (`useAuthenticatedImage`) and never handed to a bare `<img src>`.
   */
  productName?: string | null;
  sku?: string | null;
  ean?: string | null;
  imageUrl?: string | null;
  attributes?: Record<string, string> | null;
  totalQuantity: number;
  /**
   * DISPLAY-ONLY, and not protected by the optimistic token: progress ingress
   * moves counters without bumping the header `version` (#2400), so this may be
   * behind reality. Nothing may gate an action on it.
   */
  fulfilledQuantity: number;
  /** Display-only; see `fulfilledQuantity`. */
  cancelledQuantity: number;
}

/**
 * An active hold on a fulfilment task.
 *
 * Carries no actor: #2406 withholds `placedByService` as an internal actor and
 * projects no `placedByUserId`, so this surface does not say who placed a hold.
 */
export interface FulfillmentTaskHold {
  id: string;
  /** A `HoldReason` — the same union `features/orders` already mirrors. */
  reason: string;
  note: string | null;
  /** ISO instant. */
  placedAt: string;
}

/** A fulfilment task as the operator surface sees it. */
export interface FulfillmentTask {
  id: string;
  orderId: string;
  locationId: string | null;
  deliveryMethod: string | null;
  /**
   * The order's own reference, and the facts an operator recognises it by
   * (#3401). A task carries only internal ids of its own, so without these
   * the assign board can render nothing but `ol_order_…`.
   *
   * `buyerName` is MASKED server-side ("A. Kowalska") — a deliberate,
   * bounded reversal of ADR-062's exclusion for THIS board only, because a
   * supervisor deciding who packs a box has to recognise the order.
   *
   * All four are `null` when the order or the location row is not there, and
   * `undefined` against an API that predates them.
   */
  orderReference?: string | null;
  /**
   * MASKED server-side ("A. Kowalska"). The field name carries that, so no
   * reader can mistake it for the buyer's own name. `null` under
   * `OL_STORE_PII=false`, where the persisted address is redacted and there
   * genuinely is no name - an ordinary answer, not a failure.
   */
  buyerNameMasked?: string | null;
  dispatchByAt?: string | null;
  carrierName?: string | null;
  /**
   * `null` FAR more often than it looks: `inventory_items.locationId IS NULL`
   * means the master declines to locate its stock (ADR-058 decision 2), and
   * neither shipped `InventoryMasterPort` adapter can report a location. So
   * expect no location at all unless the operator set a per-connection
   * `stockLocationOverride` (#3206).
   */
  locationName?: string | null;
  assignedConnectionId: string | null;
  /**
   * A supervisor's advisory pre-assignment to a specific PACKER (#3340,
   * ADR-074) — a distinct axis from `assignedConnectionId`, which is the
   * HOLDER connection (the executor). `null` = unassigned.
   */
  assignedToUserId: string | null;
  /**
   * When the task most recently BECAME unassigned (#3424). `null` on an
   * ASSIGNED row means "assigned right now" — render nothing. `null` on an
   * UNASSIGNED row means the row predates this column: an UNKNOWN age, not
   * a zero one — render nothing rather than "0m". Optional against an API
   * that predates it, the `orderReference` precedent above.
   */
  unassignedSince?: string | null;
  /**
   * Whether a packer other than `assignedToUserId` may still claim this
   * task. `true` is the advisory default; server-side enforcement of
   * `false` lives at the pack bench, not here.
   */
  selfServeEligible: boolean;
  /**
   * The orchestration status. **Not the authority on heldness** — nothing
   * writes `on_hold`, so a held task reads `open` with a non-empty
   * `activeHolds`. Read `activeHolds` for that.
   */
  status: string;
  requestStatus: string;
  assignmentAttempt: number;
  cancellationReason: string | null;
  externalWorkId: string | null;
  acceptedAt: string | null;
  cancelledAt: string | null;
  /**
   * When someone pushed this task ahead of ordinary deadline order (#2416),
   * `null` when nobody did. `null` means NOT expedited, never "unknown".
   * Optional against an API that predates it, the `orderReference` precedent
   * above — `.nullish()` in the schema normalises an absent value to `null`.
   *
   * DISPLAY ONLY (#3247). Which of `expedite` / `release_expedite` is
   * offered is read from `supportedActions` and from nothing else — a
   * control derived from this field would be offered on a task the server
   * would then refuse (the rule `features/bench` pinned first, in
   * `bench-work-presentation.ts`).
   */
  expeditedAt?: string | null;
  /**
   * What the pack bench has done to the box (#3096, G02-3). `parcelClosedAt`
   * is when the box was shut — NOT `status`, since packing is part of the
   * executor's job rather than the end of it — and `packedByUserId` who shut
   * it. `completedAt` is the separate "finished and off the bench" instant.
   * All optional against an API that predates them.
   */
  parcelClosedAt?: string | null;
  packedByUserId?: string | null;
  completedAt?: string | null;
  /**
   * When the dispatch fact was settled with the sales channel, or `null` while
   * it is not. RESOLVED, not acknowledged: a channel that takes no dispatch
   * notice is settled too, so copy must not promise the channel confirmed it.
   */
  channelNotifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lines: FulfillmentTaskLine[];
  /** THE authority on heldness. See `status`. */
  activeHolds: FulfillmentTaskHold[];
  /**
   * What is legal next, derived server-side and already filtered to the actions
   * this API will execute. Render controls from this array and nothing else.
   */
  supportedActions: string[];
  /** Optimistic token. Send back the one that was RENDERED, never a fresher one. */
  version: number;
}

export interface FulfillmentTaskPage {
  works: FulfillmentTask[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * One shipment dispatched for a fulfilment task (#3292).
 *
 * Outbound only — `GET /fulfillment/works/:workId/shipments` never surfaces a
 * `'return'`-direction row (#2373), so this shape carries no `direction`
 * field to read the wrong way.
 *
 * `status` reuses `ShipmentStatus` from `features/shipments` — a stable,
 * already-mirrored vocabulary with its own guard script and its own
 * `ShipmentStatusBadge`, unlike the fulfilment-task axes this file's own
 * docblock forbids mirroring. Reusing it is what lets this panel render
 * status with the shipments feature's existing badge rather than a second
 * copy of the same six colours.
 */
export interface FulfillmentTaskShipment {
  id: string;
  status: ShipmentStatus;
  carrier: string | null;
  trackingNumber: string | null;
  hasLabel: boolean;
  createdAt: string;
  dispatchedAt: string | null;
  deliveredAt: string | null;
}

/** Body of `POST /fulfillment/works/:workId/actions/:action`. */
export interface ApplyFulfillmentTaskActionRequest {
  expectedVersion: number;
  /** `hold` only. */
  holdReason?: string;
  /** `force_cancel` only; the server defaults it to `operator_forced`. */
  cancellationReason?: string;
  /** `release_hold` only. */
  holdId?: string;
  /** `hold` only — the note recorded ON the hold. */
  note?: string;
  /** `release_hold` only — the note recorded on the RELEASE. */
  releaseNote?: string;
}

/**
 * The filters `GET /fulfillment/works` accepts and this app is willing to send
 * (#2410).
 *
 * `status` and `requestStatus` are accepted by the endpoint and ABSENT here on
 * purpose. They are closed unions in `@openlinker/core/fulfillment` that this
 * app may not mirror (see the module docblock), and the endpoint validates them
 * — so a value forwarded raw from the URL bar would 400 the whole page over a
 * typo, and a value this build invented would be silently dropped. Filtering is
 * by the free-string params until a server-supplied facet list exists.
 *
 * `active` is the one status-shaped filter this app sends, and it is an ALIAS
 * the server resolves (#3096): "every status that still has work in it". The
 * board asks for it by default so closed and cancelled parcels do not crowd the
 * Unassigned lane, without this build knowing which statuses those are.
 *
 * `locationId` is accepted by the endpoint and still typed here, but no screen
 * offers it since #3096: with one location it filters nothing, and it returns
 * with multi-warehouse work.
 */
export interface FulfillmentTaskFilters {
  orderId?: string;
  locationId?: string;
  active?: boolean;
  /** Server-clamped; the response reports what was actually applied. */
  limit?: number;
  offset?: number;
}

/**
 * Body of `PATCH /fulfillment/works/:workId/assignment` (#3337, ADR-074;
 * `expectedVersion` #3340 second follow-up).
 *
 * `assignedToUserId` / `selfServeEligible` are optional and independently
 * applied — `undefined` means "leave alone". `assignedToUserId: null` clears
 * an assignment; a string id sets or reassigns it.
 *
 * `expectedVersion` is a THIRD, independently optional field — a lost-update
 * guard, not a staffing field. ADR-074 places assignment outside the
 * legality matrix `applyAction` enforces (which SYSTEM may act), which says
 * nothing about a stale-write guard (an orthogonal concern: has a PEER
 * written since this caller read the row). This board always sends it,
 * carrying the version the row was RENDERED with — never one re-read at
 * click time, or a fresher value would make the 409 this guard exists to
 * raise unreachable and hand the last writer the win.
 */
export interface UpdateFulfillmentWorkAssignmentRequest {
  assignedToUserId?: string | null;
  selfServeEligible?: boolean;
  expectedVersion?: number;
}
