/**
 * Mirakl Inventory Master Adapter
 *
 * `InventoryMasterPort` over the seller's Mirakl offers (#4284): an offer's
 * OF21 `quantity` is the stock of its product's single variant, reported
 * pooled (Mirakl offers carry no warehouse).
 *
 * ## Writing stock: queued, never sent on its own
 *
 * OpenLinker adjusts by a delta; STO01 only takes an absolute quantity, and
 * Mirakl takes one STO01 file per shop about every 30 seconds (a second one
 * inside the window answers 429, measured on Empik staging). Sending each
 * adjustment as its own file would refuse every second sale of a burst. So
 * `adjustInventory`:
 *
 * 1. takes a short per-sku lock, so two adjustments of one offer never
 *    interleave their read and write;
 * 2. answers a repeated idempotency key from the cache as `deduplicated`
 *    (seven days, the WooCommerce / PrestaShop #2368 shape);
 * 3. reads the current quantity: the newest queued or sent, not yet settled
 *    target for the offer, else OF21 (`mirakl-master-stock.policy.ts`);
 * 4. queues `max(0, current + delta)` in `mirakl_offer_writes`.
 *
 * The queue is the #4277 one: `reconcilePendingQuantityAcks` (the scheduled
 * offer-writes pass) sends every queued line as one STO01 file and settles it
 * from the import report, so a refused line is recorded with Mirakl's reason.
 * The adjustment therefore returns before Mirakl has the number, with
 * `appliedAt: null`: the same "accepted, confirmed later" contract Allegro's
 * quantity writes have (#2621).
 *
 * Known window, stated rather than hidden: a sale made on the marketplace
 * between the OF21 read and Mirakl applying the file is written over.
 *
 * Reads overlay the queued target too, so a master sync running before the
 * file is applied does not mirror the old number back.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 * @implements {InventoryMasterPort}
 */
import type {
  Inventory,
  InventoryAdjustment,
  InventoryAdjustmentResult,
  InventoryIdempotencySupport,
  InventoryMasterPort,
} from '@openlinker/core/inventory';
import type {
  PendingQuantityAckReconciler,
  PendingQuantityAckReconcileResult,
} from '@openlinker/core/listings';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { SyncLockPort } from '@openlinker/core/sync';
import type { CachePort } from '@openlinker/shared/cache';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import { MiraklConfigException } from '../../../domain/exceptions/mirakl-config.exception';
import { MiraklNotSupportedException } from '../../../domain/exceptions/mirakl-not-supported.exception';
import {
  computeMiraklStockTarget,
  readMiraklOfferQuantity,
  resolveMiraklCurrentStock,
} from '../../../domain/policies/mirakl-master-stock.policy';
import { formatMiraklQuantity } from '../../../domain/policies/mirakl-offer-file.policy';
import type { MiraklOfferWriteRepositoryPort } from '../../../domain/ports/mirakl-offer-write-repository.port';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import type { IMiraklImportTracker } from '../../imports/mirakl-import-tracker.interface';
import { MiraklOfferWriteReconciler } from '../mirakl-offer-write-reconciler';
import type { MiraklMasterIdentity } from './mirakl-master-identity';
import type { MiraklOfferReader } from './mirakl-offer-reader';

/** Seven days, matching the job dedup TTL, so no retry outlives the window. */
const IDEMPOTENCY_TTL_SEC = 7 * 24 * 60 * 60;
/** The critical section is one OF21 read and one queue write. */
const LOCK_TTL_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 250;

