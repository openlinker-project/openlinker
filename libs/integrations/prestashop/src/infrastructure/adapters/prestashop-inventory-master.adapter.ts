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
  BulkInventoryReader,
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
import {
  readAllPrestashopResourcePages,
  PRESTASHOP_UNNARROWED_MAX_ROWS,
} from '../http/prestashop-paged-read';
import { PrestashopPackFilterIgnoredException } from '../../domain/exceptions/prestashop-pack-filter-ignored.exception';
import type { PrestashopPackResolver } from '../provisioners/prestashop-pack.resolver';
import { Logger } from '@openlinker/shared/logging';

/**
 * PrestaShop Inventory Master Adapter
 *
 * Read-only adapter for PrestaShop inventory operations.
 */
export class PrestashopInventoryMasterAdapter implements InventoryMasterPort, BulkInventoryReader {
  private readonly logger = new Logger(PrestashopInventoryMasterAdapter.name);

  /**
   * Stock rows per PrestaShop product id, when {@link prefetchInventory} read
   * them in bulk (#2648).
   *
   * Populated only by the bulk path: `listInventory` on its own has one product
   * to ask about and gains nothing from a memo. An ABSENT key means "not
   * prefetched" and falls through to the per-product read, so a product the
   * bulk read did not cover behaves exactly as before - which is why an empty
   * array must be stored for a product the shop confirmed has no stock rows,
   * rather than left out.
   *
   * The instance lives for one capability resolution, i.e. one batch job, which
   * is the right scope: within a job those reads want the same snapshot, and
   * the next job builds a new adapter and re-reads. A longer-lived cache would
   * serve stale stock to a later sync, and stock is the value that moves most.
   */
  private readonly stockRowsCache = new Map<string, PrestashopStockAvailable[]>();

  constructor(
    private readonly httpClient: IPrestashopWebserviceClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly inventoryMapper: IPrestashopInventoryMapper,
    private readonly connection: Connection,
    // Process-singleton, held by the factory. It predates #2648's batching, when
    // master inventory sync built one adapter per product and any pack cache
    // kept on this instance would never have been read twice. A batch now shares
    // one instance, but the resolver stays process-wide - the shop's pack set and
    // its PS_PACK_STOCK_TYPE do not change between pages.
    private readonly packResolver?: PrestashopPackResolver
  ) {}

  /**
   * Read the stock rows of a whole page of products in one filtered collection
   * read (#2648, `BulkInventoryReader`).
   *
   * `stock_availables` is exactly the resource the per-product path reads, and
   * PrestaShop answers a filtered collection for many products as readily as
   * for one - the mechanism is already in this file, in
   * `readComponentAvailability`, which reads a pack's whole component bundle
   * that way. So the page costs a handful of requests where the fan-out cost
   * one per product.
   *
   * Two things about the filter are load-bearing and must stay:
   *
   * - the ids are an OR list, so they must be PIPE-joined. PrestaShop reads
   *   `[a,b]` as the RANGE a..b, which answers with a near-whole-catalogue page
   *   and nothing at all for the ids in between. The query builder's array
   *   branch does the pipe-joining, which is why an array is passed rather than
   *   a hand-built string.
   * - the read must be sorted, or offset paging trusts whatever order MySQL
   *   happens to return and two pages can overlap or leave a hole.
   *   `readAllPrestashopResourcePages` applies `id_ASC` unless a caller asks
   *   for its own order, so this goes through that helper rather than
   *   `listResources` directly.
   *
   * Best-effort by contract: a failure logs and returns, leaving the cache
   * empty, so the per-product loop behind it reads exactly what it read before
   * this method existed.
   */
  async prefetchInventory(internalProductIds: readonly string[]): Promise<void> {
    if (internalProductIds.length === 0) {
      return;
    }

    try {
      const psProductIds = await this.resolvePrestashopProductIds(internalProductIds);
      if (psProductIds.length === 0) {
        return;
      }

      const rows = await readAllPrestashopResourcePages<PrestashopStockAvailable>(
        this.httpClient,
        'stock_availables',
        { custom: { id_product: psProductIds } },
        {
          connectionId: this.connection.id,
          detail: `id_product in ${String(psProductIds.length)} product(s)`,
          // A page of products carries one stock row per combination of each, so
          // the narrowed budget - sized for one product's rows - is far too
          // tight here.
          maxRows: PRESTASHOP_UNNARROWED_MAX_ROWS,
        }
      );

      // Seed an empty bucket for every id asked about, so a product the shop
      // genuinely has no stock rows for is a positive answer rather than a
      // cache miss that costs another request. That is safe because a
      // zero-row product does not stale anything on its own - `listInventory`
      // still probes the product resource to tell a deletion from a data gap.
      for (const psProductId of psProductIds) {
        this.stockRowsCache.set(psProductId, []);
      }
      for (const row of rows) {
        const bucket = this.stockRowsCache.get(String(row.id_product));
        if (bucket !== undefined) {
          bucket.push(row);
        }
      }
    } catch (error) {
      this.stockRowsCache.clear();
      this.logger.warn(
        `PrestaShop bulk inventory prefetch failed for ${String(internalProductIds.length)} product(s) ` +
          `(connection: ${this.connection.id}); falling back to per-product reads: ` +
          `${(error as Error).message}`
      );
    }
  }

