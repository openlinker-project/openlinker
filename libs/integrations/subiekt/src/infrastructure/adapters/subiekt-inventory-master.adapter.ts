/**
 * Subiekt Inventory Master Adapter (InventoryMaster capability)
 *
 * Implements core `InventoryMasterPort` over the bridge's `/api/inventory*`
 * surface. Resolves an internal OL `productId` to its Subiekt-native towar
 * symbol via `IdentifierMappingPort` (`CORE_ENTITY_TYPE.Product`), exactly as
 * `PrestashopInventoryMasterAdapter.resolvePrestashopProductId` does — the
 * mapping is written by whatever OL flow first synced the product into
 * Subiekt (out of scope for this InventoryMaster-only slice; ProductMaster is
 * a sibling capability).
 *
 * Read: `tw_Stan` (`st_TowId`, `st_MagId`, `st_Stan`, `st_StanRez`) for the
 * ONE magazyn this connection releases from — never the sum across every
 * magazyn the towar sits in, which advertises units that can never ship (a
 * sale leaves one warehouse). See `resolveReleaseMagazynId` for how that
 * warehouse is chosen. Every read method (`getInventory`, `listInventory`,
 * `getAvailableQuantity`, and `adjustInventory`'s read-back) applies the same
 * resolution, so they cannot disagree about which stock is publishable.
 *
 * The result is still ONE neutral `Inventory` per product: Subiekt GT's
 * `TowaryManager` documents no per-variant combination concept the way
 * `SuDokumentyManager`'s ZK/FS/PA family does for orders, so each towar is one
 * stock position for this MVP, mirroring PrestaShop's synthetic-variant
 * simple-product case.
 *
 * Write: `SuDokumentyManager.DodajPW()` (positive delta) / `.DodajRW()`
 * (negative delta), per #2368's optional idempotency contract — see the
 * bridge-native `BridgeInventoryAdjustRequest.idempotencyKey` docblock.
 *
 * `reserveInventory`/`releaseInventory` are `@deprecated` in place (ADR-061) —
 * no shipped master exposes a hold primitive, this one included.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 * @implements {InventoryMasterPort}
 */
import type {
  Inventory,
  InventoryAdjustment,
  InventoryAdjustmentResult,
  InventoryMasterPort,
} from '@openlinker/core/inventory';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import { modelIdFromProductKey } from './subiekt-model-key';
import type { LoggerPort } from '@openlinker/shared/logging';
import type { SubiektInventoryBridgeClient } from '../http/subiekt-inventory-bridge.client';
import {
  SubiektBridgeUnreachableError,
  SubiektRejectedError,
} from '../../bridge/subiekt-bridge.errors';
import { SubiektBridgeTransportError } from '../../domain/exceptions/subiekt-bridge-transport.exception';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektConfigException } from '../../domain/exceptions/subiekt-config.exception';
import { SubiektNotSupportedException } from '../../domain/exceptions/subiekt-not-supported.exception';
import type { SubiektTransportRetryability } from '../../domain/types/subiekt-transport-retryability.types';
import type { BridgeInventoryStockRow } from '../../bridge/subiekt-bridge-inventory.types';

/** Read the retryability phase, defaulting to the fiscal-safe `'indeterminate'` (mirrors the Invoicing adapter's identical helper). */
function readRetryability(error: SubiektBridgeUnreachableError): SubiektTransportRetryability {
  const phase = (error as { retryability?: unknown }).retryability;
  return phase === 'safe' || phase === 'indeterminate' ? phase : 'indeterminate';
}

export class SubiektInventoryMasterAdapter implements InventoryMasterPort {
  constructor(
    private readonly bridge: SubiektInventoryBridgeClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connectionId: string,
    private readonly logger: LoggerPort,
    /**
     * The operator's explicit release warehouse, when they set one. See
     * `SubiektConnectionConfig.stockMagazynId`; absent means "use whichever
     * magazyn the bridge says a movement lands in".
     */
    private readonly stockMagazynId?: number,
    /**
     * Symbols of the towary in a Subiekt model, supplied by the factory from
     * `SubiektProductMasterAdapter.readModelMemberSymbols`.
     *
     * OPTIONAL: an install whose operator groups nothing never has a
     * model-keyed product, so the reader is never called, and a host that
     * builds this adapter without one behaves exactly as it did before models
     * existed. Absent WITH a model-keyed product is a wiring fault and is
     * reported as one rather than silently returning no stock.
     */
    private readonly readModelMembers?: (modelId: number) => Promise<string[]>,
  ) {}

