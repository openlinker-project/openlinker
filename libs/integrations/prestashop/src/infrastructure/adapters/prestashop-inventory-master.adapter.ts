/**
 * PrestaShop Inventory Master Adapter
 *
 * Implements InventoryMasterPort for PrestaShop WebService API. Provides read-only
 * access to PrestaShop inventory/stock levels. Write operations throw NotSupportedException.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {InventoryMasterPort}
 */
import type {
  InventoryMasterPort,
  Inventory,
  InventoryAdjustment,
} from '@openlinker/core/inventory';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type {
  IPrestashopWebserviceClient,
  PrestashopQueryFilters,
} from '../http/prestashop-webservice.client.interface';
import type {
  IPrestashopInventoryMapper,
  PrestashopStockAvailable,
} from '../mappers/prestashop.mapper.interface';
import {
  PrestashopNotSupportedException,
  PrestashopResourceNotFoundException,
} from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';

/**
 * PrestaShop Inventory Master Adapter
 *
 * Read-only adapter for PrestaShop inventory operations.
 */
export class PrestashopInventoryMasterAdapter implements InventoryMasterPort {
  private readonly logger = new Logger(PrestashopInventoryMasterAdapter.name);

  constructor(
    private readonly httpClient: IPrestashopWebserviceClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly inventoryMapper: IPrestashopInventoryMapper,
    private readonly connection: Connection
  ) {}

  async getInventory(productId: string, _locationId?: string): Promise<Inventory> {
    this.logger.debug(
      `Getting inventory for product: ${productId} (connection: ${this.connection.id})`
    );

    const psProductId = await this.resolvePrestashopProductId(productId);

    // The identifier mapping stores combination IDs under entityType='Product', so
    // psProductId is either a plain product ID (simple products) or a combination ID.
    // Try product-level stock first (id_product_attribute=0); if empty, the external ID
    // is a combination ID and its stock record is keyed by id_product_attribute instead.
    let stockRecords = await this.listStockRecords(productId, {
      custom: { id_product: psProductId, id_product_attribute: 0 },
    });

    if (stockRecords.length === 0) {
      stockRecords = await this.listStockRecords(productId, {
        custom: { id_product_attribute: psProductId },
      });
    }

    if (stockRecords.length === 0) {
      await this.throwForAbsentStockRecords(productId, psProductId);
    }

    // Use first stock record (should be only one for product/combination stock)
    const stockRecord = stockRecords[0];

    // Map to OpenLinker schema
    const mapped = this.inventoryMapper.mapInventory(stockRecord, productId);

    // Get or create internal ID for inventory
    const internalId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Inventory,
      String(stockRecord.id),
      this.connection.id,
      {
        parentEntityType: CORE_ENTITY_TYPE.Product,
        parentInternalId: productId,
      }
    );

