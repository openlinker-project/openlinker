/**
 * Shoper Inventory Master Adapter
 *
 * Implements `InventoryMasterPort` over Shoper's REST API - the READ side.
 * `adjustInventory` (the only write) arrives with its own task and throws
 * `ShoperNotSupportedException` here; so do `reserveInventory` /
 * `releaseInventory`, which the port deprecates (ADR-061: no shipped master
 * implements a hold primitive).
 *
 * Variant model (SPIKE-3638 M1): `product-stocks` is the variant grain, so each
 * stock row is ONE `Inventory`, variant-keyed by the same `stock_id` the
 * `ProductMaster` already minted a `ProductVariant` for - the two capabilities
 * agree on what a variant is. Stock is pooled and location-less (ADR-058
 * decision 2) and Shoper has no reservation concept (`reserved` is 0).
 *
 * Three behaviours are load-bearing:
 *   - **Deletion** is reported where Shoper says so: when a product has no stock
 *     rows, it is read through the shared `ShoperProductReader`, so a 404
 *     carrying Shoper's own envelope becomes the neutral
 *     `MasterProductNotFoundError` (#1688) and nothing else does. A product that
 *     resolves but has no stock row is an INFERRED absence and raises the
 *     platform-native `ShoperStockNotFoundException` - from `listInventory` too,
 *     never an empty list: `MasterInventorySyncService` prunes on an empty
 *     response, which would stale every variant and pause its offers (#1689)
 *     for a product that still exists. Every Shoper product carries at least one
 *     stock row, so an empty answer is an anomaly, not a state to sync.
 *     The probe is spent only on that empty answer. Probing every product would
 *     double the sweep's request count (the regression the PrestaShop adapter
 *     removed), and a product that still lists stock rows is not gone.
 *   - **Multi-warehouse shops are refused**, not guessed at: with the module on,
 *     `product-stocks.stock` is not known to be the whole pool, and a wrong stock
 *     level is published to marketplaces.
 *   - **An unreadable stock level is an error, never 0**: a master sync that
 *     read a missing value as zero would zero a live offer (the #1689 primitive).
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/inventory-master
 * @implements {InventoryMasterPort}
 */
import type {
  Inventory,
  InventoryAdjustment,
  InventoryAdjustmentResult,
  InventoryMasterPort,
} from '@openlinker/core/inventory';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperVariantRequiredException } from '../../../domain/exceptions/shoper-variant-required.exception';
import { ShoperInvalidStockLevelException } from '../../../domain/exceptions/shoper-invalid-stock-level.exception';
import { ShoperNotSupportedException } from '../../../domain/exceptions/shoper-not-supported.exception';
import { ShoperStockNotFoundException } from '../../../domain/exceptions/shoper-stock-not-found.exception';
import { ShoperWarehousesNotSupportedException } from '../../../domain/exceptions/shoper-warehouses-not-supported.exception';
import type { ShoperStock } from '../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { fetchShoperStocks } from '../../http/shoper-stocks';
import {
  mapShoperStockToInventory,
  readShoperStockLevel,
} from '../../mappers/shoper-inventory.mapper';
import { resolveShoperExternalProductId } from '../../readers/shoper-product-id';
import type { ShoperProductReader } from '../../readers/shoper-product.reader';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';

