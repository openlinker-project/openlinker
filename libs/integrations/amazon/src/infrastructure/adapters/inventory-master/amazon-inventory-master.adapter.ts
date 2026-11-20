/**
 * Amazon Inventory Master Adapter (#4183)
 *
 * `InventoryMasterPort` over the seller's Amazon listings, so other channels
 * publish the stock the seller keeps on Amazon. Products and variants are the
 * ones the Amazon `ProductMaster` (#4182) reads: a product is a standalone SKU
 * or a variation parent, its variants are the child SKUs or the SKU itself,
 * and the identifier mappings are the same SKU-keyed ones.
 *
 *   - FBM (seller-fulfilled) stock: the listing's `fulfillment_availability`
 *     entry for the `DEFAULT` channel, one position per variant, reported
 *     without a location. A connection's `stockLocationOverride` places it
 *     (ADR-058 § Amendment #3206).
 *   - FBA stock, opt-in through `fbaLocationId`: `getInventorySummaries`
 *     (FBA Inventory API v1), fulfillable units as available and Amazon's own
 *     reservations as reserved, reported at that location. It is only
 *     reported while `stockLocationOverride` locates the FBM position as well:
 *     core treats one variant reported both without and with a location as a
 *     contradiction and retires the pooled row (#2322). With FBA on, every
 *     variant gets a FBA position (zero when Amazon lists none), because core
 *     prunes by variant and a FBA row it stopped receiving would keep its last
 *     quantity; a failed FBA read therefore fails the product's sync.
 *   - `BulkInventoryReader` (guard-only, never advertised): reads the listings
 *     of a batch 20 SKUs a call and their FBA stock 50 SKUs a call.
 *   - `adjustInventory`: FBM only, `patchListingsItem` replacing the `DEFAULT`
 *     quantity, computed from a fresh read of the listing (never the warm
 *     copy). FBA stock is never written: an adjustment at the FBA location or
 *     on a listing Amazon fulfils is refused. Amazon applies an accepted patch
 *     minutes later, so a read inside that window still shows the old
 *     quantity: the written quantity is kept in the host cache for that window
 *     and the next adjustment starts from it (plus whatever Amazon changed
 *     since), or two back-to-back decrements would both start from the old
 *     number and one would be lost. Core runs sale decrements and stock
 *     corrections of one position under one lock, so those read and write the
 *     entry one at a time; a return restock writes outside that lock and can
 *     still race one of them. Without a cache this falls back to Amazon's
 *     read and the window stays open. Still not atomic (Amazon has no conditional stock write): a
 *     sale landing between the read and the patch is overwritten. An idempotency key is honoured through the host cache
 *     for seven days, recorded only after Amazon accepted the patch; without a
 *     cache it is reported `unsupported`. Amazon applies an accepted patch a
 *     few minutes later and reports no instant, so `appliedAt` is `null` and
 *     the written quantity is what is returned.
 *
 * Everything is read on the catalogue marketplace (`resolveCatalogueMarketplaceId`),
 * the one the `ProductMaster` reads: the variation links and FBA stock differ
 * per marketplace, so reading another one would report stock for variants the
 * catalogue does not have.
 *
 * A listing Amazon no longer has raises `MasterProductNotFoundError` (#1688).
 * A missing identifier mapping and an unreadable quantity stay retryable
 * errors, never a deletion and never zero.
 *
 * Not verified on a live account (#4183 research criterion); field names
 * follow Amazon's published models.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/inventory-master
 * @implements {InventoryMasterPort}
 */
import {
  CORE_ENTITY_TYPE,
  type Connection,
  type IdentifierMappingPort,
} from '@openlinker/core/identifier-mapping';
import type {
  BulkInventoryReader,
  Inventory,
  InventoryAdjustment,
  InventoryAdjustmentResult,
  InventoryIdempotencySupport,
  InventoryMasterPort,
} from '@openlinker/core/inventory';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { CachePort } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';

import { AmazonConfigException } from '../../../domain/exceptions/amazon-config.exception';
import { AmazonNotSupportedException } from '../../../domain/exceptions/amazon-not-supported.exception';
import { AmazonStockUnreadableException } from '../../../domain/exceptions/amazon-stock-unreadable.exception';
import { resolveCatalogueMarketplaceId } from '../../../domain/policies/amazon-config.policy';
import type { AmazonConnectionConfig } from '../../../domain/types/amazon-config.types';
import type { AmazonFbaStock } from '../../../domain/types/amazon-fba-inventory.types';
import type { AmazonListingItem, AmazonPendingStockWrite } from '../../../domain/types/amazon-listing.types';
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';
import { isAmazonFulfilledOnly, sellerFulfilledQuantity } from '../../mappers/amazon-inventory.mapper';
import { variationLinks } from '../../mappers/amazon-product.mapper';
import { AmazonFbaInventoryReader, NO_FBA_STOCK } from '../../readers/amazon-fba-inventory.reader';
import { AmazonListingReader } from '../../readers/amazon-listing.reader';
import { patchAmazonListing, sellerQuantityPatch } from '../../writers/amazon-listing-patch';

