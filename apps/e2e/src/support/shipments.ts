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
 * appears or a bounded budget elapses. It never throws on timeout: the caller
 * asserts a non-null result on success and annotates the documented sandbox
 * timing on `timedOut`, so an attended golden-path run is not failed by a purely
 * sandbox-side delay.
 *
 * @module support
 * @see {@link SyncJobs.syncShipmentStatus}
 */
import type { ApiClient } from '../api/api-client';
import type { OrderRecord, RoutingRuleInput, Shipment } from '../api/api.types';
import type { E2eEnv } from '../config/env';
import type { SyncJobs } from './jobs';

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
}

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
  };
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
// `E2E_ORDER_ID` for a deterministic target. The dispatch seam has no
// "one active shipment per order" guard for carrier (branch-2/3) shipments —
// only the DB-side branch-1 (OMP-fulfilled) index is order-scoped — so every
// spec in the suite can dispatch its own fresh shipment against the SAME
// resolved order without interfering with siblings.

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
 * local reader in `tests/golden-path/full-flow.spec.ts` — duplicated rather
 * than imported because that reader is private to the golden-path spec and
 * asserts a stricter shape (items/totals) the shipping suite doesn't need.
 */
export function readShippingOrderSnapshot(order: OrderRecord): ShippingOrderSnapshot {
  return (order.orderSnapshot ?? {}) as unknown as ShippingOrderSnapshot;
}

/**
 * Resolve the order the shipping suite dispatches labels against. Prefers the
 * pinned `E2E_ORDER_ID` (deterministic — the escape hatch documented on
 * `E2eEnv.orderId`); otherwise falls back to the most recent `ready` order on
 * the stack. Returns `null` when neither resolves, so callers can
 * `test.skip` with a clear reason instead of failing on missing fixture data.
 */
export async function resolveShippingTestOrder(
  api: ApiClient,
  env: Pick<E2eEnv, 'orderId'>,
): Promise<OrderRecord | null> {
  if (env.orderId) {
    try {
      return await api.orders.getById(env.orderId);
    } catch {
      return null;
    }
  }
  const page = await api.orders.list({ limit: 50 });
  return page.items.find((o) => o.recordStatus === 'ready') ?? null;
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
  const existing = await api.routingRules.list(sourceConnectionId).catch(() => []);
  if (existing.some((r) => r.sourceDeliveryMethodId === deliveryMethodId)) {
    return;
  }
  const items: RoutingRuleInput[] = [
    ...existing.map((r) => ({
      sourceDeliveryMethodId: r.sourceDeliveryMethodId,
      processorKind: r.processorKind,
      processorConnectionId: r.processorConnectionId,
    })),
    { sourceDeliveryMethodId: deliveryMethodId, processorKind: 'ol_managed_carrier', processorConnectionId: carrierConnectionId },
  ];
  await api.routingRules.replace(sourceConnectionId, items);
}

/** The source-side delivery-method id recorded on the order (routing key). */
export function resolveOrderDeliveryMethodId(order: OrderRecord): string {
  return readShippingOrderSnapshot(order).shipping?.methodId ?? 'default';
}

/** Recipient payload for a pickup-point (locker) dispatch, derived from the order. */
export function buildPickupRecipient(order: OrderRecord): Record<string, unknown> {
  const snapshot = readShippingOrderSnapshot(order);
  return {
    firstName: snapshot.shippingAddress?.firstName,
    lastName: snapshot.shippingAddress?.lastName,
    email: snapshot.customerEmail,
    phone: snapshot.shippingAddress?.phone,
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