export class ShoperInventoryMasterAdapter implements InventoryMasterPort {
  private readonly logger = new Logger(ShoperInventoryMasterAdapter.name);

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShoperShopContextProvider,
    private readonly productReader: ShoperProductReader,
    private readonly connection: Connection,
  ) {}

  // ─── Read methods ──────────────────────────────────────────────────────────

  /** One `Inventory` per stock row (variant), in `stock_id` order. */
  async listInventory(productId: string): Promise<Inventory[]> {
    const ctx = await this.shopContext.get();
    if (ctx.warehousesEnabled) {
      throw new ShoperWarehousesNotSupportedException(this.connection.id);
    }

    // Resolved first and OUTSIDE any translation: a missing mapping is a gap,
    // not a deletion (see `resolveShoperExternalProductId`).
    const externalId = await resolveShoperExternalProductId(
      this.identifierMapping,
      this.connection.id,
      productId,
    );

    const stocks = await this.fetchStocksOrClassifyDeletion(externalId, productId);
    if (stocks.length === 0) {
      // The deletion probe, spent only here. A product Shoper reports gone
      // raises the neutral error from the reader; one that still resolves is an
      // inferred absence and must not reach the sync as an empty list.
      await this.productReader.read(externalId, productId);
      throw new ShoperStockNotFoundException(productId, this.connection.id);
    }

    // Every level is checked before any id is minted: a row that cannot be
    // reported must not leave mappings behind for a variant it never synced.
    const levels = stocks.map((stock) => {
      const quantity = readShoperStockLevel(stock);
      if (quantity === null) {
        throw new ShoperInvalidStockLevelException(stock.stock_id, externalId, this.connection.id);
      }
      return quantity;
    });

    const [variantIds, inventoryIds] = await this.mintIds(
      productId,
      stocks.map((s) => s.stock_id),
    );

    return stocks.map((stock, index) => {
      const quantity = levels[index];
      const variantId = variantIds.get(`${stock.stock_id}:${this.connection.id}`);
      const inventoryId = inventoryIds.get(`stock:${stock.stock_id}:${this.connection.id}`);
      if (variantId === undefined || inventoryId === undefined) {
        throw new Error(
          `Missing internal id for Shoper stock ${stock.stock_id} on connection ${this.connection.id}`,
        );
      }
      return mapShoperStockToInventory(quantity, { productId, variantId, inventoryId });
    });
  }

  /**
   * For a multi-variant product this returns the FIRST row only - the same
   * contract the WooCommerce adapter documents. Callers needing per-variant
   * precision use `listInventory`.
   */
  async getInventory(productId: string, _locationId?: string): Promise<Inventory> {
    // `listInventory` never returns an empty list: it raises the inferred-absence
    // error itself, so the first row always exists.
    const [first] = await this.listInventory(productId);
    return first;
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    return (await this.getInventory(productId, locationId)).available;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * The product's stock rows. A live shop answers a filtered listing of a
   * deleted product with 200 and an empty list (verified on a trial shop), which
   * the caller probes. A 404 is not trusted as a deletion on its own either: the product itself is asked,
   * and only its answer can become the neutral error. If it still resolves, the
   * listing's 404 is rethrown untouched.
   */
  private async fetchStocksOrClassifyDeletion(
    externalId: string,
    productId: string,
  ): Promise<ShoperStock[]> {
    try {
      return await fetchShoperStocks(this.client, externalId, (count) =>
        this.logger.warn(
          `Shoper returned ${count} stock row(s) of another product while reading product ` +
            `${externalId}; dropped (connection: ${this.connection.id})`,
        ),
      );
    } catch (error) {
      if (error instanceof ShoperApiError && error.isResourceNotFound()) {
        await this.productReader.read(externalId, productId);
      }
      throw error;
    }
  }

  // ─── Not supported in this task ────────────────────────────────────────────

  /**
   * Read, add the delta, write the absolute result. Shoper's `PUT
   * /product-stocks/:id` takes an absolute `stock` and has no conditional write
   * or idempotency key (SPIKE-3638 M8/M9), so this is NOT atomic: a sale landing
   * between the read and the PUT is overwritten (the level Shoper holds afterwards is read
   * back and reported), and a retry after a lost
   * response applies the delta again. Reported honestly as `unsupported`.
   *
   * A delta taking stock below zero is clamped to 0 with a warning (the
   * PrestaShop behaviour), so less than the requested decrease is applied.
   */
  async adjustInventory(adjustment: InventoryAdjustment): Promise<InventoryAdjustmentResult> {
    const ctx = await this.shopContext.get();
    if (ctx.warehousesEnabled) {
      throw new ShoperWarehousesNotSupportedException(this.connection.id);
    }

    const externalId = await resolveShoperExternalProductId(
      this.identifierMapping,
      this.connection.id,
      adjustment.productId,
    );
    await this.productReader.read(externalId, adjustment.productId);

    const stocks = await this.fetchStocks(externalId);
    const stock = await this.pickStockRow(stocks, adjustment);

    const current = readShoperStockLevel(stock);
    if (current === null) {
      throw new ShoperNetworkError(
        `Shoper returned no readable stock level for stock ${stock.stock_id} of product ${externalId}`,
      );
    }

    // Ids are resolved BEFORE the write: failing after the PUT would report an
    // error (in doubt) for a change that definitely landed.
    const [variantIds, inventoryIds] = await this.mintIds(adjustment.productId, [stock.stock_id]);
    const variantId = variantIds.get(`${stock.stock_id}:${this.connection.id}`);
    const inventoryId = inventoryIds.get(`stock:${stock.stock_id}:${this.connection.id}`);
    if (variantId === undefined || inventoryId === undefined) {
      throw new Error(
        `Identifier mapping returned no id for Shoper stock ${stock.stock_id} of product ${externalId} ` +
          `(connection: ${this.connection.id})`,
      );
    }

    const requested = current + adjustment.quantity;
    const next = Math.max(0, requested);
    if (next !== requested) {
      this.logger.warn(
        `Shoper stock ${stock.stock_id} of product ${externalId} would go to ${requested}; ` +
          `clamped to 0 (connection: ${this.connection.id})`,
      );
    }
    if (adjustment.reason !== undefined) {
      this.logger.log(
        `Adjusting Shoper stock ${stock.stock_id} by ${adjustment.quantity} (${adjustment.reason}), ` +
          `${current} -> ${next} (connection: ${this.connection.id})`,
      );
    }

    await this.client.put(`/product-stocks/${encodeURIComponent(stock.stock_id)}`, { stock: next });

    const level = await this.readBackLevel(externalId, stock.stock_id, next);
    const inventory = mapShoperStockToInventory(level, {
      productId: adjustment.productId,
      variantId,
      inventoryId,
    });
    return {
      ...inventory,
      adjustmentOutcome: { disposition: 'applied', idempotency: 'unsupported', appliedAt: null },
    };
  }

  /**
   * The level Shoper holds after the write. The PUT is not atomic, so a
   * concurrent sale can make it differ from what was written; the real number is
   * what propagates to marketplaces. A failed read-back must not turn an
   * applied write into an error, so it falls back to the written level.
   */
  private async readBackLevel(externalId: string, stockId: string, written: number): Promise<number> {
    try {
      const row = (await this.fetchStocks(externalId)).find((s) => s.stock_id === stockId);
      const actual = row === undefined ? null : readShoperStockLevel(row);
      if (actual === null) {
        this.logger.warn(
          `Shoper stock ${stockId} of product ${externalId} unreadable after write; ` +
            `reporting the written level ${written} (connection: ${this.connection.id})`,
        );
        return written;
      }
      if (actual !== written) {
        this.logger.warn(
          `Shoper stock ${stockId} of product ${externalId} reads ${actual} after writing ${written}; ` +
            `a concurrent change was overwritten or applied (connection: ${this.connection.id})`,
        );
      }
      return actual;
    } catch (error) {
      this.logger.warn(
        `Shoper stock read-back failed for ${stockId} of product ${externalId}: ` +
          `${error instanceof Error ? error.message : String(error)}; reporting the written level ${written}`,
      );
      return written;
    }
  }

  private fetchStocks(externalId: string): Promise<ShoperStock[]> {
    return fetchShoperStocks(this.client, externalId, (count) =>
      this.logger.warn(
        `Shoper returned ${count} stock row(s) of another product while reading product ` +
          `${externalId}; dropped (connection: ${this.connection.id})`,
      ),
    );
  }

  private async mintIds(
    productId: string,
    stockIds: string[],
  ): Promise<[Map<string, string>, Map<string, string>]> {
    return Promise.all([
      this.identifierMapping.batchGetOrCreateInternalIds(
        stockIds.map((id) => ({
          entityType: CORE_ENTITY_TYPE.ProductVariant,
          externalId: id,
          connectionId: this.connection.id,
          context: {
            parentEntityType: CORE_ENTITY_TYPE.Product,
            parentInternalId: productId,
            metadata: { variantExternalId: id },
          },
        })),
      ),
      this.identifierMapping.batchGetOrCreateInternalIds(
        stockIds.map((id) => ({
          entityType: CORE_ENTITY_TYPE.Inventory,
          externalId: `stock:${id}`,
          connectionId: this.connection.id,
          context: { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
        })),
      ),
    ]);
  }

  private async pickStockRow(
    stocks: ShoperStock[],
    adjustment: InventoryAdjustment,
  ): Promise<ShoperStock> {
    if (adjustment.variantId !== undefined) {
      const mappings = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.ProductVariant,
        adjustment.variantId,
      );
      const variantExternal = mappings.find((m) => m.connectionId === this.connection.id);
      const match = stocks.find((s) => s.stock_id === variantExternal?.externalId);
      if (match === undefined) {
        throw new ShoperStockNotFoundException(adjustment.productId, this.connection.id);
      }
      return match;
    }
    if (stocks.length === 1) {
      return stocks[0];
    }
    // Several variants and none named: writing the first would move stock of the
    // wrong variant, so refuse rather than guess.
    if (stocks.length === 0) {
      throw new ShoperStockNotFoundException(adjustment.productId, this.connection.id);
    }
    throw new ShoperVariantRequiredException(adjustment.productId, this.connection.id);
  }

  reserveInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(new ShoperNotSupportedException('reserveInventory'));
  }

  releaseInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(new ShoperNotSupportedException('releaseInventory'));
  }
}