/** How long a honoured idempotency key is remembered, the WooCommerce / PrestaShop window (#2368). */
const ADJUSTMENT_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long an accepted stock patch is assumed possibly unapplied: Amazon's
 * stated "a few minutes" plus a margin. Kept short because a patch Amazon
 * accepts and then fails without an issue on the listing would otherwise be
 * built on for the whole window.
 */
const PENDING_STOCK_WRITE_TTL_SECONDS = 10 * 60;

/** The listing attribute a seller-fulfilled stock patch writes. */
const STOCK_ATTRIBUTE = 'fulfillment_availability';

/** How many unapplied written quantities are kept per listing; older ones no longer matter. */
const PENDING_STOCK_WRITE_CHAIN_LIMIT = 20;

export class AmazonInventoryMasterAdapter implements InventoryMasterPort, BulkInventoryReader {
  private readonly logger = new Logger(AmazonInventoryMasterAdapter.name);
  private readonly listings: AmazonListingReader;
  private readonly fba: AmazonFbaInventoryReader | null;
  private readonly sellerId: string;
  private readonly marketplaceId: string;

  constructor(
    private readonly connection: Connection,
    private readonly client: AmazonSpApiClient,
    private readonly config: AmazonConnectionConfig,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly cache?: CachePort,
  ) {
    if (config.sellerId === undefined) {
      throw new AmazonConfigException(connection.id, 'sellerId (merchant token) is required to read stock');
    }
    this.sellerId = config.sellerId;
    this.marketplaceId = resolveCatalogueMarketplaceId(config);
    this.listings = new AmazonListingReader(client, config.sellerId, this.marketplaceId, connection.id, cache);
    this.fba = this.fbaEnabled() ? new AmazonFbaInventoryReader(client, this.marketplaceId) : null;
  }

  // ── Reads ───────────────────────────────────────────────────

  async listInventory(productId: string): Promise<Inventory[]> {
    const items = await this.variantListings(productId);
    // Every quantity is read before any id is minted: a listing that cannot be
    // reported must not leave mappings behind.
    const fbm = items.map((item) => {
      const quantity = sellerFulfilledQuantity(item);
      if (quantity === null) {
        throw new AmazonStockUnreadableException(item.sku, this.connection.id);
      }
      return quantity;
    });
    const fba = this.fba !== null ? await this.fba.read(items.map((item) => item.sku)) : null;
    const ids = await this.mintIds(productId, items.map((item) => item.sku));

    const inventories: Inventory[] = [];
    items.forEach((item, index) => {
      const variantId = this.idFor(ids.variants, item.sku);
      inventories.push({
        id: this.idFor(ids.inventories, `fbm:${item.sku}`),
        productId,
        variantId,
        quantity: fbm[index],
        reserved: 0,
        available: fbm[index],
      });
      if (fba !== null && this.config.fbaLocationId !== undefined) {
        const stock = fba.get(item.sku) ?? NO_FBA_STOCK;
        inventories.push(this.fbaInventory(productId, variantId, this.idFor(ids.inventories, `fba:${item.sku}`), stock));
      }
    });
    return inventories;
  }

  /** The first variant's seller-fulfilled stock; callers needing every variant use `listInventory`. */
  async getInventory(productId: string, locationId?: string): Promise<Inventory> {
    const inventories = await this.listInventory(productId);
    const wanted =
      locationId !== undefined && locationId === this.config.fbaLocationId
        ? inventories.find((inventory) => inventory.locationId === locationId)
        : inventories.find((inventory) => inventory.locationId === undefined);
    return wanted ?? inventories[0];
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    return (await this.getInventory(productId, locationId)).available;
  }

