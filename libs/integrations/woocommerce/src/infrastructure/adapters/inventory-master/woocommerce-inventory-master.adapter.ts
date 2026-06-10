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
import { WooCommerceInvalidIdentifierException } from '../../../domain/exceptions/woocommerce-invalid-identifier.exception';
import { fetchAllPages, toPositiveInt } from '../../utils/woocommerce-utils';
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
    this.logger.debug(`Getting inventory for product: ${productId} (connection: ${this.connection.id})`);
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
    // For variable products: returns the first variation's row only.
    // Callers needing per-variant precision must use listInventory instead.
    return rows[0];
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    this.logger.debug(`Getting available quantity for product: ${productId} (connection: ${this.connection.id})`);
    const inv = await this.getInventory(productId, locationId);
    return inv.available;
  }

  // Non-atomic read-modify-write: reads current stock, computes new value, PUTs.
  // Race condition possible under concurrent updates. WC REST v3 has no atomic increment endpoint.
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
    try {
      return toPositiveInt(mapping.externalId, 'product id');
    } catch (err) {
      if (err instanceof WooCommerceInvalidIdentifierException) {
        throw new WooCommerceResourceNotFoundException(
          `Product mapping for ${productId} has invalid externalId "${mapping.externalId}" (not a positive integer)`,
          'Product',
          productId,
          this.connection.id,
        );
      }
      throw err;
    }
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
    return [mapToInventory(
      resolveStockQuantity(product.stock_quantity, product.manage_stock, product.stock_status),
      productId,
      variantId,
      inventoryId,
    )];
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

    return variations.map((v) => {
      // batchGetOrCreateInternalIds keys are composite "${externalId}:${connectionId}"
      const variantId = variantIdMap.get(`${String(v.id)}:${this.connection.id}`);
      const inventoryId = inventoryIdMap.get(`stock-var:${v.id}:${this.connection.id}`);
      if (!variantId) {
        throw new Error(
          `Missing variant internal ID for WC variation ${String(v.id)} on connection ${this.connection.id}`,
        );
      }
      if (!inventoryId) {
        throw new Error(
          `Missing inventory internal ID for WC variation ${String(v.id)} on connection ${this.connection.id}`,
        );
      }
      return mapToInventory(resolveStockQuantity(v.stock_quantity, v.manage_stock, v.stock_status), productId, variantId, inventoryId);
    });
  }

  private async adjustSimpleInventory(
    adjustment: InventoryAdjustment,
    wcId: number,
    product: WooCommerceProduct,
  ): Promise<Inventory> {
    const current = resolveStockQuantity(product.stock_quantity, product.manage_stock, product.stock_status);
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
    let wcVariationId: number;
    try {
      wcVariationId = toPositiveInt(variantMapping.externalId, 'variation id');
    } catch (err) {
      if (err instanceof WooCommerceInvalidIdentifierException) {
        throw new WooCommerceResourceNotFoundException(
          `Variant mapping for ${variantId} has invalid externalId "${variantMapping.externalId}" (not a positive integer)`,
          'ProductVariant',
          variantId,
          this.connection.id,
        );
      }
      throw err;
    }

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

    const current = resolveStockQuantity(variation.stock_quantity, variation.manage_stock, variation.stock_status);
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

/**
 * Resolves the effective stock quantity, honouring WC's manage_stock flag.
 *
 * WC manage_stock=false products: WC does not track a numeric quantity — the
 * product is either in-stock or out-of-stock. We represent this as a sentinel:
 *   - manage_stock=false AND stock_status='instock'  → 9999 (effectively unlimited)
 *   - manage_stock=false AND stock_status≠'instock'  → 0 (out-of-stock)
 *
 * TODO: confirm sentinel value 9999 with Piotr before shipping to production.
 * A dedicated "unmanaged" flag on the Inventory entity may be cleaner long-term.
 */
function resolveStockQuantity(
  stockQuantity: number | null | undefined,
  manageStock: boolean | undefined,
  stockStatus: string | undefined,
): number {
  if (manageStock === false) {
    // WC manage_stock=false products: unmanaged stock represented as 9999 sentinel.
    return stockStatus === 'instock' ? 9999 : 0;
  }
  return parseStockQuantity(stockQuantity);
}

function parseStockQuantity(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  return Math.max(0, Number(raw));
}

function mapToInventory(
  quantity: number,
  productId: string,
  variantId: string,
  inventoryId: string,
): Inventory {
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
