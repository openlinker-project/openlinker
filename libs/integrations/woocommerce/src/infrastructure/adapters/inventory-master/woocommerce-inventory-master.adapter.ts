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
import { MasterProductNotFoundError } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceNotSupportedException } from '../../../domain/exceptions/woocommerce-not-supported.exception';
import { WooCommerceInvalidIdentifierException } from '../../../domain/exceptions/woocommerce-invalid-identifier.exception';
import { fetchAllPages, toPositiveInt } from '../../utils/woocommerce-utils';
import { buildSyntheticVariantExternalId } from '../../mappers/woocommerce-variant-id';
import {
  DEFAULT_UNMANAGED_STOCK_QUANTITY,
  type WooCommerceConnectionConfig,
} from '../../../domain/types/woocommerce-config.types';
import type {
  WooCommerceProduct,
  WooCommerceProductVariation,
} from '../product-master/woocommerce-product.types';

export class WooCommerceInventoryMasterAdapter implements InventoryMasterPort {
  private readonly logger = new Logger(WooCommerceInventoryMasterAdapter.name);

  /**
   * Per-connection fallback quantity for unmanaged-stock (`manage_stock=false`)
   * in-stock products. Resolved once from `connection.config.inventory`, falling
   * back to DEFAULT_UNMANAGED_STOCK_QUANTITY. The shape validator guarantees a
   * configured value is a non-negative integer.
   */
  private readonly unmanagedStockQuantity: number;

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connection: Connection,
  ) {
    const config = (connection.config ?? {}) as Partial<WooCommerceConnectionConfig>;
    this.unmanagedStockQuantity =
      config.inventory?.unmanagedStockQuantity ?? DEFAULT_UNMANAGED_STOCK_QUANTITY;
  }

  // ─── InventoryMasterPort ──────────────────────────────────────────────────

  async listInventory(productId: string): Promise<Inventory[]> {
    this.logger.debug(`Listing inventory for product: ${productId} (connection: ${this.connection.id})`);

    // Resolved OUTSIDE the translating try on purpose: a missing mapping is a
    // mapping gap, not a master-side deletion, so it must not reach the
    // not-found translation below (see resolveWcProductId).
    const wcId = await this.resolveWcProductId(productId);

    try {
      let product: WooCommerceProduct;
      try {
        product = await this.httpClient.get<WooCommerceProduct>(`/wp-json/wc/v3/products/${wcId}`);
      } catch (err) {
        if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
          throw new WooCommerceResourceNotFoundException(
            `WooCommerce product ${wcId} not found (deleted?)`,
            'Product',
            productId,
            this.connection.id,
          );
        }
        throw err;
      }

      // Must be awaited, not just returned - a bare `return this.listVariableInventory(...)`
      // hands the promise straight to the caller without the surrounding try
      // ever observing its rejection, so the outer catch below would never
      // fire for an error raised inside it (#1688).
      if (product.type === 'variable') {
        return await this.listVariableInventory(productId, wcId, product);
      }
      return await this.listSimpleInventory(productId, wcId, product);
    } catch (error) {
      // Translate a platform-reported product absence (a 404 on the product GET
      // or on the variations page) into the neutral core error so core services
      // can distinguish deletion from a transient failure (#1688, mirrors the
      // product-master adapter's #1599 translation). Scoped to the platform
      // calls only — a missing mapping (resolved above) and a corrupted mapping
      // (WooCommerceInvalidIdentifierException) are deliberately excluded.
      if (error instanceof WooCommerceResourceNotFoundException) {
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw error;
    }
  }

  async getInventory(productId: string, _locationId?: string): Promise<Inventory> {
    this.logger.debug(`Getting inventory for product: ${productId} (connection: ${this.connection.id})`);
    // locationId is always undefined for WC (single-location at v1)
    const rows = await this.listInventory(productId);
    // Deliberately NOT a MasterProductNotFoundError: an empty row set means the
    // product resolved at the master but has no stock-bearing entry (a variable
    // product with zero variations), which is not a deletion. Both read methods
    // agree on the same contract — only a platform-reported *product* absence
    // becomes the neutral deletion error; anything inferred stays a platform
    // exception (mirrors the PrestaShop adapter's zero-stock-rows probe).
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
      return await this.adjustVariationInventory(adjustment, wcId, adjustment.variantId);
    }

    return await this.adjustSimpleInventory(adjustment, wcId, product);
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

  /**
   * Resolves the effective stock quantity, honouring WC's manage_stock flag.
   *
   * WC manage_stock=false products do not track a numeric quantity — the
   * product is either in-stock or out-of-stock:
   *   - manage_stock=false AND stock_status='instock'  → per-connection cap
   *     (`inventory.unmanagedStockQuantity`, default DEFAULT_UNMANAGED_STOCK_QUANTITY).
   *     Master inventory is authoritative, so reporting 0 here would de-list a
   *     sellable product on every marketplace — the cap stands in for "plenty".
   *   - manage_stock=false AND stock_status≠'instock'  → 0 (out-of-stock)
   * Managed stock returns the real numeric quantity.
   */
  private resolveStockQuantity(
    stockQuantity: number | null | undefined,
    manageStock: boolean | undefined,
    stockStatus: string | undefined,
  ): number {
    if (manageStock === false) {
      return stockStatus === 'instock' ? this.unmanagedStockQuantity : 0;
    }
    return parseStockQuantity(stockQuantity);
  }

  /**
   * Neither failure mode here is a master-side deletion, and both are kept out
   * of listInventory's not-found translation (which is scoped to the platform
   * calls only):
   *
   * - No mapping for this connection: a mapping gap — the product was never
   *   mapped here (or was mapped under a different connection). Classifying it
   *   as "deleted" would stale a still-live product's inventory and terminalise
   *   the job as `business_failure` (no retry), so it stays a retryable,
   *   diagnosable platform exception and is logged with the discriminator.
   * - An externalId that fails to parse as a positive integer: a corrupted
   *   mapping, i.e. a data-integrity bug, left as
   *   WooCommerceInvalidIdentifierException rather than folded into
   *   WooCommerceResourceNotFoundException.
   */
  private async resolveWcProductId(productId: string): Promise<number> {
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      productId,
    );
    const mapping = externalIds.find((e) => e.connectionId === this.connection.id);
    if (!mapping) {
      this.logger.warn(
        `master_inventory_mapping_gap product=${productId} connection=${this.connection.id} — no external ID mapping; NOT classified as a master deletion`,
      );
      throw new WooCommerceResourceNotFoundException(
        `Product ${productId} is not mapped for connection ${this.connection.id}`,
        'Product',
        productId,
        this.connection.id,
      );
    }
    return toPositiveInt(mapping.externalId, 'product id');
  }

  private async listSimpleInventory(
    productId: string,
    wcId: number,
    product: WooCommerceProduct,
  ): Promise<Inventory[]> {
    const syntheticExternalId = buildSyntheticVariantExternalId(wcId);
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
      this.resolveStockQuantity(product.stock_quantity, product.manage_stock, product.stock_status),
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
    let variations: WooCommerceProductVariation[];
    try {
      variations = await fetchAllPages<WooCommerceProductVariation>(
        `/wp-json/wc/v3/products/${wcId}/variations`,
        this.httpClient,
        this.logger,
      );
    } catch (err) {
      // Mirrors the initial product GET's translation (top of listInventory) -
      // the product can be deleted in the window between that GET and this
      // fetch, and without this the race stays an untranslated, retryable
      // error instead of the neutral deletion signal (#1688).
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        throw new WooCommerceResourceNotFoundException(
          `WooCommerce product ${wcId} variations not found (deleted?)`,
          'Product',
          productId,
          this.connection.id,
        );
      }
      throw err;
    }

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
      return mapToInventory(this.resolveStockQuantity(v.stock_quantity, v.manage_stock, v.stock_status), productId, variantId, inventoryId);
    });
  }

  private async adjustSimpleInventory(
    adjustment: InventoryAdjustment,
    wcId: number,
    product: WooCommerceProduct,
  ): Promise<Inventory> {
    const current = this.resolveStockQuantity(product.stock_quantity, product.manage_stock, product.stock_status);
    const newQuantity = Math.max(0, current + adjustment.quantity);

    await this.httpClient.put(`/wp-json/wc/v3/products/${wcId}`, {
      stock_quantity: newQuantity,
      manage_stock: true,
    });

    // Idempotent — returns existing mapping if already created by listInventory
    const [variantId, inventoryId] = await Promise.all([
      this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.ProductVariant,
        buildSyntheticVariantExternalId(wcId),
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

    const current = this.resolveStockQuantity(variation.stock_quantity, variation.manage_stock, variation.stock_status);
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
