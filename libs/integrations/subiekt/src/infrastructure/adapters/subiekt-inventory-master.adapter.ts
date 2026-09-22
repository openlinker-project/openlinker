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
 * Read: `tw_Stan` (`st_TowId`, `st_MagId`, `st_Stan`, `st_StanRez`) summed
 * across every magazyn the towar has a position in — `getAvailableQuantity`
 * sums `stan - stanRez` per position, `getInventory`/`listInventory` sum
 * `stan`/`stanRez` across positions into ONE neutral `Inventory` (Subiekt GT's
 * `TowaryManager` documents no per-variant combination concept the way
 * `SuDokumentyManager`'s ZK/FS/PA family does for orders — each towar is one
 * stock position for this MVP, mirroring PrestaShop's synthetic-variant
 * simple-product case).
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
  ) {}

  async getInventory(productId: string, locationId?: string): Promise<Inventory> {
    const { towarSymbol, positions, domyslnyMagazynId } = await this.readPositions(productId);
    const effectiveLocationId =
      locationId ?? this.resolveReleaseMagazynId(towarSymbol, positions, domyslnyMagazynId);
    const filtered = effectiveLocationId
      ? positions.filter((p) => String(p.magazynId) === effectiveLocationId)
      : positions;
    return this.toNeutralInventory(productId, towarSymbol, filtered, effectiveLocationId);
  }

  async listInventory(productId: string): Promise<Inventory[]> {
    // Subiekt GT's TowaryManager carries no documented per-variant combination
    // concept — one towar is one stock position, so this returns a single
    // product-level entry (never per-combination), the same shape PrestaShop's
    // synthetic-variant simple-product path produces.
    const inventory = await this.getInventory(productId);
    return [inventory];
  }

  async adjustInventory(adjustment: InventoryAdjustment): Promise<InventoryAdjustmentResult> {
    const towarSymbol = await this.resolveTowarSymbol(adjustment.productId);
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
      const { positions, domyslnyMagazynId } = await this.readPositions(adjustment.productId);
      const effectiveLocationId =
        adjustment.locationId ??
        this.resolveReleaseMagazynId(towarSymbol, positions, domyslnyMagazynId);
      const scoped = effectiveLocationId
        ? positions.filter((p) => String(p.magazynId) === effectiveLocationId)
        : positions;
      const inventory = this.toNeutralInventory(
        adjustment.productId,
        towarSymbol,
        scoped,
        effectiveLocationId,
      );

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
    const { towarSymbol, positions, domyslnyMagazynId } = await this.readPositions(productId);
    const effectiveLocationId =
      locationId ?? this.resolveReleaseMagazynId(towarSymbol, positions, domyslnyMagazynId);
    const filtered = effectiveLocationId
      ? positions.filter((p) => String(p.magazynId) === effectiveLocationId)
      : positions;
    return filtered.reduce((sum, p) => sum + (p.stan - p.stanRez), 0);
  }

  /**
   * Which magazyn's stock this connection publishes, as a neutral
   * `locationId` string — or `null` when it cannot be determined, in which
   * case the caller falls back to the pre-fix behaviour of summing every
   * position.
   *
   * Precedence: the operator's explicit `stockMagazynId`, else the bridge's
   * own `domyslnyMagazynId` (the magazyn a movement for this towar lands in).
   *
   * SUMMING ACROSS MAGAZYNY IS AN OVERSELL, which is why this exists: a sale
   * releases from ONE warehouse, so publishing the total advertises units that
   * can never ship. A towar stocked in more than one magazyn with no explicit
   * operator choice is warned about, because the default is then a guess about
   * the operator's logistics rather than a fact we read.
   */
  private resolveReleaseMagazynId(
    towarSymbol: string,
    positions: BridgeInventoryStockRow[],
    domyslnyMagazynId: number | undefined,
  ): string | null {
    if (this.stockMagazynId !== undefined) {
      return String(this.stockMagazynId);
    }
    if (domyslnyMagazynId === undefined) {
      // A bridge predating the field. Behave exactly as before rather than
      // picking a warehouse on no information at all.
      return null;
    }
    if (positions.length > 1) {
      this.logger.warn(
        'subiekt_inventory_multi_magazyn_default: towar has stock in more than one magazyn and the connection names no release warehouse; publishing the bridge default. Set config.stockMagazynId to state it explicitly.',
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
  private async readPositions(productId: string): Promise<{
    towarSymbol: string;
    positions: BridgeInventoryStockRow[];
    domyslnyMagazynId: number | undefined;
  }> {
    const towarSymbol = await this.resolveTowarSymbol(productId);
    try {
      const response = await this.bridge.getStock(towarSymbol);
      return {
        towarSymbol,
        positions: response.positions,
        domyslnyMagazynId: response.domyslnyMagazynId,
      };
    } catch (error: unknown) {
      if (error instanceof SubiektRejectedError && this.looksLikeNotFound(error.reason)) {
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

  private toNeutralInventory(
    productId: string,
    towarSymbol: string,
    positions: BridgeInventoryStockRow[],
    locationId: string | null,
  ): Inventory {
    const quantity = positions.reduce((sum, p) => sum + p.stan, 0);
    const reserved = positions.reduce((sum, p) => sum + p.stanRez, 0);
    return {
      id: `subiekt:${this.connectionId}:${towarSymbol}`,
      productId,
      // The magazyn these figures came from. The bridge types have always said
      // the adapter maps `magazynId` onto this field; until now it did not,
      // which is why the caller could not tell a single-warehouse quantity from
      // a summed one. `null` keeps the position pooled, which on this master
      // means "the warehouse could not be determined" rather than "the master
      // declines to locate its stock".
      ...(locationId !== null ? { locationId } : {}),
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
