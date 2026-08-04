/**
 * Shipment tracking-number backfill poller
 *
 * The InPost ShipX sandbox mints a shipment's `tracking_number` only once the
 * shipment is `confirmed`; it is NOT present in the response right after label
 * creation. OL backfills `Shipment.trackingNumber` from the carrier-generic
 * `marketplace.shipment.statusSync` poll (#838) — the fix chain #1426 threads
 * ShipX `tracking_number` through the tracking snapshot, and the status-sync
 * service diffs it onto the row without overwriting.
 *
 * `waitForTrackingBackfill` drives that status-sync poll (rather than waiting on
 * the 30-min scheduled cron) and re-reads the shipment until the tracking number
 * appears or a bounded budget elapses. It never throws; classifying the outcome
 * is `assertTrackingBackfill`'s job, and it is deliberately NOT "annotate on any
 * timeout": a timeout while the carrier has already moved the parcel is a
 * backfill regression and fails, so an attended run is spared a sandbox-side
 * delay without the poller becoming unable to catch the bug it exists for.
 *
 * @module support
 * @see {@link SyncJobs.syncShipmentStatus}
 */
import type { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import { test } from '@playwright/test';
import type { DispatchResult, OrderRecord, RoutingRuleInput, Shipment } from '../api/api.types';
import type { E2eEnv } from '../config/env';
import { PlatformType, type World } from '../world/world';
import type { SyncJobs } from './jobs';

/**
 * ShipX's own error when a courier (address-delivery) dispatch is attempted
 * against an organization with no trucker/route assigned for pickup —
 * confirmed live against `GET /v1/organizations` on the ShipX sandbox: the
 * demo stack's organization enrolls only `inpost_locker`/`inpost_letter`
 * carriers, no courier carrier, regardless of which valid API token
 * authenticates against it. This is an external sandbox-organization
 * provisioning gap, not something fixable by OL code, config, or a
 * different token — courier scenarios detect it and skip cleanly instead
 * of failing red.
 */
const COURIER_UNPROVISIONED_MARKER = 'trucker_ID_is_not_set_for_organization';

/** True when `error` is ShipX's "no trucker assigned to this organization" rejection. */
export function isCourierUnprovisionedError(error: unknown): boolean {
  return error instanceof ApiError && JSON.stringify(error.body).includes(COURIER_UNPROVISIONED_MARKER);
}

export interface TrackingBackfillOptions {
  /** Total budget before giving up (ms). Default 120s. */
  timeoutMs?: number;
  /** Delay between attempts (ms). Default 5s. */
  intervalMs?: number;
  /**
   * Drive `marketplace.shipment.statusSync` on the InPost connection before each
   * re-read so the backfill runs without waiting on the scheduled cron.
   * Default true.
   */
  driveStatusSync?: boolean;
}

export interface TrackingBackfillResult {
  /** The most recent shipment read. */
  shipment: Shipment;
  /** The backfilled tracking number, or null if it never appeared. */
  trackingNumber: string | null;
  /** True when the budget elapsed before the tracking number was minted. */
  timedOut: boolean;
  /**
   * True when the carrier has demonstrably moved the parcel (`in-transit` /
   * `delivered` - both of which OL can only learn from a carrier status read).
   *
   * This is what makes the timeout branch falsifiable. `timedOut` alone cannot
   * distinguish the documented sandbox delay ("ShipX has not confirmed the
   * shipment yet, so no tracking number exists to backfill") from the actual
   * regression this poller exists to catch ("ShipX has one and OL never wrote
   * it" - the #1426 path). A carrier status past `dispatched` proves the former
   * is not the explanation, so callers must FAIL on `timedOut && carrierMoved`
   * instead of annotating. `dispatched` deliberately does not count: OL sets it
   * itself via `notifyDispatched`, so it carries no carrier-side evidence.
   */
  carrierMoved: boolean;
}

/** Shipment states OL can only reach from a carrier-side status read. */
const CARRIER_CONFIRMED_STATUSES: ReadonlySet<Shipment['status']> = new Set([
  'in-transit',
  'delivered',
]);

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 5_000;

/**
 * Poll a shipment until OL backfills its tracking number, driving the InPost
 * status-sync job each attempt. Returns as soon as `trackingNumber` is non-null;
 * on timeout returns the last read with `timedOut: true` (never throws).
 */
export async function waitForTrackingBackfill(
  api: ApiClient,
  jobs: SyncJobs,
  input: { shipmentId: string; inpostConnectionId: string },
  options: TrackingBackfillOptions = {},
): Promise<TrackingBackfillResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const driveStatusSync = options.driveStatusSync ?? true;
  const deadline = Date.now() + timeoutMs;

  let shipment = await api.shipments.getById(input.shipmentId);
  while (shipment.trackingNumber == null && Date.now() < deadline) {
    if (driveStatusSync) {
      // Best-effort: force the carrier-generic status poll that backfills
      // tracking. A short per-attempt budget keeps the loop responsive; errors
      // (a stray business failure on an unrelated page) are swallowed so the
      // wait proceeds to the next re-read.
      await jobs
        .syncShipmentStatus(input.inpostConnectionId, { timeoutMs: intervalMs * 2 })
        .catch(() => undefined);
    }
    await delay(intervalMs);
    shipment = await api.shipments.getById(input.shipmentId);
  }

  return {
    shipment,
    trackingNumber: shipment.trackingNumber,
    timedOut: shipment.trackingNumber == null,
    carrierMoved: CARRIER_CONFIRMED_STATUSES.has(shipment.status),
  };
}