  /**
   * The towar symbols this product's stock is kept under: one for an ordinary
   * towar, N for a model.
   *
   * Subiekt keeps stock per TOWAR and OpenLinker keys a model's product by the
   * model, so every stock read has to cross that gap exactly once - here.
   */
  private async resolveStockSymbols(
    productId: string,
  ): Promise<{ symbols: string[]; isModel: boolean }> {
    const key = await this.resolveTowarSymbol(productId);
    const modelId = modelIdFromProductKey(key);
    if (modelId === null) return { symbols: [key], isModel: false };
    if (!this.readModelMembers) {
      throw new SubiektConfigException(
        `Product ${productId} is keyed by Subiekt model ${modelId}, but this adapter was built ` +
          `without a model-member reader, so its stock cannot be resolved. This is a host wiring ` +
          `fault, not a configuration one.`,
        'productId',
        productId,
      );
    }
    const symbols = await this.readModelMembers(modelId);
    if (symbols.length === 0) {
      // Every member deleted at the master: the model is gone as a product.
      throw new MasterProductNotFoundError(productId, this.connectionId);
    }
    return { symbols, isModel: true };
  }

  async getInventory(productId: string, locationId?: string): Promise<Inventory> {
    const { symbols } = await this.resolveStockSymbols(productId);
    if (symbols.length === 1) {
      return this.readOneTowarInventory(productId, symbols[0], locationId);
    }
    // A model as ONE product-level figure: the sum of its members. Nothing
    // reads this for a model on the sync path (that is `listInventory`), but
    // `getAvailableQuantity` does, and answering with one member's stock would
    // be a number about a different thing than the caller asked for.
    const parts = await Promise.all(
      symbols.map((symbol) => this.readOneTowarInventory(productId, symbol, locationId)),
    );
    const quantity = parts.reduce((sum, p) => sum + p.quantity, 0);
    const reserved = parts.reduce((sum, p) => sum + p.reserved, 0);
    return {
      id: `subiekt:${this.connectionId}:${productId}`,
      productId,
      quantity,
      reserved,
      available: Math.max(0, quantity - reserved),
    };
  }