  /**
   * PrestaShop ids for a page of internal product ids.
   *
   * An id with no mapping for this connection is dropped rather than failing
   * the warm-up: the per-product read resolves the same mapping again and
   * raises its own, better-classified error for it (`master_inventory_mapping_gap`).
   */
  private async resolvePrestashopProductIds(
    internalProductIds: readonly string[]
  ): Promise<string[]> {
    const psProductIds: string[] = [];
    for (const internalProductId of internalProductIds) {
      try {
        psProductIds.push(await this.resolvePrestashopProductId(internalProductId));
      } catch {
        // Deliberately silent - `resolvePrestashopProductId` already logged it.
      }
    }
    return [...new Set(psProductIds)];
  }

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
    // one row per combination. Served from the bulk read when this page was
    // prefetched (#2648), and read per product when it was not - the two answer
    // the same question about the same resource, so the rest of this method
    // cannot tell them apart.
    const stockRecords =
      this.stockRowsCache.get(psProductId) ??
      (await this.listStockRecords(productId, {
        custom: { id_product: psProductId },
      }));

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

    if (pack.unreadableComponentCount > 0) {
      this.logger.warn(
        `master_inventory_pack_unreadable_components product=${productId} psProductId=${psProductId} ` +
          `count=${String(pack.unreadableComponentCount)} - a bundle entry could not be read; the pack is ` +
          `reported as zero rather than as the minimum of the entries that could be`
      );
    }

    const derived = derivePackAvailability(
      pack.components,
      await this.readComponentAvailability(pack.components),
      pack.unreadableComponentCount
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
   * The ids MUST be pipe-joined: PrestaShop reads `[a,b,c]` as the RANGE a..c,
   * which answers with a near-whole-catalogue page and nothing for the ids in
   * between. The joining is done by hand here and the query builder's array
   * branch does the same thing (`prestashop-query.builder.ts` pipe-joins an
   * array value, never comma-joins it), so the two agree - an earlier revision
   * of this comment claimed the array branch emitted a comma and was the
   * opposite of what the builder does (#2660 review). Either form is correct;
   * this one is left as it is because it is the shape verified against a live
   * shop.
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
    const rows = await readAllPrestashopResourcePages<PrestashopStockAvailable>(
      this.httpClient,
      'stock_availables',
      { custom: { id_product: componentProductIds.join('|') } },
      {
        connectionId: this.connection.id,
        detail: `${componentProductIds.length} pack components`,
      }
    );

    await this.assertOrFilterHonoured(componentProductIds, rows);

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
   * THREE shapes are checked, and the third is the one an all-or-nothing test
   * misses (#2627 review). A response holding an id nobody asked for means the
   * condition was dropped and the whole collection came back. A response
   * holding no row at all means the same thing, since PrestaShop materialises a
   * stock row per product. And a response holding SOME of the requested ids is
   * the partial case: `derivePackAvailability` maps a missing key to 0, so four
   * of five components honoured publishes a fully in-stock pack at 0 and stops
   * a live listing - the exact #2598 false zero, arriving through the gap the
   * first two checks leave open.
   *
   * A missing id is NOT fatal on its own, because a genuinely deleted component
   * product legitimately has no stock row, and refusing there would fail the
   * inventory sync of every pack whose bundle still names a removed product -
   * trading a wrong quantity for a permanently failing job. The two are told
   * apart by asking the shop whether the missing products still exist: one
   * extra narrowed read, issued only when something is missing. A product that
   * still exists and answered no stock row is a dropped condition and throws; a
   * product that is gone keeps the existing "counts as zero" reading and warns.
   *
   * The existence probe is itself best-effort: if it cannot be read we cannot
   * tell the two apart, and refusing on an unrelated transport failure would
   * make the guard the thing that breaks pack syncing. That degrades to the
   * pre-check behaviour, logged.
   */
  private async assertOrFilterHonoured(
    componentProductIds: readonly string[],
    rows: readonly PrestashopStockAvailable[]
  ): Promise<void> {
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

    const missing = componentProductIds.filter((id) => !answered.has(id));
    if (missing.length === 0) {
      return;
    }

    const stillPresent = await this.readExistingProductIds(missing);
    if (stillPresent === null) {
      this.logger.warn(
        `master_inventory_pack_component_existence_unknown connection=${this.connection.id} ` +
          `missing=${missing.join(',')} - cannot tell a deleted component from a dropped filter; ` +
          `treating the missing components as zero stock`
      );
      return;
    }

    if (stillPresent.length > 0) {
      throw new PrestashopPackFilterIgnoredException(
        this.connection.id,
        componentProductIds,
        `it returned no stock row for product(s) ${stillPresent.join(', ')}, which still exist in the shop`
      );
    }

    this.logger.warn(
      `master_inventory_pack_component_deleted connection=${this.connection.id} ` +
        `missing=${missing.join(',')} - component product(s) no longer exist in the shop; ` +
        `the pack is limited to zero by them`
    );
  }

  /**
   * Which of these product ids the shop still has, or `null` when the read
   * failed and the answer is unknown.
   *
   * `display=[id]` keeps the body tiny - the question is existence, not content.
   */
  private async readExistingProductIds(productIds: readonly string[]): Promise<string[] | null> {
    try {
      const products = await readAllPrestashopResourcePages<{ id?: string | number }>(
        this.httpClient,
        'products',
        { display: '[id]', custom: { id: productIds.join('|') } },
        {
          connectionId: this.connection.id,
          detail: `${productIds.length} unanswered pack component(s)`,
        }
      );
      const requested = new Set(productIds.map(String));
      return [...new Set(products.map((product) => String(product.id ?? '')))].filter((id) =>
        requested.has(id)
      );
    } catch (error) {
      this.logger.warn(
        `master_inventory_pack_component_existence_probe_failed connection=${this.connection.id}: ${(error as Error).message}`
      );
      return null;
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
      return await readAllPrestashopResourcePages<PrestashopStockAvailable>(
        this.httpClient,
        'stock_availables',
        filters,
        {
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
