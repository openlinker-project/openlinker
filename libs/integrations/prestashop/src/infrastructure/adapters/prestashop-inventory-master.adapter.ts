/**
 * PrestaShop Inventory Master Adapter
 *
 * Implements InventoryMasterPort for PrestaShop WebService API. Provides read-only
 * access to PrestaShop inventory/stock levels. Write operations throw NotSupportedException.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {InventoryMasterPort}
 */
import { InventoryMasterPort, Inventory } from '@openlinker/core/inventory';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { IPrestashopInventoryMapper, PrestashopStockAvailable } from '../mappers/prestashop.mapper.interface';
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
    private readonly connection: Connection,
  ) {}

  async getInventory(productId: string, _locationId?: string): Promise<Inventory> {
    this.logger.debug(`Getting inventory for product: ${productId} (connection: ${this.connection.id})`);

    // Resolve internal ID → external ID
    const externalIds = await this.identifierMapping.getExternalIds('Product', productId);
    const prestashopProductId = externalIds.find((e: { connectionId: string }) => e.connectionId === this.connection.id);

    if (!prestashopProductId) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const error = new PrestashopResourceNotFoundException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connection.id})`,
        'Product',
        productId,
        this.connection.id,
      );
      throw error;
    }

    // Fetch stock_available for product (id_product_attribute = 0 for product stock)
    const stockRecords = await this.httpClient.listResources<PrestashopStockAvailable>(
      'stock_availables',
      {
        custom: {
          id_product: prestashopProductId.externalId,
          id_product_attribute: 0, // Product stock, not variant
        },
      },
    );

    if (stockRecords.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const error = new PrestashopResourceNotFoundException(
        `Inventory not found for product: ${productId}`,
        'Inventory',
        productId,
        this.connection.id,
      );
      throw error;
    }

    // Use first stock record (should be only one for product stock)
    const stockRecord = stockRecords[0];

    // Map to OpenLinker schema
    const mapped = this.inventoryMapper.mapInventory(stockRecord, productId);

    // Get or create internal ID for inventory
    const internalId = await this.identifierMapping.getOrCreateInternalId(
      'Inventory',
      String(stockRecord.id),
      this.connection.id,
      {
        parentEntityType: 'Product',
        parentInternalId: productId,
      },
    );

    return {
      ...mapped,
      id: internalId,
    };
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    const inventory = await this.getInventory(productId, locationId);
    return inventory.available;
  }

  // Write operations - not supported in MVP
  adjustInventory(_adjustment: import('@openlinker/core/inventory').InventoryAdjustment): Promise<Inventory> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const error = new PrestashopNotSupportedException(
      'Inventory adjustment is not supported in MVP. PrestaShop WebService API does not support stock updates in MVP scope.',
      'adjustInventory',
      'PrestaShop admin interface',
    );
    return Promise.reject(error);
  }

  reserveInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const error = new PrestashopNotSupportedException(
      'Inventory reservation is not supported in MVP. PrestaShop WebService API does not support reservation operations.',
      'reserveInventory',
      'PrestaShop admin interface',
    );
    return Promise.reject(error);
  }

  releaseInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const error = new PrestashopNotSupportedException(
      'Inventory release is not supported in MVP. PrestaShop WebService API does not support release operations.',
      'releaseInventory',
      'PrestaShop admin interface',
    );
    return Promise.reject(error);
  }
}