  /**
   * One stock row PER VARIANT, each carrying `variantId`.
   *
   * This is what makes a model's stock land correctly.
   * `MasterInventorySyncService` keys a row to the adapter-supplied
   * `Inventory.variantId`, falling back to "the product's lone variant" only
   * when the product HAS exactly one (#822/#823). A model-keyed product has
   * three, so without the stamp every one of them would miss its stock and the
   * figure would silently collapse to a product-level row. PrestaShop has
   * emitted one entry per combination this way since #823; this is the same
   * shape with towary in place of combinations.
   *
   * A towar with no model still returns exactly one entry, and deliberately
   * WITHOUT a `variantId` - the lone-variant fallback already resolves it, and
   * stamping one here would make this path depend on a variant mapping the
   * product sync may not have minted yet.
   */
  async listInventory(productId: string): Promise<Inventory[]> {
    const { symbols, isModel } = await this.resolveStockSymbols(productId);
    if (!isModel) {
      return [await this.readOneTowarInventory(productId, symbols[0])];
    }
    const out: Inventory[] = [];
    for (const symbol of symbols) {
      const variantId = await this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.ProductVariant,
        symbol,
        this.connectionId,
      );
      const inventory = await this.readOneTowarInventory(productId, symbol);
      out.push({ ...inventory, variantId });
    }
    return out;
  }

  /**
   * Which towar an adjustment moves.
   *
   * For an ordinary towar the product answers it, as before. For a model the
   * product CANNOT: a model is several towary, each with its own stock, so
   * moving "the product's" stock is not a defined act - the caller has to say
   * which variant, and `InventoryAdjustment.variantId` is how. Picking a
   * member would move real stock on the wrong towar, silently, which is the
   * one outcome worth refusing outright (PrestaShop refuses the same shape for
   * a variable product with no `variantId`).
   */
  private async resolveAdjustmentSymbol(adjustment: InventoryAdjustment): Promise<string> {
    const key = await this.resolveTowarSymbol(adjustment.productId);
    if (modelIdFromProductKey(key) === null) return key;

    if (adjustment.variantId === undefined) {
      throw new SubiektConfigException(
        `Product ${adjustment.productId} is a Subiekt model and carries several towary, each with ` +
          `its own stock. Supply adjustment.variantId to say which one to move.`,
        'variantId',
        adjustment.productId,
      );
    }
    const variantMappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.ProductVariant,
      adjustment.variantId,
    );
    const mapping = variantMappings.find((e) => e.connectionId === this.connectionId);
    if (!mapping) {
      this.logger.warn(
        `subiekt_inventory_variant_mapping_gap variant=${adjustment.variantId} ` +
          `connection=${this.connectionId} — no external ID mapping; NOT a master deletion`,
      );
      throw new SubiektConfigException(
        `Variant not found: ${adjustment.variantId} (no external ID mapping for connection ${this.connectionId})`,
        'variantId',
        adjustment.variantId,
      );
    }
    // Both shapes reach here and both strip to the same towar symbol. A model
    // member is keyed `{symbol}::variant` since the identity fix, and the bare
    // `{symbol}` is what that path minted before - an install carrying either
    // resolves to the right towar, which is why the two never disagreed about
    // STOCK even while they disagreed about identity.
    return mapping.externalId.endsWith('::variant')
      ? mapping.externalId.slice(0, -'::variant'.length)
      : mapping.externalId;
  }

  /** The pre-model read, for one towar symbol. */
  private async readOneTowarInventory(
    productId: string,
    towarSymbol: string,
    locationId?: string,
  ): Promise<Inventory> {
    const { positions, domyslnyMagazynId } = await this.readPositionsForSymbol(productId, towarSymbol);
    const effectiveLocationId =
      locationId ?? this.resolveReleaseMagazynId(towarSymbol, positions, domyslnyMagazynId);
    const filtered = effectiveLocationId
      ? positions.filter((p) => String(p.magazynId) === effectiveLocationId)
      : positions;
    return this.toNeutralInventory(productId, towarSymbol, filtered);
  }

  async adjustInventory(adjustment: InventoryAdjustment): Promise<InventoryAdjustmentResult> {
    const towarSymbol = await this.resolveAdjustmentSymbol(adjustment);
    const magazynId = adjustment.locationId ? Number(adjustment.locationId) : undefined;

    try {
      const response = await this.bridge.adjust({
        towarSymbol,
        ...(magazynId !== undefined && Number.isFinite(magazynId) ? { magazynId } : {}),
        delta: adjustment.quantity,
        ...(adjustment.reason !== undefined ? { uwagi: adjustment.reason } : {}),
        ...(adjustment.idempotencyKey !== undefined
          ? { idempotencyKey: adjustment.idempotencyKey }
          : {}),
      });

      // Read back the SAME magazyn the adjustment landed in, not the sum:
      // reporting a total here would contradict the quantity the caller just
      // moved, on exactly the installs where it matters.
      const { positions, domyslnyMagazynId } = await this.readPositionsForSymbol(
        adjustment.productId,
        towarSymbol,
      );
      const effectiveLocationId =
        adjustment.locationId ??
        this.resolveReleaseMagazynId(towarSymbol, positions, domyslnyMagazynId);
      const scoped = effectiveLocationId
        ? positions.filter((p) => String(p.magazynId) === effectiveLocationId)
        : positions;
      const inventory = this.toNeutralInventory(adjustment.productId, towarSymbol, scoped);

      return {
        ...inventory,
        adjustmentOutcome: {
          disposition: response.deduplicated ? 'deduplicated' : 'applied',
          idempotency:
            adjustment.idempotencyKey !== undefined
              ? response.deduplicated
                ? 'honoured'
                : 'unsupported'
              : 'not_requested',
          // The bridge reports no instant for its own write today — an
          // honest absence rather than fabricating "now" (#2368's rule: the
          // MASTER's instant, never OL's clock).
          appliedAt: null,
        },
      };
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  reserveInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    const error = new SubiektNotSupportedException(
      'Inventory reservation is not supported. Sfera GT exposes no hold primitive — see ADR-061 (OL owns its own advisory reservation ledger).',
      'reserveInventory',
      'IReservationService (OL-owned advisory ledger)',
    );
    return Promise.reject(error);
  }

  releaseInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    const error = new SubiektNotSupportedException(
      'Inventory release is not supported. Sfera GT exposes no hold primitive — see ADR-061 (OL owns its own advisory reservation ledger).',
      'releaseInventory',
      'IReservationService (OL-owned advisory ledger)',
    );
    return Promise.reject(error);
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    // Sums every towar the product covers - one for an ordinary towar, all of
    // them for a model, which is the same figure `getInventory` reports.
    const { symbols } = await this.resolveStockSymbols(productId);
    let total = 0;
    for (const towarSymbol of symbols) {
      const { positions, domyslnyMagazynId } = await this.readPositionsForSymbol(productId, towarSymbol);
      const effectiveLocationId =
        locationId ?? this.resolveReleaseMagazynId(towarSymbol, positions, domyslnyMagazynId);
      const filtered = effectiveLocationId
        ? positions.filter((p) => String(p.magazynId) === effectiveLocationId)
        : positions;
      total += filtered.reduce((sum, p) => sum + (p.stan - p.stanRez), 0);
    }
    return total;
  }

  /**
   * Which magazyn's stock this connection publishes, as a neutral
   * `locationId` string — or `null` when it cannot be determined, in which
   * case the caller falls back to the pre-fix behaviour of summing every
   * position.
   *
   * Precedence: the operator's explicit `stockMagazynId`, else the bridge's
   * `domyslnyMagazynId`.
   *
   * SUMMING ACROSS MAGAZYNY IS AN OVERSELL, which is why this exists: a sale
   * releases from ONE warehouse, so publishing the total advertises units that
   * can never ship.
   *
   * ## An explicit `stockMagazynId` that matches nothing REFUSES
   *
   * The filter this value drives is applied to the towar's own positions, so a
   * magazyn id that names none of them leaves an EMPTY set - which folds to
   * `quantity: 0`, and a `0` from a master is authoritative (#1844) and is the
   * primitive #1689 uses to pause an offer. One mistyped digit in the
   * connection config would therefore deactivate every offer of every product
   * on every channel, silently, with nothing in any log to say why. The
   * condition is permanent (every retry re-reads the same config against the
   * same positions), so it surfaces as a terminal `SubiektConfigException`
   * naming the magazyny the towar IS stocked in, rather than as a published
   * zero. A towar with no positions at all is left alone: that is a genuine,
   * correctly-reported out of stock, not a misconfiguration.
   *
   * ## `domyslnyMagazynId` is a FALLBACK, not the release warehouse
   *
   * The bridge derives it by `ORDER BY st_MagId` over the towar's own stock
   * rows, so it is the lowest-numbered magazyn holding stock - not something
   * Subiekt tells us a sale will leave from, and the FS/PA release never
   * consults it. On a single-magazyn install the two coincide, which is why it
   * is a safe default there. **A multi-magazyn install MUST set
   * `config.stockMagazynId`**; until it does, the choice below is a guess and
   * says so in the log.
   */
  private resolveReleaseMagazynId(
    towarSymbol: string,
    positions: BridgeInventoryStockRow[],
    domyslnyMagazynId: number | undefined,
  ): string | null {
    if (this.stockMagazynId !== undefined) {
      const configured = String(this.stockMagazynId);
      if (positions.length > 0 && !positions.some((p) => String(p.magazynId) === configured)) {
        throw new SubiektConfigException(
          `config.stockMagazynId = ${configured} names no magazyn this towar is stocked in ` +
            `(${towarSymbol} has stock in magazyn ${positions.map((p) => String(p.magazynId)).join(', ')}). ` +
            'Publishing would report 0 for a product that has stock, which deactivates its offers. ' +
            'Correct stockMagazynId on the connection.',
          'config.stockMagazynId',
          this.stockMagazynId,
        );
      }
      return configured;
    }
    if (domyslnyMagazynId === undefined) {
      // A bridge predating the field. Behave exactly as before rather than
      // picking a warehouse on no information at all.
      return null;
    }
    if (positions.length > 1) {
      this.logger.warn(
        'subiekt_inventory_multi_magazyn_default: towar has stock in more than one magazyn and the connection names no release warehouse; publishing the lowest-numbered one the bridge reports. This is a GUESS about the operator logistics, not a fact read from Subiekt - set config.stockMagazynId to state the release warehouse explicitly.',
        {
          connectionId: this.connectionId,
          towarSymbol,
          magazynIds: positions.map((p) => p.magazynId),
          usingMagazynId: domyslnyMagazynId,
        },
      );
    }
    return String(domyslnyMagazynId);
  }

  /**
   * Shared read: resolve the towar symbol, read every `tw_Stan` position.
   *
   * Error contract (#1688, mirrored from PrestaShop): a MAPPING GAP (no
   * external id for this connection) is NOT translated to
   * `MasterProductNotFoundError` — it stays a platform-native, retryable
   * failure, since it may simply mean the product was never synced to
   * Subiekt, not that Subiekt deleted it. Only a bridge-reported "no such
   * towar" for a KNOWN symbol becomes the neutral deletion signal.
   */
  private async readPositionsForSymbol(
    productId: string,
    towarSymbol: string,
  ): Promise<{
    positions: BridgeInventoryStockRow[];
    domyslnyMagazynId: number | undefined;
  }> {
    try {
      const response = await this.bridge.getStock(towarSymbol);
      return {
        positions: response.positions,
        domyslnyMagazynId: response.domyslnyMagazynId,
      };
    } catch (error: unknown) {
      if (error instanceof SubiektRejectedError && this.looksLikeNotFound(error.reason)) {
        // The INTERNAL product id, not `towarSymbol`. Under a model this
        // method is called once per member, so the symbol at hand is a
        // variant's - and `MasterProductNotFoundError.productId` is documented
        // as internal and renders straight into the one message an operator
        // reads when stock stops arriving.
        throw new MasterProductNotFoundError(productId, this.connectionId);
      }
      throw this.translateBridgeError(error);
    }
  }

  private looksLikeNotFound(reason: string): boolean {
    return /nie znaleziono|not found|nie istnieje/i.test(reason);
  }

  private async resolveTowarSymbol(productId: string): Promise<string> {
    const externalIds = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Product,
      productId,
    );
    const mapping = externalIds.find((e) => e.connectionId === this.connectionId);
    if (!mapping) {
      this.logger.warn(
        `subiekt_inventory_mapping_gap product=${productId} connection=${this.connectionId} — no external ID mapping; NOT classified as a master deletion`,
      );
      throw new SubiektConfigException(
        `Product not found: ${productId} (no external ID mapping for connection ${this.connectionId})`,
        'productId',
        productId,
      );
    }
    return mapping.externalId;
  }

  /**
   * Fold the positions this connection publishes into one neutral `Inventory`.
   *
   * `locationId` is deliberately NOT emitted, even though the figures now come
   * from one magazyn and the bridge types have always suggested the adapter
   * could map `magazynId` onto it. Emitting it is a SEPARATE and much riskier
   * change than the oversell fix, and the two do not need each other:
   *
   *   - the field names a row in `inventory_locations` (`ol_location_*`), not
   *     a raw Subiekt magazyn id, so `"1"` would point at nothing;
   *   - a located position wins over `Connection.config.stockLocationOverride`
   *     (#3206), so the operator's own override would become a permanent
   *     silent no-op on every Subiekt connection;
   *   - the fulfilment router would load the stock and then match no location
   *     candidate at all;
   *   - and the pooled -> located transition fires #2322's stale repair once,
   *     on deploy, for every product.
   *
   * The oversell fix is entirely in WHICH positions reach this function. When
   * Subiekt magazyny are to be modelled as real OL locations, that is its own
   * slice with its own migration and mapping, not a by-product of this one.
   */
  private toNeutralInventory(
    productId: string,
    towarSymbol: string,
    positions: BridgeInventoryStockRow[],
  ): Inventory {
    const quantity = positions.reduce((sum, p) => sum + p.stan, 0);
    const reserved = positions.reduce((sum, p) => sum + p.stanRez, 0);
    return {
      id: `subiekt:${this.connectionId}:${towarSymbol}`,
      productId,
      quantity,
      reserved,
      available: Math.max(0, quantity - reserved),
    };
  }

  private translateBridgeError(error: unknown): Error {
    if (error instanceof SubiektBridgeUnreachableError) {
      return new SubiektBridgeTransportError(error.message, readRetryability(error));
    }
    if (
      error instanceof SubiektBridgeAuthError ||
      error instanceof SubiektConfigException ||
      error instanceof SubiektRejectedError
    ) {
      return error;
    }
    return new SubiektBridgeTransportError(
      error instanceof Error ? error.message : 'Unknown Subiekt inventory bridge error',
      'indeterminate',
      { cause: error },
    );
  }
}
