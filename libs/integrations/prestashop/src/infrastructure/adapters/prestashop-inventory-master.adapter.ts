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
import {
  derivePackAvailability,
  packComponentStockKey,
  packStockTypeDefersToShop,
  readPackDefinition,
  resolvePackStockMode,
  type PrestashopPackComponent,
} from '../../domain/types/prestashop-pack.types';
import { readAllPrestashopPages } from '../http/prestashop-paged-read';
import { PrestashopPackFilterIgnoredException } from '../../domain/exceptions/prestashop-pack-filter-ignored.exception';
import type { PrestashopPackResolver } from '../provisioners/prestashop-pack.resolver';
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
    // Process-singleton, held by the factory: master inventory sync builds one
    // adapter per product, so any pack cache kept on this instance would never
    // be read twice.
    private readonly packResolver?: PrestashopPackResolver
  ) {}

  /**
   * Reads one stock row and reports it as-is.
   *
   * Deliberately NOT at parity with `listInventory`: this method reports a
   * pack's own stock row (which PrestaShop never decrements when a component
   * sells) and throws for a pack that has no row of its own. No caller of the
   * port method exists in core or the worker today, so the pack rule was wired
   * into `listInventory` only. A future caller must not assume parity.
   */
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

    const combinationRows = stockRecords.filter(
      (record) => Number(record.id_product_attribute) !== 0
    );

    // Multi-variant: one variant-keyed Inventory per combination. The
    // id_product_attribute=0 aggregate is ignored - the per-combination rows
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

    // Only a product with no combinations can be a pack - PrestaShop refuses
    // combinations on one - so the multi-variant path above never pays for a
    // product read.
    //
    // The probe fires only for an id the shop already told us is a pack. It used
    // to fire for every simple product, which doubled the inventory sweep's
    // request count on the dominant product shape. With no pack knowledge at all
    // (resolver absent, or its read failed) the probe is skipped rather than
    // fired blindly: skipping is exactly the pre-pack behaviour, whereas probing
    // spends a request per product and, when the key simply lacks `products`
    // read permission, learns nothing anyway.
    const ownRow = stockRecords.length > 0 ? stockRecords[0] : null;
    const mightBePack = await this.isKnownPack(psProductId);
    const product =
      ownRow === null
        ? // A product with no stock rows is read regardless: that read is the
          // deletion classification, and it predates pack support.
          await this.fetchProductOrClassifyDeletion(productId, psProductId)
        : mightBePack
          ? await this.tryFetchProduct(productId, psProductId)
          : null;

    const packQuantity = await this.resolvePackQuantity(productId, psProductId, product, ownRow);

    if (packQuantity !== null) {
      const packRow: PrestashopStockAvailable = {
        ...(ownRow ?? {
          // A pack whose availability comes from its components legitimately has
          // no stock row of its own. The id is deterministic so the Inventory
          // identifier mapping stays stable across runs.
          id: `pack:${psProductId}`,
          id_product: psProductId,
          id_product_attribute: 0,
        }),
        quantity: packQuantity,
      };
      return [await this.toVariantInventory(packRow, productId, `product:${psProductId}`)];
    }

    if (ownRow === null) {
      throw this.zeroStockRowsError(productId, psProductId);
    }

    // Simple product: the single aggregate row maps to the deterministic
    // synthetic variant (mirrors the product adapter's `product:<id>` scheme).
    return [await this.toVariantInventory(ownRow, productId, `product:${psProductId}`)];
  }

  /**
   * Pack quantity for this product, or `null` when the pack rule has nothing to
   * say and the product's own stock row stands.
   *
   * `null` covers three distinct cases on purpose - the product is not a pack,
   * the shop decrements the pack itself (`pack_stock_type = 0`, so its own row
   * IS authoritative), or the pack declares no components. Only the first is the
   * common case; the other two are logged.
   *
   * An ordinary product returns on the first check, before any component read.
   * That is the point of the early return: a pack rule able to lower a non-pack's
   * quantity would override the master, which is authoritative including zero.
   */
  private async resolvePackQuantity(
    productId: string,
    psProductId: string,
    product: unknown,
    ownRow: PrestashopStockAvailable | null
  ): Promise<number | null> {
    const pack = readPackDefinition(product);
    if (pack === null) {
      return null;
    }

    // The shop-wide setting is read only for a pack that actually defers to it,
    // and the answer is cached per connection on the shared resolver.
    const shopDefault = packStockTypeDefersToShop(pack.rawStockType)
      ? await this.resolveShopPackStockType()
      : null;
    const mode = resolvePackStockMode(pack.rawStockType, shopDefault);
    if (mode === 'pack-only') {
      this.logger.debug(
        `master_inventory_pack_own_stock product=${productId} psProductId=${psProductId} - shop decrements the pack itself; own stock row is authoritative`
      );
      return null;
    }

    const derived = derivePackAvailability(
      pack.components,
      await this.readComponentAvailability(pack.components)
    );

    if (derived === null) {
      this.logger.warn(
        `master_inventory_pack_without_components product=${productId} psProductId=${psProductId} - pack declares no components; falling back to its own stock row`
      );
      return null;
    }

    if (mode === 'both') {
      // A missing own row is 0, not "no opinion". Verified against PrestaShop
      // 9.0.2: for `STOCK_TYPE_PACK_BOTH`, `Pack::getQuantity` seeds the answer
      // from `StockAvailable::getQuantityAvailableByProduct`, which casts an
      // absent row's `SUM(quantity)` to `(int) null` = 0, and then only lowers
      // it per component. So the shop reports 0 here and so do we - the arm that
      // returned the derived figure instead over-reported.
      return Math.min(ownRow === null ? 0 : this.readQuantity(ownRow.quantity), derived);
    }

    return derived;
  }

  /**
   * Available quantity per component, in ONE stock_availables read for the whole
   * bundle (PrestaShop's `[a|b|c]` OR filter). A request per component would make
   * one pack cost as much as the sweep it belongs to.
   *
   * The array branch of the query builder emits `[a,b,c]`, which PrestaShop reads
   * as a RANGE, so the ids are joined with a pipe by hand here and must stay
   * that way.
   *
   * Read failures are deliberately not swallowed: a component quantity we could
   * not read is not a quantity, so failing the job and retrying is honest where
   * reporting the pack's untouched own row would not be.
   */
  private async readComponentAvailability(
    components: readonly PrestashopPackComponent[]
  ): Promise<Map<string, number>> {
    const componentProductIds = [...new Set(components.map((component) => component.productId))];

    // A pack that named no usable component is answered by
    // `derivePackAvailability`, not by a filter-less read of every stock row in
    // the shop.
    if (componentProductIds.length === 0) {
      return new Map<string, number>();
    }

    // Paged: the OR filter spans every component and every combination of each,
    // so one page is easily short. A component whose row was cut read as absent,
    // the pack published 0, and a live listing stopped selling (#2598, #2608).
    const rows = await readAllPrestashopPages<PrestashopStockAvailable>(
      (limit, offset) =>
        this.httpClient.listResources<PrestashopStockAvailable>(
          'stock_availables',
          { custom: { id_product: componentProductIds.join('|') } },
          limit,
          offset
        ),
      {
        resource: 'stock_availables',
        connectionId: this.connection.id,
        detail: `${componentProductIds.length} pack components`,
      }
    );

    this.assertOrFilterHonoured(componentProductIds, rows);

    const availability = new Map<string, number>();
    for (const row of rows) {
      const attributeId = Number(row.id_product_attribute);
      const combinationId =
        Number.isFinite(attributeId) && attributeId !== 0 ? String(row.id_product_attribute) : null;
      const key = packComponentStockKey(String(row.id_product), combinationId);
      const quantity = this.readQuantity(row.quantity);
      const seen = availability.get(key);
      // A multistore PrestaShop answers one row per shop for the same
      // (product, combination). PrestaShop's own read sums them, but this
      // connection sells through one shop, so summing would report another
      // shop's stock as sellable here. The lowest row is the reading that
      // cannot oversell, and it replaces a last-row-wins that was neither.
      availability.set(key, seen === undefined ? quantity : Math.min(seen, quantity));
    }
    return availability;
  }

  /**
   * Refuse a component stock response the OR filter cannot have produced.
   *
   * Both shapes would otherwise read as "every component is out of stock" and
   * publish the pack at 0 - the same silent false zero the paged read closes,
   * arriving by a different route.
   */
  private assertOrFilterHonoured(
    componentProductIds: readonly string[],
    rows: readonly PrestashopStockAvailable[]
  ): void {
    const requested = new Set(componentProductIds);
    const answered = new Set(rows.map((row) => String(row.id_product)));

    for (const id of answered) {
      if (!requested.has(id)) {
        throw new PrestashopPackFilterIgnoredException(
          this.connection.id,
          componentProductIds,
          `it returned stock for product ${id}, which was not asked for`
        );
      }
    }

    if (answered.size === 0) {
      throw new PrestashopPackFilterIgnoredException(
        this.connection.id,
        componentProductIds,
        'it returned no rows at all, and PrestaShop materialises a stock row per product'
      );
    }
  }

  /**
   * Shop-wide `PS_PACK_STOCK_TYPE`, or `null` when it cannot be resolved.
   *
   * Read through `configurations` because `pack_stock_type = 3` (and `0`) on the
   * product is a pointer to this value rather than a mode of its own - see
   * `resolvePackStockMode` for what an unresolved default falls back to. The read
   * is cached per connection on the shared resolver, so a sweep pays for it once
   * per TTL rather than once per pack.
   */
  private async resolveShopPackStockType(): Promise<number | null> {
    if (this.packResolver === undefined) {
      return null;
    }
    return this.packResolver.resolveShopPackStockType(this.connection.id, this.httpClient);
  }

  /**
   * Whether this PrestaShop product id is one of the shop's packs.
   *
   * `false` when the pack set could not be resolved: without it a probe learns
   * nothing the caller can act on and costs a request per product.
   */
  private async isKnownPack(psProductId: string): Promise<boolean> {
    if (this.packResolver === undefined) {
      return false;
    }
    const packIds = await this.packResolver.resolvePackIds(this.connection.id, this.httpClient);
    return packIds !== null && packIds.has(psProductId);
  }

  /**
   * Product read that must not break a working inventory read: pack awareness
   * sits on top of the stock rows, so a failed probe degrades to the pre-pack
   * behaviour instead of failing the whole sweep.
   */
  private async tryFetchProduct(productId: string, psProductId: string): Promise<unknown> {
    try {
      return await this.httpClient.getResource('products', psProductId);
    } catch (error) {
      this.logger.warn(
        `master_inventory_pack_probe_failed product=${productId} psProductId=${psProductId} connection=${this.connection.id} - a pack would be reported from its own stock row: ${(error as Error).message}`
      );
      return null;
    }
  }

  private readQuantity(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
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
      // Paged: a product carries one stock row per combination, so a product with
      // more than a page of variants reported stock for only some of them (#2608).
      return await readAllPrestashopPages<PrestashopStockAvailable>(
        (limit, offset) =>
          this.httpClient.listResources<PrestashopStockAvailable>(
            'stock_availables',
            filters,
            limit,
            offset
          ),
        {
          resource: 'stock_availables',
          connectionId: this.connection.id,
          detail: `product ${productId}`,
        }
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
    await this.fetchProductOrClassifyDeletion(productId, psProductId);
    throw this.zeroStockRowsError(productId, psProductId);
  }

  /**
   * Read the product resource, translating a platform not-found into the neutral
   * `MasterProductNotFoundError` - the one signal that really means "deleted at
   * the master". Any other failure propagates untouched so the job stays
   * retryable.
   */
  private async fetchProductOrClassifyDeletion(
    productId: string,
    psProductId: string
  ): Promise<unknown> {
    try {
      return await this.httpClient.getResource('products', psProductId);
    } catch (error) {
      if (error instanceof PrestashopResourceNotFoundException) {
        this.logger.warn(
          `master_inventory_master_deleted product=${productId} psProductId=${psProductId} connection=${this.connection.id} - product absent at the master`
        );
        throw new MasterProductNotFoundError(productId, this.connection.id, error);
      }
      throw error;
    }
  }

  /**
   * The product resolves but has no stock rows and no pack rule to answer for
   * it: a data gap, not a deletion, so the platform exception keeps the job
   * retryable and the rows unstaled.
   */
  private zeroStockRowsError(
    productId: string,
    psProductId: string
  ): PrestashopResourceNotFoundException {
    this.logger.warn(
      `master_inventory_zero_stock_rows product=${productId} psProductId=${psProductId} connection=${this.connection.id} - product still resolves at the master; NOT classified as a deletion`
    );
    return new PrestashopResourceNotFoundException(
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