  /**
   * Warms the listings of a batch, their variation children and, with FBA on,
   * their FBA stock. Best-effort: a failure is logged and the per-product
   * reads run as before. An unmapped product is skipped; its own read raises
   * the mapping gap.
   */
  async prefetchInventory(internalProductIds: readonly string[]): Promise<void> {
    if (internalProductIds.length === 0) {
      return;
    }
    try {
      const skus: string[] = [];
      for (const productId of internalProductIds) {
        const sku = await this.findExternalId(CORE_ENTITY_TYPE.Product, productId);
        if (sku !== undefined) skus.push(sku);
      }
      await this.listings.prefetch(skus);
      const variantSkus = skus.flatMap((sku) => {
        const item = this.listings.peek(sku);
        if (item === null || item === undefined) return [];
        const { childSkus } = variationLinks(item, this.marketplaceId);
        return childSkus.length > 0 ? [...childSkus] : [sku];
      });
      const children = variantSkus.filter((sku) => this.listings.peek(sku) === undefined);
      if (children.length > 0) {
        await this.listings.prefetch(children);
      }
      if (this.fba !== null) {
        await this.fba.read(variantSkus);
      }
    } catch (error) {
      this.logger.warn(
        `Amazon stock prefetch failed for ${internalProductIds.length} product(s) (connection: ${this.connection.id}); ` +
          `falling back to per-product reads: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Writes ──────────────────────────────────────────────────

  async adjustInventory(adjustment: InventoryAdjustment): Promise<InventoryAdjustmentResult> {
    if (adjustment.locationId !== undefined && adjustment.locationId === this.config.fbaLocationId) {
      throw new AmazonNotSupportedException('writing FBA stock; Amazon keeps it');
    }
    const sku = await this.adjustmentSku(adjustment);
    const idempotency = this.idempotencySupport(adjustment);

    const item = await this.listings.refresh(sku, { withIssues: true });
    if (item === null) {
      throw new MasterProductNotFoundError(adjustment.productId, this.connection.id);
    }
    if (isAmazonFulfilledOnly(item)) {
      throw new AmazonNotSupportedException(`writing the stock of listing ${sku}; Amazon fulfils it`);
    }
    const read = sellerFulfilledQuantity(item);
    if (read === null) {
      throw new AmazonStockUnreadableException(sku, this.connection.id);
    }
    const { base: current, pending } = await this.stockBase(sku, read, hasStockIssue(item));

    // Ids are resolved BEFORE the write: failing after the patch would report
    // an error for a change that landed.
    const ids = await this.mintIds(adjustment.productId, [sku]);
    const variantId = this.idFor(ids.variants, sku);
    const inventoryId = this.idFor(ids.inventories, `fbm:${sku}`);
    const result = (quantity: number, disposition: 'applied' | 'deduplicated'): InventoryAdjustmentResult => ({
      id: inventoryId,
      productId: adjustment.productId,
      variantId,
      quantity,
      reserved: 0,
      available: quantity,
      adjustmentOutcome: { disposition, idempotency, appliedAt: null },
    });

    if (idempotency === 'honoured' && (await this.hasAppliedKey(adjustment.idempotencyKey))) {
      this.logger.log(
        `Skipping already-applied stock adjustment key=${String(adjustment.idempotencyKey)} for Amazon listing ${sku} ` +
          `(connection: ${this.connection.id})`,
      );
      return result(current, 'deduplicated');
    }

    const requested = current + adjustment.quantity;
    const next = Math.max(0, requested);
    if (next !== requested) {
      this.logger.warn(
        `Amazon listing ${sku} stock would go to ${requested}; clamped to 0 (connection: ${this.connection.id})`,
      );
    }
    // Amazon has no stock-reason field, so this line is the only record of why.
    this.logger.log(
      `Adjusting Amazon listing ${sku} seller-fulfilled stock by ${adjustment.quantity}` +
        `${adjustment.reason !== undefined ? ` (${adjustment.reason})` : ''}, ${current} -> ${next} ` +
        `(connection: ${this.connection.id})`,
    );
    await patchAmazonListing(this.client, this.sellerId, item, this.config.marketplaceIds, [sellerQuantityPatch(next)]);
    await this.rememberPendingWrite(sku, read, pending, next);

    if (idempotency === 'honoured') {
      await this.rememberAppliedKey(adjustment.idempotencyKey);
    }
    return result(next, 'applied');
  }

  reserveInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(new AmazonNotSupportedException('reserveInventory'));
  }

  releaseInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(new AmazonNotSupportedException('releaseInventory'));
  }

  // ── Helpers ─────────────────────────────────────────────────

  /**
   * FBA is read only when both locations are set and differ; the config policy
   * refuses anything else on save, this guards a config that bypassed it.
   */
  private fbaEnabled(): boolean {
    const fbaLocation = this.config.fbaLocationId;
    if (fbaLocation === undefined) {
      return false;
    }
    const raw = this.connection.config?.stockLocationOverride;
    const fbmLocation = typeof raw === 'string' ? raw.trim() : '';
    if (fbmLocation === '' || fbmLocation === fbaLocation) {
      this.logger.warn(
        `Amazon FBA stock not read: it needs a different stock location for the seller-fulfilled stock ` +
          `(connection: ${this.connection.id})`,
      );
      return false;
    }
    return true;
  }

  /** The listings that are the product's variants: the children of a parent, or the listing itself. */
  private async variantListings(productId: string): Promise<AmazonListingItem[]> {
    const sku = await this.requireExternalId(CORE_ENTITY_TYPE.Product, productId);
    const parent = await this.listings.read(sku);
    if (parent === null) {
      throw new MasterProductNotFoundError(productId, this.connection.id);
    }
    const { childSkus } = variationLinks(parent, this.marketplaceId);
    if (childSkus.length === 0) {
      return [parent];
    }
    const unread = childSkus.filter((child) => this.listings.peek(child) === undefined);
    if (unread.length > 0) {
      await this.listings.prefetch(unread);
    }
    const items: AmazonListingItem[] = [];
    for (const child of childSkus) {
      const item = await this.listings.read(child);
      if (item !== null) items.push(item);
    }
    if (items.length === 0) {
      // The parent still names its children, so this is an inferred absence:
      // an empty answer would retire every variant (#1689) of a live product.
      throw new Error(
        `Amazon variation parent ${sku} lists ${childSkus.length} child SKU(s) but none could be read ` +
          `(connection: ${this.connection.id})`,
      );
    }
    return items;
  }

  /** The SKU an adjustment writes: the named variant, or a standalone listing's own SKU. */
  private async adjustmentSku(adjustment: InventoryAdjustment): Promise<string> {
    if (adjustment.variantId !== undefined) {
      return this.requireExternalId(CORE_ENTITY_TYPE.ProductVariant, adjustment.variantId);
    }
    const sku = await this.requireExternalId(CORE_ENTITY_TYPE.Product, adjustment.productId);
    const item = await this.listings.read(sku);
    if (item !== null && variationLinks(item, this.marketplaceId).childSkus.length > 0) {
      throw new AmazonNotSupportedException(
        `adjusting the stock of variation parent ${sku} without naming the variant`,
      );
    }
    return sku;
  }

  private fbaInventory(productId: string, variantId: string, id: string, stock: AmazonFbaStock): Inventory {
    return {
      id,
      productId,
      variantId,
      locationId: this.config.fbaLocationId,
      quantity: stock.fulfillable + stock.reserved,
      reserved: stock.reserved,
      available: stock.fulfillable,
      ...(stock.updatedAt !== null ? { updatedAt: stock.updatedAt } : {}),
    };
  }

  private async mintIds(
    productId: string,
    skus: readonly string[],
  ): Promise<{ variants: Map<string, string>; inventories: Map<string, string> }> {
    const inventoryKeys = skus.flatMap((sku) => (this.fba !== null ? [`fbm:${sku}`, `fba:${sku}`] : [`fbm:${sku}`]));
    const [variants, inventories] = await Promise.all([
      this.identifierMapping.batchGetOrCreateInternalIds(
        skus.map((sku) => ({
          entityType: CORE_ENTITY_TYPE.ProductVariant,
          externalId: sku,
          connectionId: this.connection.id,
          context: {
            parentEntityType: CORE_ENTITY_TYPE.Product,
            parentInternalId: productId,
            metadata: { variantExternalId: sku },
          },
        })),
      ),
      this.identifierMapping.batchGetOrCreateInternalIds(
        inventoryKeys.map((key) => ({
          entityType: CORE_ENTITY_TYPE.Inventory,
          externalId: key,
          connectionId: this.connection.id,
          context: { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
        })),
      ),
    ]);
    return { variants, inventories };
  }

  private idFor(ids: Map<string, string>, externalId: string): string {
    const id = ids.get(`${externalId}:${this.connection.id}`);
    if (id === undefined) {
      throw new Error(`Identifier mapping returned no id for Amazon ${externalId} (connection: ${this.connection.id})`);
    }
    return id;
  }

  private async findExternalId(entityType: string, internalId: string): Promise<string | undefined> {
    const mappings = await this.identifierMapping.getExternalIds(entityType, internalId);
    return mappings.find((mapping) => mapping.connectionId === this.connection.id)?.externalId;
  }

  /** A missing mapping is a gap, not a deletion (port error contract): a plain, retryable error. */
  private async requireExternalId(entityType: string, internalId: string): Promise<string> {
    const externalId = await this.findExternalId(entityType, internalId);
    if (externalId === undefined) {
      throw new Error(
        `${entityType} ${internalId} has no Amazon SKU mapped on connection ${this.connection.id}`,
      );
    }
    return externalId;
  }

  /**
   * The quantity an adjustment starts from, and the unapplied chain it extends.
   * Amazon's read, unless patches this adapter wrote may still be unapplied:
   *   - the read equals the newest written quantity: Amazon applied it, the
   *     chain is dropped and the read is the base;
   *   - the read is the pre-chain quantity or an older written one: Amazon has
   *     not caught up and nothing else changed, the newest written is the base;
   *   - the listing carries an error on its stock attribute: an accepted patch
   *     failed, the chain is dropped and the read is the base;
   *   - anything else: Amazon changed the stock itself (an FBM order) on top of
   *     the pre-chain quantity, and that change is applied to the newest
   *     written quantity. A sale landing on top of an already-applied earlier
   *     patch is read the same way, which is the residual ambiguity.
   * A cache failure falls back to Amazon's read.
   */
  private async stockBase(
    sku: string,
    read: number,
    stockIssue: boolean,
  ): Promise<{ base: number; pending: AmazonPendingStockWrite | null }> {
    if (this.cache === undefined) return { base: read, pending: null };
    const key = this.pendingWriteCacheKey(sku);
    try {
      const pending = await this.cache.get<AmazonPendingStockWrite>(key);
      const written = pending?.writtenQuantities ?? [];
      const newest = written[written.length - 1];
      if (pending === null || newest === undefined) return { base: read, pending: null };
      if (stockIssue) {
        // Amazon reports an error on the stock attribute: an accepted patch
        // failed, so the written quantities never applied. Amazon's read is the truth.
        this.logger.warn(
          `Amazon listing ${sku} reports a stock error; dropping the unapplied patch to ${newest} ` +
            `and adjusting from ${read} (connection: ${this.connection.id})`,
        );
        await this.cache.delete(key);
        return { base: read, pending: null };
      }
      if (read === newest) {
        await this.cache.delete(key);
        return { base: read, pending: null };
      }
      const base =
        read === pending.readQuantity || written.includes(read)
          ? newest
          : Math.max(0, newest + (read - pending.readQuantity));
      this.logger.log(
        `Amazon listing ${sku} reads ${read} while a stock patch to ${newest} may be unapplied; ` +
          `adjusting from ${base} (connection: ${this.connection.id})`,
      );
      return { base, pending };
    } catch (error) {
      this.logger.warn(
        `Amazon pending stock write unreadable for listing ${sku}; adjusting from Amazon's read ` +
          `(connection: ${this.connection.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return { base: read, pending: null };
    }
  }

  /** Best effort: the patch already landed, so a cache failure must not fail the adjustment. */
  private async rememberPendingWrite(
    sku: string,
    read: number,
    pending: AmazonPendingStockWrite | null,
    written: number,
  ): Promise<void> {
    if (this.cache === undefined) return;
    const next: AmazonPendingStockWrite =
      pending === null
        ? { readQuantity: read, writtenQuantities: [written] }
        : {
            readQuantity: pending.readQuantity,
            writtenQuantities: [...pending.writtenQuantities, written].slice(-PENDING_STOCK_WRITE_CHAIN_LIMIT),
          };
    try {
      await this.cache.set(this.pendingWriteCacheKey(sku), next, PENDING_STOCK_WRITE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(
        `Amazon pending stock write not remembered for listing ${sku} (connection: ${this.connection.id}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private pendingWriteCacheKey(sku: string): string {
    return `amazon:inventory-pending-write:${this.connection.id}:${sku}`;
  }

  private idempotencySupport(adjustment: InventoryAdjustment): InventoryIdempotencySupport {
    if (!adjustment.idempotencyKey) return 'not_requested';
    return this.cache === undefined ? 'unsupported' : 'honoured';
  }

  private idempotencyCacheKey(key: string): string {
    return `amazon:inventory-adjustment:${this.connection.id}:${key}`;
  }

  private async hasAppliedKey(key: string | undefined): Promise<boolean> {
    if (!key || this.cache === undefined) return false;
    return (await this.cache.get<true>(this.idempotencyCacheKey(key))) === true;
  }

  private async rememberAppliedKey(key: string | undefined): Promise<void> {
    if (!key || this.cache === undefined) return;
    await this.cache.set(this.idempotencyCacheKey(key), true, ADJUSTMENT_IDEMPOTENCY_TTL_SECONDS);
  }
}

/** Whether Amazon reports an error on the listing's seller-fulfilled stock attribute. */
function hasStockIssue(item: AmazonListingItem): boolean {
  return (item.issues ?? []).some(
    (issue) => issue.severity === 'ERROR' && (issue.attributeNames ?? []).includes(STOCK_ATTRIBUTE),
  );
}
