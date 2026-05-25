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
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
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

    // Resolve internal ID → external ID
    const externalIds = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
    const prestashopProductId = externalIds.find(
      (e: { connectionId: string }) => e.connectionId === this.connection.id
    );

    if (!prestashopProductId) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
      const error = new PrestashopResourceNotFoundException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connection.id})`,
        CORE_ENTITY_TYPE.Product,
        productId,
        this.connection.id
      );
      throw error;
    }

    // Simple products (no combinations) are stored with a synthetic externalId
    // of the form `product:<id>` by the product adapter. Strip the prefix so
    // the stock_availables filter receives the plain numeric PrestaShop product ID.
    const rawExternalId = prestashopProductId.externalId;
    const psProductId = rawExternalId.startsWith('product:')
      ? rawExternalId.slice('product:'.length)
      : rawExternalId;

    // The identifier mapping stores combination IDs under entityType='Product', so
    // psProductId is either a plain product ID (simple products) or a combination ID.
    // Try product-level stock first (id_product_attribute=0); if empty, the external ID
    // is a combination ID and its stock record is keyed by id_product_attribute instead.
    let stockRecords = await this.httpClient.listResources<PrestashopStockAvailable>(
      'stock_availables',
      {
        custom: {
          id_product: psProductId,
          id_product_attribute: 0,
        },
      }
    );

    if (stockRecords.length === 0) {
      stockRecords = await this.httpClient.listResources<PrestashopStockAvailable>(
        'stock_availables',
        {
          custom: {
            id_product_attribute: psProductId,
          },
        }
      );
    }

    if (stockRecords.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
      const error = new PrestashopResourceNotFoundException(
        `Inventory not found for product: ${productId}`,
        CORE_ENTITY_TYPE.Inventory,
        productId,
        this.connection.id
      );
      throw error;
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

    // Resolve internal product ID → PrestaShop product ID.
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      productId
    );
    const prestashopProductId = externalIds.find(
      (e: { connectionId: string }) => e.connectionId === this.connection.id
    );

    if (!prestashopProductId) {
      throw new PrestashopResourceNotFoundException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connection.id})`,
        CORE_ENTITY_TYPE.Product,
        productId,
        this.connection.id
      );
    }

    const rawExternalId = prestashopProductId.externalId;
    const psProductId = rawExternalId.startsWith('product:')
      ? rawExternalId.slice('product:'.length)
      : rawExternalId;

    // All stock rows for the product: the id_product_attribute=0 aggregate plus
    // one row per combination.
    const stockRecords = await this.httpClient.listResources<PrestashopStockAvailable>(
      'stock_availables',
      { custom: { id_product: psProductId } }
    );

    if (stockRecords.length === 0) {
      throw new PrestashopResourceNotFoundException(
        `Inventory not found for product: ${productId}`,
        CORE_ENTITY_TYPE.Inventory,
        productId,
        this.connection.id
      );
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