    return {
      ...mapped,
      id: internalId,
    };
  }

  async listInventory(productId: string): Promise<Inventory[]> {
    this.logger.debug(
      `Listing inventory for product: ${productId} (connection: ${this.connection.id})`
    );

    const psProductId = await this.resolvePrestashopProductId(productId);

    // All stock rows for the product: the id_product_attribute=0 aggregate plus
    // one row per combination.
    const stockRecords = await this.listStockRecords(productId, {
      custom: { id_product: psProductId },
    });

    if (stockRecords.length === 0) {
      await this.throwForAbsentStockRecords(productId, psProductId);
    }

    const combinationRows = stockRecords.filter(
      (record) => Number(record.id_product_attribute) !== 0
    );

    // Multi-variant: one variant-keyed Inventory per combination. The
    // id_product_attribute=0 aggregate is ignored — the per-combination rows
    // carry the real per-variant stock.
    if (combinationRows.length > 0) {
      const inventories: Inventory[] = [];
      for (const record of combinationRows) {
        inventories.push(
          await this.toVariantInventory(record, productId, String(record.id_product_attribute))
        );
      }
      return inventories;
    }

    // Simple product: the single aggregate row maps to the deterministic
    // synthetic variant (mirrors the product adapter's `product:<id>` scheme).
    return [await this.toVariantInventory(stockRecords[0], productId, `product:${psProductId}`)];
  }

  /**
   * Resolve the internal product ID to its PrestaShop-side external ID.
   *
   * A missing mapping is deliberately NOT translated to
   * `MasterProductNotFoundError`: the product has simply never been mapped for
   * this connection (or was mapped under a different one), which is a mapping
   * gap, not a master-side deletion. Classifying it as a deletion would stale
   * every inventory row of a still-live product and terminalise the job as
   * `business_failure` (no retry), so it stays the platform exception —
   * retryable and diagnosable — and is logged with the discriminator. Mirrors
   * the same carve-out the WooCommerce adapter makes for a corrupted mapping.
   *
   * Simple products (no combinations) are stored with a synthetic externalId of
   * the form `product:<id>` by the product adapter. The prefix is stripped so
   * the stock_availables filter receives the plain numeric PrestaShop ID.
   */
  private async resolvePrestashopProductId(productId: string): Promise<string> {
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      productId
    );
    const prestashopProductId = externalIds.find(
      (e: { connectionId: string }) => e.connectionId === this.connection.id
    );

    if (!prestashopProductId) {
      this.logger.warn(
        `master_inventory_mapping_gap product=${productId} connection=${this.connection.id} — no external ID mapping; NOT classified as a master deletion`
      );
      throw new PrestashopResourceNotFoundException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connection.id})`,
        CORE_ENTITY_TYPE.Product,
        productId,
        this.connection.id
      );
    }

    const rawExternalId = prestashopProductId.externalId;
    return rawExternalId.startsWith('product:')
      ? rawExternalId.slice('product:'.length)
      : rawExternalId;
  }

  /**
   * Single stock_availables read with the not-found translation narrowed to the
   * platform call itself: only a not-found reported by PrestaShop for the
   * requested resource becomes the neutral `MasterProductNotFoundError` (#1688,
   * mirrors the product-master adapter's #1599 translation). Shared by both
   * read methods so the port's two reads agree on what a not-found means to a
   * caller, without a wide try wrapping unrelated throw sites.
   */
  private async listStockRecords(
    productId: string,
    filters: PrestashopQueryFilters
  ): Promise<PrestashopStockAvailable[]> {
    try {
      return await this.httpClient.listResources<PrestashopStockAvailable>(
        'stock_availables',
        filters
      );
    } catch (error) {
      if (error instanceof PrestashopResourceNotFoundException) {
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw error;
    }
  }

  /**
   * Zero stock rows is an INFERENCE, not a platform deletion signal — PrestaShop
   * normally materialises a stock row per product, but "no rows" alone does not
   * distinguish a deleted product from a product whose stock rows are missing
   * for another reason. Probe the product resource to get the real signal:
   *
   * - product 404s ⇒ genuinely deleted at the master ⇒ neutral
   *   `MasterProductNotFoundError` (all rows staled, job terminalised).
   * - product still resolves ⇒ a data gap, not a deletion ⇒ the platform
   *   exception, so the job stays retryable and the row is not staled.
   *
   * Always throws.
   */
  private async throwForAbsentStockRecords(productId: string, psProductId: string): Promise<never> {
    try {
      await this.httpClient.getResource('products', psProductId);
    } catch (error) {
      if (error instanceof PrestashopResourceNotFoundException) {
        this.logger.warn(
          `master_inventory_master_deleted product=${productId} psProductId=${psProductId} connection=${this.connection.id} — product absent at the master`
        );
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw error;
    }

    this.logger.warn(
      `master_inventory_zero_stock_rows product=${productId} psProductId=${psProductId} connection=${this.connection.id} — product still resolves at the master; NOT classified as a deletion`
    );
    throw new PrestashopResourceNotFoundException(
      `Inventory not found for product: ${productId}`,
      CORE_ENTITY_TYPE.Inventory,
      productId,
      this.connection.id
    );
  }

  /**
   * Map one stock_available row to a variant-keyed Inventory: resolve the
   * PrestaShop combination (or synthetic) external id to the internal
   * ProductVariant id and mint the Inventory internal id. `getOrCreate` is
   * idempotent — it returns the variant mapping the product sync already
   * created, or self-reconciles if inventory sync runs first.
   */
  private async toVariantInventory(
    stockRecord: PrestashopStockAvailable,
    productId: string,
    variantExternalId: string
  ): Promise<Inventory> {
    const variantId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.ProductVariant,
      variantExternalId,
      this.connection.id,
      {
        parentEntityType: CORE_ENTITY_TYPE.Product,
        parentInternalId: productId,
        metadata: { variantExternalId },
      }
    );

    const mapped = this.inventoryMapper.mapInventory(stockRecord, productId, variantId);

    const internalId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Inventory,
      String(stockRecord.id),
      this.connection.id,
      {
        parentEntityType: CORE_ENTITY_TYPE.Product,
        parentInternalId: productId,
      }
    );

    return { ...mapped, id: internalId };
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    const inventory = await this.getInventory(productId, locationId);
    return inventory.available;
  }

  // Write operations - not supported in MVP
  adjustInventory(_adjustment: InventoryAdjustment): Promise<Inventory> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const error = new PrestashopNotSupportedException(
      'Inventory adjustment is not supported in MVP. PrestaShop WebService API does not support stock updates in MVP scope.',
      'adjustInventory',
      'PrestaShop admin interface'
    );
    return Promise.reject(error);
  }

  reserveInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const error = new PrestashopNotSupportedException(
      'Inventory reservation is not supported in MVP. PrestaShop WebService API does not support reservation operations.',
      'reserveInventory',
      'PrestaShop admin interface'
    );
    return Promise.reject(error);
  }

  releaseInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const error = new PrestashopNotSupportedException(
      'Inventory release is not supported in MVP. PrestaShop WebService API does not support release operations.',
      'releaseInventory',
      'PrestaShop admin interface'
    );
    return Promise.reject(error);
  }
}
