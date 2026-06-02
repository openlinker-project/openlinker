/**
 * WooCommerce Inventory Master Adapter
 *
 * Implements InventoryMasterPort for WooCommerce REST API v3.
 * Emits one variant-keyed Inventory row per product variant, matching the
 * #823 PrestaShop pattern:
 *   - Simple products  → one row keyed to the synthetic variant `product:{wcId}`
 *   - Variable products → one row per variation, keyed to the variation's internal ID
 *
 * Write semantics: WC REST exposes no delta primitive — adjustInventory uses
 * a non-atomic read-current → compute → PUT pattern. Documented limitation at v1.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/inventory-master
 * @implements {InventoryMasterPort}
 */
import type {
  InventoryMasterPort,
  Inventory,
  InventoryAdjustment,
} from '@openlinker/core/inventory';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceNotSupportedException } from '../../../domain/exceptions/woocommerce-not-supported.exception';
import { fetchAllPages } from '../../utils/woocommerce-utils';
import type {
  WooCommerceProduct,
  WooCommerceProductVariation,
} from '../product-master/woocommerce-product.types';

export class WooCommerceInventoryMasterAdapter implements InventoryMasterPort {
  private readonly logger = new Logger(WooCommerceInventoryMasterAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connection: Connection,
  ) {}

  // ─── InventoryMasterPort ──────────────────────────────────────────────────

  async listInventory(productId: string): Promise<Inventory[]> {
    this.logger.debug(`Listing inventory for product: ${productId} (connection: ${this.connection.id})`);

    const wcId = await this.resolveWcProductId(productId);
    const product = await this.httpClient.get<WooCommerceProduct>(`/wp-json/wc/v3/products/${wcId}`);

    if (product.type === 'variable') {
      return this.listVariableInventory(productId, wcId, product);
    }
    return this.listSimpleInventory(productId, wcId, product);
  }

  async getInventory(productId: string, _locationId?: string): Promise<Inventory> {
    // locationId is always undefined for WC (single-location at v1)
    const rows = await this.listInventory(productId);
    if (rows.length === 0) {
      throw new WooCommerceResourceNotFoundException(
        `No inventory found for product ${productId} on connection ${this.connection.id}`,
        'Inventory',
        productId,
        this.connection.id,
      );
    }
    // Variable products: returns first variation's row (best-effort aggregate;
    // callers needing per-variant precision must use listInventory).
    return rows[0];
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    const inv = await this.getInventory(productId, locationId);
    return inv.available;
  }

  async adjustInventory(adjustment: InventoryAdjustment): Promise<Inventory> {
    this.logger.debug(`Adjusting inventory for product: ${adjustment.productId} (connection: ${this.connection.id})`);

    const wcId = await this.resolveWcProductId(adjustment.productId);
    const product = await this.httpClient.get<WooCommerceProduct>(`/wp-json/wc/v3/products/${wcId}`);

    if (product.type === 'variable') {
      if (!adjustment.variantId) {
        throw new WooCommerceNotSupportedException(
          'adjustInventory without variantId on a variable product',
          'Specify adjustment.variantId to target a specific variation.',
        );
      }
      return this.adjustVariationInventory(adjustment, wcId, adjustment.variantId);
    }

    return this.adjustSimpleInventory(adjustment, wcId, product);
  }

  reserveInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(
      new WooCommerceNotSupportedException(
        'reserveInventory',
        'WooCommerce REST API does not expose inventory reservation. Use adjustInventory for absolute stock changes.',
      ),
    );
  }

  releaseInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(
      new WooCommerceNotSupportedException(
        'releaseInventory',
        'WooCommerce REST API does not expose inventory reservation. Use adjustInventory for absolute stock changes.',
      ),
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async resolveWcProductId(productId: string): Promise<number> {
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      productId,
    );
    const mapping = externalIds.find((e) => e.connectionId === this.connection.id);
    if (!mapping) {
      throw new WooCommerceResourceNotFoundException(
        `Product ${productId} is not mapped for connection ${this.connection.id}`,
        'Product',
        productId,
        this.connection.id,
      );
    }
    return Number(mapping.externalId);
  }

  private async listSimpleInventory(
    productId: string,
    wcId: number,
    product: WooCommerceProduct,
  ): Promise<Inventory[]> {
    const syntheticExternalId = `product:${wcId}`;
    const variantId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.ProductVariant,
      syntheticExternalId,
      this.connection.id,
      { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
    );
    const inventoryId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Inventory,
      `stock:${wcId}`,
      this.connection.id,
      { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
    );
    return [mapToInventory(product.stock_quantity, productId, variantId, inventoryId)];
  }

  private async listVariableInventory(
    productId: string,
    wcId: number,
    _product: WooCommerceProduct,
  ): Promise<Inventory[]> {
    const variations = await fetchAllPages<WooCommerceProductVariation>(
      `/wp-json/wc/v3/products/${wcId}/variations`,
      this.httpClient,
      this.logger,
    );

    if (variations.length === 0) return [];

    // Batch both lookups to avoid N sequential async calls
    const [variantIdMap, inventoryIdMap] = await Promise.all([
      this.identifierMapping.batchGetOrCreateInternalIds(
        variations.map((v) => ({
          entityType: CORE_ENTITY_TYPE.ProductVariant,
          externalId: String(v.id),
          connectionId: this.connection.id,
          context: { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
        })),
      ),
      this.identifierMapping.batchGetOrCreateInternalIds(
        variations.map((v) => ({
          entityType: CORE_ENTITY_TYPE.Inventory,
          externalId: `stock-var:${v.id}`,
          connectionId: this.connection.id,
          context: { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
        })),
      ),
    ]);

    return variations.map((v) =>
      mapToInventory(
        v.stock_quantity,
        productId,
        variantIdMap.get(String(v.id))!,
        inventoryIdMap.get(`stock-var:${v.id}`)!,
      ),
    );
  }

  private async adjustSimpleInventory(
    adjustment: InventoryAdjustment,
    wcId: number,
    product: WooCommerceProduct,
  ): Promise<Inventory> {
    const current = parseStockQuantity(product.stock_quantity);
    const newQuantity = Math.max(0, current + adjustment.quantity);

    await this.httpClient.put(`/wp-json/wc/v3/products/${wcId}`, {
      stock_quantity: newQuantity,
      manage_stock: true,
    });

    // Idempotent — returns existing mapping if already created by listInventory
    const [variantId, inventoryId] = await Promise.all([
      this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.ProductVariant,
        `product:${wcId}`,
        this.connection.id,
        { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: adjustment.productId },
      ),
      this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.Inventory,
        `stock:${wcId}`,
        this.connection.id,
        { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: adjustment.productId },
      ),
    ]);

    return mapToInventory(newQuantity, adjustment.productId, variantId, inventoryId);
  }

  private async adjustVariationInventory(
    adjustment: InventoryAdjustment,
    wcId: number,
    variantId: string,
  ): Promise<Inventory> {
    const variantExternalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.ProductVariant,
      variantId,
    );
    const variantMapping = variantExternalIds.find((e) => e.connectionId === this.connection.id);
    if (!variantMapping) {
      throw new WooCommerceResourceNotFoundException(
        `Variant ${variantId} is not mapped for connection ${this.connection.id}`,
        'ProductVariant',
        variantId,
        this.connection.id,
      );
    }
    const wcVariationId = Number(variantMapping.externalId);

    let variation: WooCommerceProductVariation;
    try {
      variation = await this.httpClient.get<WooCommerceProductVariation>(
        `/wp-json/wc/v3/products/${wcId}/variations/${wcVariationId}`,
      );
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        throw new WooCommerceResourceNotFoundException(
          `Variation ${wcVariationId} not found on product ${wcId}`,
          'ProductVariant',
          variantId,
          this.connection.id,
        );
      }
      throw err;
    }

    const current = parseStockQuantity(variation.stock_quantity);
    const newQuantity = Math.max(0, current + adjustment.quantity);

    await this.httpClient.put(`/wp-json/wc/v3/products/${wcId}/variations/${wcVariationId}`, {
      stock_quantity: newQuantity,
      manage_stock: true,
    });

    // Idempotent — returns existing mapping if already created by listInventory
    const inventoryId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Inventory,
      `stock-var:${wcVariationId}`,
      this.connection.id,
      { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: adjustment.productId },
    );

    return mapToInventory(newQuantity, adjustment.productId, variantId, inventoryId);
  }
}

// ─── Module-level helpers (not exported) ─────────────────────────────────────

function parseStockQuantity(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return Math.max(0, Number(raw));
}

function mapToInventory(
  stockQuantity: number | null | undefined,
  productId: string,
  variantId: string,
  inventoryId: string,
): Inventory {
  const quantity = parseStockQuantity(stockQuantity);
  return {
    id: inventoryId,
    productId,
    variantId,
    locationId: undefined,  // WC is single-location at v1
    quantity,
    reserved: 0,            // WC REST has no reservation concept
    available: quantity,    // available = quantity - reserved = quantity
    updatedAt: undefined,
  };
}
