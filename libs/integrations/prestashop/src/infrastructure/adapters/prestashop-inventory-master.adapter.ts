/**
 * PrestaShop Inventory Master Adapter
 *
 * Implements InventoryMasterPort for PrestaShop WebService API. Reads inventory
 * and, since #2369, adjusts it over the `stock_availables` resource.
 * `reserveInventory` / `releaseInventory` remain NotSupported (deprecated in
 * place by ADR-061 — no shipped master exposes a hold primitive).
 *
 * Write semantics: the webservice exposes no delta primitive and no conditional
 * write, so `adjustInventory` is a non-atomic read-current -> compute -> PUT,
 * and de-duplication of a retried adjustment is the adapter's own (#2368's
 * idempotency key, held in the shared cache). See that method for what those
 * two facts do and do not guarantee.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {InventoryMasterPort}
 */
import type {
  InventoryMasterPort,
  Inventory,
  InventoryAdjustment,
  InventoryAdjustmentResult,
  InventoryAdjustmentOutcome,
  InventoryIdempotencySupport,
} from '@openlinker/core/inventory';
import type { CachePort } from '@openlinker/shared/cache';
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
 * How long an applied idempotency key is remembered (#2369).
 *
 * Matches the WooCommerce window (#2368) and, through it, the `jobdedup:*` TTL —
 * so the retry ladder's 6 h backoff cannot outlive the window and a legitimate
 * retry can never fall outside it.
 */
const ADJUSTMENT_IDEMPOTENCY_TTL_SEC = 7 * 24 * 60 * 60;

/**
 * PrestaShop Inventory Master Adapter
 *
 * Reads inventory; adjusts it via `stock_availables` (#2369).
 */
export class PrestashopInventoryMasterAdapter implements InventoryMasterPort {
  private readonly logger = new Logger(PrestashopInventoryMasterAdapter.name);

  constructor(
    private readonly httpClient: IPrestashopWebserviceClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly inventoryMapper: IPrestashopInventoryMapper,
    private readonly connection: Connection,
    /**
     * Optional shared cache backing the #2368 idempotency window.
     *
     * Optional because `HostServices.cache` is — a host wired without one gets
     * an adapter that applies every adjustment and REPORTS
     * `idempotency: 'unsupported'`, rather than one that silently pretends to
     * dedupe. Trailing and optional so existing construction sites stay
     * source-compatible.
     */
    private readonly cache?: CachePort
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

  /**
   * Adjust the quantity of one `stock_availables` row (#2369).
   *
   * ## Non-atomic by necessity
   *
   * The webservice exposes no delta primitive and no conditional write, so this
   * is read-current -> compute -> PUT. Two concurrent adjustments to the same row
   * can lose an update. That is not closable through this API; the OL PrestaShop
   * module would need a stock endpoint performing an atomic SQL increment, which
   * is a larger change than this issue (and would gate every restock behind an
   * operator module upgrade).
   *
   * ## What the idempotency key buys, and what it does not
   *
   * A key already seen inside the window means this adjustment was applied
   * before, so nothing is written and the CURRENT master stock is returned with
   * `disposition: 'deduplicated'` — not a replay of the earlier figure, which
   * would be a worse lie than reporting no figure.
   *
   * The guarantee is bounded: {@link CachePort} exposes no atomic
   * set-if-absent, so two GENUINELY CONCURRENT calls carrying the same key can
   * both miss and both apply. The threat this closes is a SEQUENTIAL job retry
   * minutes or hours after a failure, and #2370 mints one deterministic key per
   * disposition sequence. With no cache wired the adjustment is applied and
   * reported `idempotency: 'unsupported'` — never `'honoured'`, because a caller
   * that believes a key was honoured stops defending against the double-increment
   * itself. A cache **throw** (as opposed to the miss `CachePort` returns as
   * `null`) propagates: this fails CLOSED, because a blocked restock is recorded
   * by #2370 as `restock_blocked` and is recoverable, while a double restock
   * silently moves real stock and is not.
   *
   * ## `appliedAt` is always null here
   *
   * `stock_availables` carries no timestamp column of any kind, so PrestaShop
   * reports no instant for a stock change. Per #2367/#2336, OL does not
   * fabricate a claim about another system's clock — the honest answer is the
   * absence, not `new Date()`.
   *
   * ## Refusals, and one contract widening
   *
   * A configuration PrestaShop cannot serve safely raises
   * `PrestashopNotSupportedException`, which #2370 records as `restock_blocked`.
   * Never a silent success and never an outcome claiming `applied`, since
   * `InventoryAdjustmentOutcome` has no member able to express a refusal.
   *
   * Note the zero-rows branch delegates to {@link throwForAbsentStockRecords},
   * which can raise the neutral `MasterProductNotFoundError`. The port documents
   * that #1688 translation for the two READ methods only, and
   * `MasterInventorySyncService` acts on it destructively, so reaching it from a
   * WRITE is a deliberate widening rather than incidental helper reuse: a
   * product absent at the master is the same fact whoever asks, and duplicating
   * the product probe to avoid the neutral error would be worse.
   *
   * @throws PrestashopNotSupportedException on an unsupported configuration
   * @throws MasterProductNotFoundError when the product is absent at the master
   */
  async adjustInventory(adjustment: InventoryAdjustment): Promise<InventoryAdjustmentResult> {
    this.logger.debug(
      `Adjusting inventory for product: ${adjustment.productId} (connection: ${this.connection.id})`
    );

    if (adjustment.reason) {
      // `stock_availables` has no audit/comment field — `location` is an
      // operator-authored warehouse string, so writing the reason there would
      // corrupt real data. The reason reaches the operator's log instead.
      this.logger.log(
        `Inventory adjustment reason=${adjustment.reason} product=${adjustment.productId} ` +
          `quantity=${String(adjustment.quantity)} connection=${this.connection.id}`
      );
    }

    const idempotency = this.resolveIdempotencySupport(adjustment);
    const alreadyApplied =
      idempotency === 'honoured' ? await this.hasAppliedKey(adjustment.idempotencyKey) : false;

    const psProductId = await this.resolvePrestashopProductId(adjustment.productId);
    const attributeId = await this.resolveTargetAttributeId(adjustment, psProductId);

    const rows = await this.listStockRecords(adjustment.productId, {
      custom: { id_product: psProductId, id_product_attribute: attributeId },
    });

    if (rows.length > 1) {
      throw new PrestashopNotSupportedException(
        `Inventory adjustment is ambiguous: ${String(rows.length)} stock_availables rows match ` +
          `product ${psProductId} (attribute ${attributeId}) on connection ${this.connection.id}. ` +
          `This is a multi-shop PrestaShop configuration. Set "shopId" in the connection config to scope ` +
          `OpenLinker to a single shop, then retry.`,
        'adjustInventory',
        'Set connection config "shopId" to the PrestaShop shop OpenLinker should adjust'
      );
    }

    if (rows.length === 0) {
      await this.throwForAbsentStockRecords(adjustment.productId, psProductId);
    }

    const row = rows[0];

    if (this.dependsOnStock(row)) {
      throw new PrestashopNotSupportedException(
        `Inventory adjustment refused: stock_available ${String(row.id)} has ` +
          `depends_on_stock=1, so PrestaShop's Advanced Stock Management owns this quantity and ` +
          `recomputes it from warehouse stock. A write here would be accepted and then silently ` +
          `discarded. Adjust the warehouse stock in PrestaShop instead.`,
        'adjustInventory',
        'PrestaShop Advanced Stock Management (warehouse stock)'
      );
    }

    const current = this.toQuantity(row.quantity, String(row.id));
    const newQuantity = alreadyApplied ? current : Math.max(0, current + adjustment.quantity);

    if (!alreadyApplied) {
      if (current + adjustment.quantity < 0) {
        this.logger.warn(
          `Inventory adjustment clamped at 0: product=${adjustment.productId} ` +
            `current=${String(current)} delta=${String(adjustment.quantity)} — less than the ` +
            `requested delta was applied (connection: ${this.connection.id})`
        );
      }

      // PS WS PUT takes the FULL resource body, so the read-back row is spread
      // and only `quantity` is overlaid — preserving id_shop / id_shop_group /
      // depends_on_stock / out_of_stock rather than leaving them to PS defaults.
      await this.httpClient.updateResource('stock_availables', String(row.id), {
        ...row,
        id: String(row.id),
        quantity: String(newQuantity),
      });
    } else {
      this.logger.log(
        `Skipping already-applied inventory adjustment key=${String(adjustment.idempotencyKey)} ` +
          `product=${adjustment.productId} connection=${this.connection.id}`
      );
    }

    if (idempotency === 'honoured' && !alreadyApplied) {
      // Recorded only AFTER the write succeeded. Recording first would suppress
      // the retry of an adjustment that never landed — the exact failure the key
      // exists to prevent, inverted.
      await this.rememberAppliedKey(adjustment.idempotencyKey);
    }

    const mapped = this.inventoryMapper.mapInventory(
      { ...row, quantity: String(newQuantity) },
      adjustment.productId,
      adjustment.variantId
    );

    const internalId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Inventory,
      String(row.id),
      this.connection.id,
      {
        parentEntityType: CORE_ENTITY_TYPE.Product,
        parentInternalId: adjustment.productId,
      }
    );

    const outcome: InventoryAdjustmentOutcome = {
      disposition: alreadyApplied ? 'deduplicated' : 'applied',
      idempotency,
      // PrestaShop reports no instant for a stock change — see the docblock.
      appliedAt: null,
    };

    return { ...mapped, id: internalId, adjustmentOutcome: outcome };
  }

  /**
   * Resolve which `id_product_attribute` the adjustment targets.
   *
   * A named variant resolves through its own mapping: the synthetic
   * `product:<id>` form (a simple product) targets the product-level row `0`,
   * and a numeric combination id targets itself. A missing mapping is a mapping
   * GAP, not a master deletion — same carve-out, and same reasoning, as
   * {@link resolvePrestashopProductId}.
   *
   * With no variant named, the target is the product-level row — but only once
   * the product is known to have no combinations. On a combination product that
   * row is an aggregate PrestaShop recomputes from its combinations, so writing
   * it would be discarded; and picking a combination on the caller's behalf
   * would move stock the caller never named. Mirrors the WooCommerce refusal to
   * adjust a variable product without a `variantId`.
   */
  private async resolveTargetAttributeId(
    adjustment: InventoryAdjustment,
    psProductId: string
  ): Promise<string> {
    if (adjustment.variantId) {
      const externalIds = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.ProductVariant,
        adjustment.variantId
      );
      const mapping = externalIds.find(
        (e: { connectionId: string }) => e.connectionId === this.connection.id
      );

      if (!mapping) {
        this.logger.warn(
          `master_inventory_variant_mapping_gap variant=${adjustment.variantId} ` +
            `connection=${this.connection.id} — no external ID mapping; NOT classified as a master deletion`
        );
        throw new PrestashopResourceNotFoundException(
          `Variant not found: ${adjustment.variantId} (no external ID mapping for connection ${this.connection.id})`,
          CORE_ENTITY_TYPE.ProductVariant,
          adjustment.variantId,
          this.connection.id
        );
      }

      return mapping.externalId.startsWith('product:') ? '0' : mapping.externalId;
    }

    const allRows = await this.listStockRecords(adjustment.productId, {
      custom: { id_product: psProductId },
    });
    const hasCombinations = allRows.some((r) => Number(r.id_product_attribute) !== 0);

    if (hasCombinations) {
      throw new PrestashopNotSupportedException(
        `Inventory adjustment is ambiguous: product ${psProductId} has combinations, so an ` +
          `adjustment must name which variant it applies to. The product-level stock row is an ` +
          `aggregate PrestaShop recomputes from its combinations, so writing it would be discarded.`,
        'adjustInventory',
        'Supply adjustment.variantId to target a specific combination'
      );
    }

    return '0';
  }

  /**
   * `depends_on_stock === 1` means Advanced Stock Management owns the quantity.
   *
   * Absent or unparseable degrades to `false` (not-ASM) rather than refusing: a
   * PrestaShop version that omits the field must not block every ordinary
   * install. Only an explicit `1` refuses.
   */
  private dependsOnStock(row: PrestashopStockAvailable): boolean {
    return Number(row.depends_on_stock) === 1;
  }

  /**
   * Parse the row's current quantity, REFUSING rather than defaulting.
   *
   * A `0` fallback would be the worst possible guess: the delta is applied on
   * top of it, so an unparseable response would silently overwrite real stock
   * with the adjustment alone. The quantity is the entire subject of this
   * method, so an unreadable one is a refusal, not a default.
   */
  private toQuantity(raw: string | number, stockAvailableId: string): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new PrestashopNotSupportedException(
        `Inventory adjustment refused: stock_available ${stockAvailableId} on connection ` +
          `${this.connection.id} reported an unreadable quantity (${String(raw)}). Adjusting ` +
          `from an unknown baseline would overwrite the real stock with the delta alone.`,
        'adjustInventory',
        'Inspect the stock_availables row in PrestaShop'
      );
    }
    return parsed;
  }

  private resolveIdempotencySupport(adjustment: InventoryAdjustment): InventoryIdempotencySupport {
    if (!adjustment.idempotencyKey) return 'not_requested';
    if (!this.cache) return 'unsupported';
    return 'honoured';
  }

  private idempotencyCacheKey(key: string): string {
    return `ps:inventory-adjust:${this.connection.id}:${key}`;
  }

  private async hasAppliedKey(key: string | undefined): Promise<boolean> {
    if (!key || !this.cache) return false;
    return (await this.cache.get<true>(this.idempotencyCacheKey(key))) === true;
  }

  private async rememberAppliedKey(key: string | undefined): Promise<void> {
    if (!key || !this.cache) return;
    await this.cache.set(this.idempotencyCacheKey(key), true, ADJUSTMENT_IDEMPOTENCY_TTL_SEC);
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
