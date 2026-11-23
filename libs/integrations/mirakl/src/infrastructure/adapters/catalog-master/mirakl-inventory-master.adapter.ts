/**
 * Mirakl Inventory Master Adapter
 *
 * `InventoryMasterPort` over the seller's Mirakl offers (#4284): an offer's
 * OF21 `quantity` is the stock of its product's single variant, reported
 * pooled (Mirakl offers carry no warehouse).
 *
 * ## Writing stock
 *
 * OpenLinker adjusts by a delta; STO01 only takes an absolute quantity and
 * applies it asynchronously. So `adjustInventory`:
 *
 * 1. takes a short per-sku lock, so two adjustments of one offer never
 *    interleave their read and write;
 * 2. answers a repeated idempotency key from the cache as `deduplicated`
 *    (seven days, the WooCommerce / PrestaShop #2368 shape), recording a key
 *    only AFTER the submit succeeded;
 * 3. reads the current quantity: the target it submitted itself if that is
 *    still fresh, else OF21 (`mirakl-master-stock.policy.ts`);
 * 4. submits a one-line STO01 with `max(0, current + delta)`.
 *
 * It returns the submitted target with `appliedAt: null`: Mirakl applies it
 * later and reports no instant. A transport failure propagates, which core
 * records as an unknown outcome and never retries blind.
 *
 * Known window, stated rather than hidden: a sale made on the marketplace
 * between the OF21 read and Mirakl applying the import is written over. The
 * submit happens seconds after the read, so the window is that long.
 *
 * Reads overlay a fresh pending target too, so a master sync running in the
 * seconds after a write does not mirror the old number back.
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
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { SyncLockPort } from '@openlinker/core/sync';
import type { CachePort } from '@openlinker/shared/cache';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import { MiraklNotSupportedException } from '../../../domain/exceptions/mirakl-not-supported.exception';
import {
  computeMiraklStockTarget,
  MIRAKL_PENDING_STOCK_TRUST_MS,
  readMiraklOfferQuantity,
  resolveMiraklCurrentStock,
  type MiraklPendingStock,
} from '../../../domain/policies/mirakl-master-stock.policy';
import {
  buildMiraklOfferFile,
  formatMiraklQuantity,
} from '../../../domain/policies/mirakl-offer-file.policy';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import type { MiraklMasterIdentity } from './mirakl-master-identity';
import type { MiraklOfferReader } from './mirakl-offer-reader';

const STOCK_IMPORT_PATH = '/api/offers/stock/imports';
/** Seven days, matching the job dedup TTL, so no retry outlives the window. */
const IDEMPOTENCY_TTL_SEC = 7 * 24 * 60 * 60;
/** Kept a little past the trust window; the policy decides whether it counts. */
const PENDING_TTL_SEC = Math.ceil((MIRAKL_PENDING_STOCK_TRUST_MS * 2) / 1000);
/** The critical section is one OF21 read and one upload. */
const LOCK_TTL_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 250;

/** What the stock master is built from. */
export interface MiraklInventoryMasterSettings {
  readonly connectionId: string;
  readonly brand: string;
  readonly httpClient: IMiraklHttpClient;
  readonly reader: MiraklOfferReader;
  readonly identity: MiraklMasterIdentity;
  /** Idempotency and pending targets; without it keys are reported unsupported. */
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

export class MiraklInventoryMasterAdapter implements InventoryMasterPort {
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
          `(current ${current.quantity}); writing 0 (connection: ${this.connectionId})`
      );
    }

    const importId = await this.submitStock(sku, target);
    this.settings.reader.forget(sku);
    await this.rememberPending(sku, { target, importId, submittedAt: this.now().toISOString() });
    if (idempotency === 'honoured') {
      await this.rememberAppliedKey(adjustment.idempotencyKey);
    }
    this.logger.log(
      `Set ${this.settings.brand} stock of offer ${sku} to ${target} ` +
        `(${adjustment.reason ?? 'no reason'}, import ${importId}, connection: ${this.connectionId})`
    );

    return {
      ...(await this.toInventory({ ...current, quantity: target })),
      adjustmentOutcome: { disposition: 'applied', idempotency, appliedAt: null },
    };
  }

  /** The offer's stock, overlaid with a fresh pending target. */
  private async readPosition(productId: string, fresh: boolean): Promise<StockPosition> {
    const sku = await this.settings.identity.skuOf(productId);
    const offer = await this.settings.reader.readBySku(sku, { fresh });
    if (!offer) {
      throw new MasterProductNotFoundError(productId, this.connectionId);
    }
    const quantity = resolveMiraklCurrentStock(
      readMiraklOfferQuantity(offer.quantity),
      await this.readPending(sku),
      this.now()
    );
    return { sku, productId, quantity };
  }

  private async submitStock(sku: string, target: number): Promise<string> {
    const content = buildMiraklOfferFile('stock', [
      { offerSku: sku, value: formatMiraklQuantity(target) },
    ]);
    const { data } = await this.settings.httpClient.postFile<{ import_id?: string | number }>(
      STOCK_IMPORT_PATH,
      {
        fieldName: 'file',
        fileName: `stock-${sku}-${this.now().toISOString().replace(/[:.]/g, '-')}.csv`,
        contentType: 'text/csv',
        content,
      }
    );
    if (data?.import_id === undefined || data.import_id === null || data.import_id === '') {
      throw new MiraklApiException('Mirakl answered the stock import without an import_id');
    }
    return String(data.import_id);
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

  private async readPending(sku: string): Promise<MiraklPendingStock | null> {
    if (!this.settings.cache) {
      return null;
    }
    return this.settings.cache.get<MiraklPendingStock>(this.pendingKey(sku));
  }

  private async rememberPending(sku: string, pending: MiraklPendingStock): Promise<void> {
    if (!this.settings.cache) {
      return;
    }
    await this.settings.cache.set(this.pendingKey(sku), pending, PENDING_TTL_SEC);
  }

  private appliedKey(key: string): string {
    return `mirakl:inventory-adjust:${this.connectionId}:${key}`;
  }

  private pendingKey(sku: string): string {
    return `mirakl:stock-pending:${this.connectionId}:${sku}`;
  }
}