/**
 * Assert the backfill outcome, or return the annotation text for a legitimately
 * un-assertable one.
 *
 * Shared by golden-path S6 and the standalone courier spec so both classify the
 * timeout identically. Returns `null` when the tracking number was backfilled
 * (the caller has nothing to annotate); returns the sandbox-timing note when the
 * carrier has not moved the parcel yet. THROWS when the carrier has moved it and
 * the field is still empty - that is the #1426 backfill regression, not timing,
 * and it is the only path here that can go red on a real defect.
 */
export function assertTrackingBackfill(
  backfill: TrackingBackfillResult,
  label: string,
): string | null {
  if (!backfill.timedOut) {
    // Non-blank rather than merely non-null: `timedOut` is defined as
    // `trackingNumber == null`, so a plain truthiness check here can only ever
    // catch an empty string. The load-bearing check is the throw below.
    if (backfill.trackingNumber!.trim().length === 0) {
      throw new Error(
        `${label}: OL recorded a BLANK tracking number on shipment ${backfill.shipment.id}`,
      );
    }
    return null;
  }
  if (backfill.carrierMoved) {
    throw new Error(
      `${label}: shipment ${backfill.shipment.id} reads status "${backfill.shipment.status}" - the ` +
        'carrier has moved the parcel, so ShipX HAS minted a tracking number and OL failed to ' +
        'backfill it onto the Shipment row (#1426 / marketplace.shipment.statusSync). This is a ' +
        'backfill regression, not the documented sandbox-confirmation delay.',
    );
  }
  return (
    `${label}: tracking number not backfilled within timeout (shipment status ` +
    `"${backfill.shipment.status}") - the ShipX sandbox mints it only after the shipment is ` +
    'confirmed and marketplace.shipment.statusSync runs (#1521). The carrier has not moved the ' +
    'parcel, so OL-side backfill went UNVERIFIED rather than proven broken.'
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Shipping-suite order + routing helpers (#1572) ──────────────────────────
//
// The shipping suite (`apps/e2e/tests/shipping/**`) needs an order to dispatch
// labels against, but — unlike the golden path — never drives its own
// marketplace purchase. It reuses whatever `ready` order already exists on the
// stack (typically left behind by a prior golden-path run), pinned via
// `E2E_ORDER_ID` for a deterministic target.
//
// ONE ORDER = ONE ACTIVE SHIPMENT. `ShipmentDispatchService` guards every
// dispatch with `findActiveByOrderId` and returns the existing shipment when
// one is found (`shipment-dispatch.service.ts`); the guard is order-scoped and
// status-based, NOT connection- or branch-scoped, so it applies to carrier
// (branch-2/3) shipments exactly as it does to OMP-fulfilled ones. Two
// dispatches against the same order therefore yield the SAME shipment row, and
// the second one's method / COD / insurance arguments never reach the carrier
// at all. Every scenario that needs an independent shipment must resolve its
// own order - which is what `resolveShippingTestOrder`'s claim tracking below
// enforces.

/** A loosely-typed read of the order snapshot fields the shipping suite needs. */
export interface ShippingOrderSnapshot {
  customerEmail?: string;
  shippingAddress?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
  };
  shipping?: { methodId?: string };
}

/**
 * Read the fields the shipping suite cares about off `Order.orderSnapshot`
 * (an untyped `Record<string, unknown>` on the wire). Mirrors the equivalent
 * local reader in `tests/golden-path/full-flow/helpers.ts` — duplicated rather
 * than imported because that reader is private to the golden-path spec and
 * asserts a stricter shape (items/totals) the shipping suite doesn't need.
 */
export function readShippingOrderSnapshot(order: OrderRecord): ShippingOrderSnapshot {
  return (order.orderSnapshot ?? {}) as unknown as ShippingOrderSnapshot;
}

/**
 * Orders handed out by `resolveShippingTestOrder` in this worker process.
 *
 * The mechanism protects against SEQUENTIAL reuse, not concurrency: with
 * `workers: 1` + `fullyParallel: false` spec files never run at the same time,
 * so nothing here races. What does happen is that every file independently
 * resolves "the first ready order" and lands on the SAME one - and because an
 * order can carry only one active shipment, the second file's dispatch silently
 * receives the first file's shipment (wrong method, no COD, no insurance)
 * instead of creating an independent one. This set is what makes a second
 * caller get `null` and skip with a reason rather than assert against a stale
 * row. (An earlier comment credited "concurrent spec FILES", which the config
 * makes impossible; the mechanism is right, the old rationale was not.)
 */
const claimedOrderIds = new Set<string>();

/**
 * Why a resolve came back empty, for the caller's `test.skip` reason.
 *
 * "no ready order available" reads like an environment note, so a suite that
 * had CONSUMED its own pool skipped every shipping spec with a message an
 * operator would file under "set up the stack" - green, zero coverage, no
 * signal that the previous run was the cause. These distinguish the three real
 * states.
 */
const SHORTAGE = {
  /** The stack genuinely has no `ready` order to dispatch against. */
  none: 'no `ready` order exists on this stack to dispatch against - run the golden path first, or set E2E_ORDER_ID',
  /** Orders exist but this run already handed each of them out. */
  consumed:
    'every `ready` order in the first page was already claimed by an EARLIER SPEC IN THIS RUN (one dispatch per order per run - see resolveShippingTestOrder). This is a pool shortage, not a stack-configuration problem: the suite needs more ready orders than it currently has',
  /** Orders exist but each already carries a non-terminal shipment. */
  occupied:
    'every `ready` order in the first page already carries an ACTIVE shipment left behind by a PREVIOUS run. Each spec cancels what it created in `afterAll`; a hard-killed run skips that, so cancel the stale shipments (or add more ready orders) to recycle the pool',
  /** The pinned `E2E_ORDER_ID` itself is unusable. */
  pinned:
    'the pinned E2E_ORDER_ID is unavailable (already claimed by an earlier spec in this run, unreadable, or already carrying an active shipment). Pinning yields exactly ONE dispatch per run by design',
} as const;

let lastShortage: string = SHORTAGE.none;

/**
 * The reason the most recent `resolveShippingTestOrder` / `setUpShippingTestOrder`
 * returned null. Pass it as the `test.skip` reason so a depleted pool is
 * distinguishable from an unconfigured stack in the report.
 */
export function shippingOrderShortageReason(): string {
  return lastShortage;
}

/**
 * Shipments created through `resolveDispatchedShipment` in this process.
 *
 * `resolveShippingTestOrder` rejects any order already carrying a non-terminal
 * shipment, and every successful dispatch leaves one behind, so an un-cleaned
 * suite eats its own fixture pool: after a few runs every candidate is occupied,
 * every shipping spec `test.skip`s, and the suite reports green with zero
 * coverage. Recording each dispatch here lets `releaseDispatchedShipments`
 * hand the orders back on the way out.
 */
const dispatchedShipmentIds = new Set<string>();

/**
 * Statuses that already free the order for the next run's dispatch, so the
 * teardown has nothing to do (`ShipmentDispatchService.findActiveByOrderId` is
 * status-based, and these are its terminal states).
 */
const RELEASED_SHIPMENT_STATUSES: ReadonlySet<Shipment['status']> = new Set([
  'cancelled',
  'delivered',
  'failed',
]);

/**
 * Best-effort cancel every shipment this run dispatched, so the order pool
 * recycles for the next run.
 *
 * Call from a `test.afterAll`, never at the end of a test body - a spec that
 * fails mid-way has still consumed its order, and that is exactly the run whose
 * residue must not be left behind. NEVER throws and never asserts: a teardown
 * that fails must not turn a passing run red nor bury a real failure. A cancel
 * legitimately fails once ShipX has confirmed the shipment (cancellation is
 * pre-confirmation only), so failures are summarised to stdout rather than
 * reported per shipment.
 */
export async function releaseDispatchedShipments(api: ApiClient): Promise<void> {
  const ids = [...dispatchedShipmentIds];
  dispatchedShipmentIds.clear();
  const stranded: string[] = [];
  for (const id of ids) {
    try {
      // Re-read first. A shipment the spec ALREADY cancelled (cancellation.spec.ts
      // cancels on purpose, then regenerates) answers 409 here, and a delivered
      // one is equally not-our-problem - counting either as "stranded" would warn
      // on every clean run and train the operator to ignore the message.
      const shipment = await api.shipments.getById(id);
      if (RELEASED_SHIPMENT_STATUSES.has(shipment.status)) continue;
      await api.shipments.cancel(id);
    } catch {
      stranded.push(id);
    }
  }
  if (stranded.length > 0) {
    console.warn(
      `[e2e] ${stranded.length}/${ids.length} shipment(s) could not be cancelled on teardown ` +
        `(${stranded.join(', ')}). Most likely ShipX already confirmed them, which makes ` +
        'cancellation invalid. Their orders stay occupied and will not be re-usable by the next ' +
        'shipping run.',
    );
  }
}

/**
 * Resolve the order the shipping suite dispatches labels against. Prefers the
 * pinned `E2E_ORDER_ID` (deterministic — the escape hatch documented on
 * `E2eEnv.orderId`); otherwise falls back to the first `ready` order on the
 * stack that qualifies.
 *
 * BOTH branches apply the same two guards, and the pinned branch is not the
 * lenient one. Skipping them for the pinned order was a silent-pass generator:
 * `E2E_ORDER_ID` makes every call in the suite return the SAME order, and
 * because `ShipmentDispatchService` hands back an order's existing active
 * shipment instead of creating a second one, every dispatch after the first
 * received the FIRST one's shipment. Files run alphabetically, so
 * `cancellation.spec.ts` claimed the order with a plain kurier shipment and
 * `cod.spec.ts` / `declared-value.spec.ts` then asserted against it - passing
 * while no COD and no insured value ever reached ShipX. The guards are:
 *
 * 1. **Claimed in this run** (`claimedOrderIds`) - one dispatch per order per
 *    run, pinned or not. A second caller gets `null` and skips with a reason
 *    rather than silently re-asserting the first caller's shipment.
 * 2. **Pre-existing active shipment** - on a long-lived demo stack an order
 *    left over from an earlier session already carries one, and the same
 *    idempotency guard would hand that stale (possibly different-method)
 *    shipment back instead of exercising a fresh dispatch.
 *
 * Returns `null` when no candidate resolves, so callers can `test.skip` with a
 * clear reason instead of failing on missing fixture data.
 *
 * Call this once per INDEPENDENT dispatch a spec needs (e.g. once for a
 * paczkomat scenario, once for a courier scenario in the same file) rather
 * than resolving one order and reusing it for two dispatches.
 */
export async function resolveShippingTestOrder(
  api: ApiClient,
  env: Pick<E2eEnv, 'orderId'>,
): Promise<OrderRecord | null> {
  if (env.orderId) {
    lastShortage = SHORTAGE.pinned;
    if (claimedOrderIds.has(env.orderId)) return null;
    const order = await api.orders.getById(env.orderId).catch(() => null);
    if (!order) return null;
    if (await hasActiveShipment(api, order.internalOrderId)) return null;
    // Claim under BOTH keys: the caller pins whatever id it has, and
    // `OrderRecord.internalOrderId` is what every other claim check uses, so
    // keying on one alone would let the other spelling through unclaimed.
    claimedOrderIds.add(env.orderId);
    claimedOrderIds.add(order.internalOrderId);
    return order;
  }
  const page = await api.orders.list({ limit: 50 });
  // Counted so the skip reason can name WHICH exhaustion happened - see
  // `SHORTAGE`. Without it a depleted pool and an unconfigured stack produce
  // the same message.
  let ready = 0;
  let claimed = 0;
  for (const candidate of page.items) {
    if (candidate.recordStatus !== 'ready') continue;
    ready += 1;
    if (claimedOrderIds.has(candidate.internalOrderId)) {
      claimed += 1;
      continue;
    }
    if (await hasActiveShipment(api, candidate.internalOrderId)) continue;
    claimedOrderIds.add(candidate.internalOrderId);
    return candidate;
  }
  lastShortage =
    ready === 0 ? SHORTAGE.none : claimed === ready ? SHORTAGE.consumed : SHORTAGE.occupied;
  return null;
}

/**
 * True when the order already carries a non-terminal shipment. A read failure
 * counts as "occupied" deliberately: `api.shipments.active` already maps the
 * genuine "no active shipment" answer (404) to `null`, so anything reaching the
 * catch is an unexpected error, and treating that as "free" would hand the
 * caller an order whose dispatch then silently returns a pre-existing shipment.
 * Skipping a usable order costs a `test.skip`; using an occupied one costs a
 * false pass.
 */
async function hasActiveShipment(api: ApiClient, internalOrderId: string): Promise<boolean> {
  try {
    return (await api.shipments.active(internalOrderId)) !== null;
  } catch {
    return true;
  }
}

/**
 * Ensure a routing rule maps the order's source delivery method to the given
 * carrier connection (`ol_managed_carrier`) — the operator step every dispatch
 * requires (mirrors golden-path S6). A no-op when the mapping already exists.
 */
export async function ensureCarrierRouting(
  api: ApiClient,
  sourceConnectionId: string,
  deliveryMethodId: string,
  carrierConnectionId: string,
): Promise<void> {
  // Let a failed read THROW. `PUT /connections/:id/routing-rules` is a full
  // replace, and this read is the only source of the rules being preserved, so
  // swallowing the error into `[]` turns one transient 502/timeout - on a
  // job-saturated stack, the same starvation this suite measures - into a
  // silent deletion of the operator's entire routing matrix for the source
  // connection. That deletion is invisible in the report too: the immediate
  // downstream symptom is `resolveDispatchedShipment` SKIPPING on
  // `omp_fulfilled`, so the run stays green while unrelated orders start
  // falling through to the default. A read error is a real failure; report it.
  // (A connection with no rules yet answers `200 []`, not an error - only a
  // missing connection 404s - so nothing legitimate is broken by throwing.)
  const existing = await api.routingRules.list(sourceConnectionId);
  // Match on the DESTINATION too, not just the delivery method. Checking only
  // `sourceDeliveryMethodId` treats "some rule exists for this method" as "the
  // rule I need exists", which is false as soon as another spec has pointed the
  // same method somewhere else - `routing-matrix.spec.ts` does exactly that by
  // design (it asserts a courier method resolving to a DPD rule). The stale
  // rule then wins, the dispatch routes to the wrong processor (or falls
  // through to the `omp_fulfilled` default), and whichever spec happens to run
  // after it fails on a downstream symptom instead of a routing error - which
  // is why the failing test moved between runs.
  const alreadyRouted = existing.some(
    (r) =>
      r.sourceDeliveryMethodId === deliveryMethodId &&
      r.processorKind === 'ol_managed_carrier' &&
      r.processorConnectionId === carrierConnectionId,
  );
  if (alreadyRouted) {
    return;
  }
  const items: RoutingRuleInput[] = [
    // Drop any divergent rule for this method before re-adding our own; the
    // endpoint is a full replace, so a duplicate key would otherwise persist.
    ...existing
      .filter((r) => r.sourceDeliveryMethodId !== deliveryMethodId)
      .map((r) => ({
        sourceDeliveryMethodId: r.sourceDeliveryMethodId,
        processorKind: r.processorKind,
        processorConnectionId: r.processorConnectionId,
      })),
    { sourceDeliveryMethodId: deliveryMethodId, processorKind: 'ol_managed_carrier', processorConnectionId: carrierConnectionId },
  ];
  await api.routingRules.replace(sourceConnectionId, items);
}

/**
 * Resolve the `Shipment` a dispatch produced, or skip the test when the stack
 * legitimately produced none.
 *
 * `POST /shipments/generate-label` answers with a `DispatchResult` whose `kind`
 * is either `dispatched` (OL created a carrier shipment) or `omp_fulfilled`
 * (the marketplace fulfils it, so OL creates NO shipment - the routing default
 * when no rule matches). Specs used to write
 * `dispatch.shipment ?? await api.shipments.active(orderId)`, which treats the
 * second case as "the shipment must already exist" and dies on a bare
 * `404 No active shipment for order …` several lines later. That hid the real
 * cause (routing, not shipping) behind a confusing symptom.
 *
 * Handling `omp_fulfilled` as a skip keeps the failure honest: an
 * OMP-fulfilled order genuinely has no carrier shipment to assert on.
 */
export async function resolveDispatchedShipment(
  api: ApiClient,
  dispatch: DispatchResult,
  orderId: string,
): Promise<Shipment> {
  if (dispatch.kind === 'omp_fulfilled') {
    test.skip(
      true,
      `order ${orderId} routed to the omp_fulfilled default (no OL-managed carrier rule matched), so no shipment exists to assert on`,
    );
  }
  const shipment = dispatch.shipment ?? (await api.shipments.active(orderId));
  if (!shipment) {
    throw new Error(`dispatch reported kind=${dispatch.kind} but no shipment could be resolved for ${orderId}`);
  }
  // The one choke point every shipping spec's dispatch passes through, so
  // recording here is what makes `releaseDispatchedShipments` complete without
  // each spec having to remember its own ids.
  dispatchedShipmentIds.add(shipment.id);
  return shipment;
}

export interface ShippingTestOrderSetup {
  order: OrderRecord;
  deliveryMethodId: string;
  inpostConnectionId: string;
}

/**
 * Resolve an INDEPENDENT order + carrier routing for one shipping dispatch
 * scenario. Call this once per dispatch a spec needs (a paczkomat scenario
 * and a courier scenario in the same file each get their own call, hence
 * their own order) rather than sharing one order across scenarios — see
 * `resolveShippingTestOrder`'s claimed-order tracking.
 */
export async function setUpShippingTestOrder(
  api: ApiClient,
  world: World,
  env: Pick<E2eEnv, 'orderId'>,
): Promise<ShippingTestOrderSetup | null> {
  const inpost = world.connectionFor(PlatformType.inpost);
  if (!inpost) return null;
  const order = await resolveShippingTestOrder(api, env);
  if (!order) return null;
  const deliveryMethodId = resolveOrderDeliveryMethodId(order);
  await ensureCarrierRouting(api, order.sourceConnectionId, deliveryMethodId, inpost.id);
  return { order, deliveryMethodId, inpostConnectionId: inpost.id };
}

/** The source-side delivery-method id recorded on the order (routing key). */
export function resolveOrderDeliveryMethodId(order: OrderRecord): string {
  return readShippingOrderSnapshot(order).shipping?.methodId ?? 'default';
}

/** Recipient payload for a pickup-point (locker) dispatch, derived from the order. */
export function buildPickupRecipient(order: OrderRecord): Record<string, unknown> {
  const snapshot = readShippingOrderSnapshot(order);
  return {
    firstName: snapshot.shippingAddress?.firstName ?? 'Jan',
    lastName: snapshot.shippingAddress?.lastName ?? 'Testowy',
    email: snapshot.customerEmail ?? 'e2e-shipping@example.test',
    // Synthesized REST-source test orders don't carry a phone number;
    // InPost requires a non-empty one regardless of delivery mode — same
    // fallback as `buildCourierRecipient` below.
    phone: snapshot.shippingAddress?.phone ?? '500100200',
  };
}

/**
 * A fixed, well-formed Polish address for courier (address-delivery)
 * scenarios. The shipping suite dispatches synthetic test shipments that are
 * never actually collected/delivered by a real courier — a real
 * deliverable address is not required, only one the ShipX sandbox accepts as
 * structurally valid (non-empty street/city/postcode in the right format).
 * Deriving a street + building number split from the order's free-text
 * `address1` would be unreliable (PrestaShop stores them combined); a fixed
 * synthetic address keeps every courier scenario deterministic.
 */
const SYNTHETIC_COURIER_ADDRESS = {
  street: 'Testowa',
  buildingNumber: '12',
  city: 'Warszawa',
  postCode: '00-001',
  countryCode: 'PL',
} as const;

/** Recipient payload for a courier (address-delivery) dispatch, derived from the order. */
export function buildCourierRecipient(order: OrderRecord): Record<string, unknown> {
  const snapshot = readShippingOrderSnapshot(order);
  return {
    firstName: snapshot.shippingAddress?.firstName ?? 'Jan',
    lastName: snapshot.shippingAddress?.lastName ?? 'Testowy',
    email: snapshot.customerEmail ?? 'e2e-shipping@example.test',
    phone: snapshot.shippingAddress?.phone ?? '500100200',
    address: SYNTHETIC_COURIER_ADDRESS,
  };
}

/** A small, valid courier parcel descriptor (dimensions in mm, weight in grams). */
export const SYNTHETIC_COURIER_PARCEL = {
  dimensions: { length: 200, width: 150, height: 100 },
  weightGrams: 1000,
} as const;
