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
 *   - **Deletion** is reported where Shoper says so: the product is read through
 *     the shared `ShoperProductReader`, so a 404 carrying Shoper's own envelope
 *     becomes the neutral `MasterProductNotFoundError` (#1688) and nothing else
 *     does. A product that resolves but has no stock row is an INFERRED absence
 *     and stays a platform-native error.
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

import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import { ShoperNotSupportedException } from '../../../domain/exceptions/shoper-not-supported.exception';
import { ShoperStockNotFoundException } from '../../../domain/exceptions/shoper-stock-not-found.exception';
import { ShoperWarehousesNotSupportedException } from '../../../domain/exceptions/shoper-warehouses-not-supported.exception';
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

    // The deletion probe. A product Shoper reports gone raises the neutral
    // error here; the stock listing below would only say "no rows", which is
    // not the same claim.
    await this.productReader.read(externalId, productId);

    const stocks = await fetchShoperStocks(this.client, externalId, (count) =>
      this.logger.warn(
        `Shoper returned ${count} stock row(s) of another product while reading product ` +
          `${externalId}; dropped (connection: ${this.connection.id})`,
      ),
    );
    if (stocks.length === 0) {
      return [];
    }

    const [variantIds, inventoryIds] = await Promise.all([
      this.identifierMapping.batchGetOrCreateInternalIds(
        stocks.map((s) => ({
          entityType: CORE_ENTITY_TYPE.ProductVariant,
          externalId: s.stock_id,
          connectionId: this.connection.id,
          context: {
            parentEntityType: CORE_ENTITY_TYPE.Product,
            parentInternalId: productId,
            metadata: { variantExternalId: s.stock_id },
          },
        })),
      ),
      this.identifierMapping.batchGetOrCreateInternalIds(
        stocks.map((s) => ({
          entityType: CORE_ENTITY_TYPE.Inventory,
          externalId: `stock:${s.stock_id}`,
          connectionId: this.connection.id,
          context: { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
        })),
      ),
    ]);

    return stocks.map((stock) => {
      const quantity = readShoperStockLevel(stock);
      if (quantity === null) {
        throw new ShoperNetworkError(
          `Shoper returned no readable stock level for stock ${stock.stock_id} of product ${externalId}`,
        );
      }
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
    const rows = await this.listInventory(productId);
    // Not the neutral not-found: an empty row set means the product resolved but
    // carries no stock entry, which is an inferred absence, not a deletion.
    if (rows.length === 0) {
      throw new ShoperStockNotFoundException(productId, this.connection.id);
    }
    return rows[0];
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    return (await this.getInventory(productId, locationId)).available;
  }

  // ─── Not supported in this task ────────────────────────────────────────────

  adjustInventory(_adjustment: InventoryAdjustment): Promise<InventoryAdjustmentResult> {
    return Promise.reject(new ShoperNotSupportedException('adjustInventory'));
  }

  reserveInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(new ShoperNotSupportedException('reserveInventory'));
  }

  releaseInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(new ShoperNotSupportedException('releaseInventory'));
  }
}