/** What the stock master is built from. */
export interface MiraklInventoryMasterSettings {
  readonly connectionId: string;
  readonly brand: string;
  readonly httpClient: IMiraklHttpClient;
  readonly importTracker: IMiraklImportTracker;
  readonly reader: MiraklOfferReader;
  readonly identity: MiraklMasterIdentity;
  /** The write queue; absent in a process without the database. */
  readonly writes?: MiraklOfferWriteRepositoryPort;
  /** Idempotency keys; without it keys are reported unsupported. */
  readonly cache?: CachePort;
  /** Serialises writes to one offer across processes; absent in a bare test. */
  readonly lock?: SyncLockPort;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

interface StockPosition {
  readonly sku: string;
  readonly productId: string;
  readonly quantity: number;
}

export class MiraklInventoryMasterAdapter
  implements InventoryMasterPort, PendingQuantityAckReconciler
{
  private readonly logger = new Logger(MiraklInventoryMasterAdapter.name);
  private readonly connectionId: string;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly settings: MiraklInventoryMasterSettings) {
    this.connectionId = settings.connectionId;
    this.now = settings.now ?? ((): Date => new Date());
    this.sleep =
      settings.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  async getInventory(productId: string, _locationId?: string): Promise<Inventory> {
    const [inventory] = await this.listInventory(productId);
    return inventory;
  }

  async listInventory(productId: string): Promise<Inventory[]> {
    const position = await this.readPosition(productId, false);
    return [await this.toInventory(position)];
  }

  async getAvailableQuantity(productId: string, _locationId?: string): Promise<number> {
    return (await this.readPosition(productId, false)).quantity;
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  async adjustInventory(adjustment: InventoryAdjustment): Promise<InventoryAdjustmentResult> {
    const sku = await this.settings.identity.skuOf(adjustment.productId);
    return this.withLock(sku, () => this.adjustLocked(sku, adjustment));
  }

  /** Sends the queue as one STO01 file and settles earlier files (#4277 pass). */
  reconcilePendingQuantityAcks(limit: number): Promise<PendingQuantityAckReconcileResult> {
    return new MiraklOfferWriteReconciler(
      this.connectionId,
      this.settings.httpClient,
      this.settings.importTracker,
      this.store()
    ).reconcile(limit);
  }

  reserveInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(new MiraklNotSupportedException('holding stock', this.settings.brand));
  }

  releaseInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(
      new MiraklNotSupportedException('releasing held stock', this.settings.brand)
    );
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async adjustLocked(
    sku: string,
    adjustment: InventoryAdjustment
  ): Promise<InventoryAdjustmentResult> {
    const store = this.store();
    const idempotency = this.idempotencySupport(adjustment);
    if (idempotency === 'honoured' && (await this.hasAppliedKey(adjustment.idempotencyKey))) {
      this.logger.log(
        `Skipping already-applied stock adjustment for offer ${sku} ` +
          `(connection: ${this.connectionId})`
      );
      const current = await this.readPosition(adjustment.productId, true);
      return {
        ...(await this.toInventory(current)),
        adjustmentOutcome: { disposition: 'deduplicated', idempotency, appliedAt: null },
      };
    }

    const current = await this.readPosition(adjustment.productId, true);
    const { target, clamped } = computeMiraklStockTarget(current.quantity, adjustment.quantity);
    if (clamped) {
      this.logger.warn(
        `Stock adjustment ${adjustment.quantity} on offer ${sku} would go below zero ` +
          `(current ${current.quantity}); queueing 0 (connection: ${this.connectionId})`
      );
    }

    await store.recordPending(this.connectionId, 'stock', [
      { offerSku: sku, value: formatMiraklQuantity(target) },
    ]);
    if (idempotency === 'honoured') {
      await this.rememberAppliedKey(adjustment.idempotencyKey);
    }
    this.logger.log(
      `Queued ${this.settings.brand} stock ${target} for offer ${sku} ` +
        `(${adjustment.reason ?? 'no reason'}, connection: ${this.connectionId})`
    );

    return {
      ...(await this.toInventory({ ...current, quantity: target })),
      adjustmentOutcome: { disposition: 'applied', idempotency, appliedAt: null },
    };
  }

  /** The offer's stock, overlaid with a queued, not yet settled target. */
  private async readPosition(productId: string, fresh: boolean): Promise<StockPosition> {
    const sku = await this.settings.identity.skuOf(productId);
    const offer = await this.settings.reader.readBySku(sku, { fresh });
    if (!offer) {
      throw new MasterProductNotFoundError(productId, this.connectionId);
    }
    const queued = this.settings.writes
      ? await this.settings.writes.findLatest(this.connectionId, 'stock', sku)
      : null;
    const quantity = resolveMiraklCurrentStock(readMiraklOfferQuantity(offer.quantity), queued);
    return { sku, productId, quantity };
  }

  private async toInventory(position: StockPosition): Promise<Inventory> {
    const { identity } = this.settings;
    const [variantId, inventoryId] = await Promise.all([
      identity.variantId(position.sku, position.productId),
      identity.inventoryId(position.sku, position.productId),
    ]);
    return {
      id: inventoryId,
      productId: position.productId,
      variantId,
      quantity: position.quantity,
      reserved: 0,
      available: position.quantity,
    };
  }

  private store(): MiraklOfferWriteRepositoryPort {
    if (!this.settings.writes) {
      throw new MiraklConfigException(
        `${this.settings.brand} stock writes need the database; this process has none`,
        this.connectionId
      );
    }
    return this.settings.writes;
  }

  private async withLock<T>(sku: string, work: () => Promise<T>): Promise<T> {
    const { lock } = this.settings;
    if (!lock) {
      return work();
    }
    const key = `mirakl:master-stock:${this.connectionId}:${sku}`;
    const deadline = this.now().getTime() + LOCK_WAIT_MS;
    let token = await lock.acquire(key, LOCK_TTL_MS);
    while (token === null && this.now().getTime() < deadline) {
      await this.sleep(LOCK_POLL_MS);
      token = await lock.acquire(key, LOCK_TTL_MS);
    }
    if (token === null) {
      // Nothing was read or written; another adjustment of this offer holds it.
      throw new MiraklApiException(
        `Another stock change of offer ${sku} is still running; try again`,
        409,
        'STOCK_WRITE_CONTENDED'
      );
    }
    try {
      return await work();
    } finally {
      await lock.release(key, token).catch((error: unknown) => {
        this.logger.warn(
          `Could not release stock lock for offer ${sku}: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }
  }

  private idempotencySupport(adjustment: InventoryAdjustment): InventoryIdempotencySupport {
    if (!adjustment.idempotencyKey) {
      return 'not_requested';
    }
    return this.settings.cache ? 'honoured' : 'unsupported';
  }

  private async hasAppliedKey(key: string | undefined): Promise<boolean> {
    if (!key || !this.settings.cache) {
      return false;
    }
    return (await this.settings.cache.get<true>(this.appliedKey(key))) === true;
  }

  private async rememberAppliedKey(key: string | undefined): Promise<void> {
    if (!key || !this.settings.cache) {
      return;
    }
    await this.settings.cache.set(this.appliedKey(key), true, IDEMPOTENCY_TTL_SEC);
  }

  private appliedKey(key: string): string {
    return `mirakl:inventory-adjust:${this.connectionId}:${key}`;
  }
}
