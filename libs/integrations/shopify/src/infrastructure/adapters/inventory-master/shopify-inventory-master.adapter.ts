/**
 * Shopify Inventory Master Adapter
 *
 * Implements `InventoryMasterPort` over the Admin GraphQL API (2026-10)
 * against ONE Shopify location: the connection's `config.locationId`, or the
 * shop's primary location (`ShopifyShopContextProvider`). OpenLinker runs as a
 * single warehouse until multi-location support arrives with a WMS, so stock
 * is never summed across locations - a variant not stocked at that location
 * reports 0, and stock elsewhere is invisible on purpose.
 *
 * `Inventory.locationId` stays UNDEFINED although the number is
 * location-scoped: a location-less row is pooled in OpenLinker, and the
 * operator maps the single warehouse onto an OpenLinker location with the
 * connection's `stockLocationOverride` (#3206). The Shopify GID would name a
 * location OpenLinker has no row for.
 *
 * Quantities: `available` is Shopify's sellable number, `committed` (held by
 * unfulfilled orders) is reported as `reserved`, `on_hand` as `quantity`.
 *
 * Also implements the guard-only `BulkInventoryReader` rung: a prefetch that
 * reads a batch's levels with `nodes(ids:)`.
 *
 * Load-bearing behaviours:
 *   - **Deletion** only where Shopify says so (`ShopifyInventoryReader`):
 *     `product: null` or ARCHIVED -> `MasterProductNotFoundError` (#1688).
 *   - **Untracked stock** (`tracked: false`) is reported at the connection's
 *     `unmanagedStockQuantity` (default 1000, the WooCommerce convention), so
 *     it neither zeroes live offers nor dead-letters a sweep job (L-I1).
 *     Writing stock to it is refused.
 *   - **The stock write is a delta on `available`, compare-and-set and
 *     idempotent.** Every core caller asks for a delta, so it is
 *     `inventoryAdjustQuantities`, not the absolute `inventorySetQuantities`.
 *     `changeFromQuantity` is the level read just before; a level that moved
 *     answers `CHANGE_FROM_QUANTITY_STALE` and writes nothing (G05). That is
 *     retried HERE, after a fresh read, because every core caller records any
 *     thrown error as an unknown outcome and never retries it - a refusal that
 *     wrote nothing must not read as "maybe applied".
 *   - **A refusal before the write is a `ShopifyNotSupportedException`**
 *     (variant not named, not the product's, untracked, not stocked at the
 *     location): the shape core reads as "refused, nothing written".
 *   - **A caller's idempotency key** is honoured twice over: Shopify's
 *     `@idempotent` key (`shopifyIdempotencyKey`) and a record in the host
 *     cache, written only after the write succeeded, so a later call with the
 *     same key applies nothing and answers `deduplicated` with the master's
 *     CURRENT level and the original instant (A18).
 *
 * `reserveInventory` / `releaseInventory` are deprecated on the port (ADR-061)
 * and refused.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/inventory-master
 * @implements {InventoryMasterPort}
 */
import { randomUUID } from 'node:crypto';

import type {
  BulkInventoryReader,
  Inventory,
  InventoryAdjustment,
  InventoryAdjustmentResult,
  InventoryMasterPort,
} from '@openlinker/core/inventory';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { CachePort } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyNotSupportedException } from '../../../domain/exceptions/shopify-not-supported.exception';
import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import { shopifyIdempotencyKey } from '../../../domain/policies/shopify-idempotency-key.policy';
import type {
  ShopifyInventoryLevel,
  ShopifyInventoryProduct,
  ShopifyInventoryVariant,
} from '../../../domain/types/shopify-api.types';
import { SHOPIFY_DEFAULT_UNMANAGED_STOCK_QUANTITY } from '../../../shopify.constants';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import { ShopifyBatchSizer } from '../../readers/shopify-cost-backoff';
import { resolveShopifyExternalId } from '../../readers/shopify-external-id';
import {
  ADJUST_AVAILABLE_MUTATION,
  PRODUCTS_INVENTORY_BY_IDS_QUERY,
} from '../../readers/shopify-inventory.queries';
import type { ShopifyInventoryReader } from '../../readers/shopify-inventory.reader';
import { SHOPIFY_PRODUCT_BATCH_SIZE } from '../../readers/shopify-product.queries';
import type { ShopifyShopContextProvider } from '../../shop-context/shopify-shop-context.provider';

/** Matches the `jobdedup:*` TTL, so the retry ladder's backoff cannot outlive the window (#2368). */
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 3600;
/** Compare-and-set attempts per write; a level moving three times in a row is left to the caller. */
const MAX_WRITE_ATTEMPTS = 3;

interface AdjustPayload {
  readonly inventoryAdjustmentGroup: {
    readonly createdAt: string;
    readonly changes: ReadonlyArray<{ readonly name: string; readonly quantityAfterChange?: number | null }>;
  } | null;
}

interface LevelNumbers {
  readonly available: number;
  readonly onHand: number;
  readonly committed: number;
  readonly updatedAt: Date | undefined;
}

export function readShopifyLevel(level: ShopifyInventoryLevel | null | undefined): LevelNumbers {
  const get = (name: string): number => level?.quantities.find((q) => q.name === name)?.quantity ?? 0;
  return {
    available: get('available'),
    onHand: get('on_hand'),
    committed: get('committed'),
    updatedAt: level?.updatedAt ? new Date(level.updatedAt) : undefined,
  };
}

export class ShopifyInventoryMasterAdapter implements InventoryMasterPort, BulkInventoryReader {
  private readonly logger = new Logger(ShopifyInventoryMasterAdapter.name);
  private readonly batchSizer = new ShopifyBatchSizer(SHOPIFY_PRODUCT_BATCH_SIZE);

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShopifyShopContextProvider,
    private readonly reader: ShopifyInventoryReader,
    private readonly connection: Connection,
    private readonly unmanagedStockQuantity: number | null,
    private readonly cache: CachePort | undefined,
  ) {}

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /** One `Inventory` per variant at the connection's location; untracked ones at the unmanaged cap. */
  async listInventory(productId: string): Promise<Inventory[]> {
    const { product } = await this.readProduct(productId);
    const variants = product.variants.nodes;
    const ids = await this.mintIds(productId, variants.map((v) => fromShopifyGid(v.id)));
    return variants.map((variant) => this.toInventory(productId, variant, ids, this.levelOf(variant)));
  }

  /**
   * The FIRST variant only, for a multi-variant product - the contract the
   * WooCommerce and Shoper adapters document. Per-variant callers use `listInventory`.
   */
  async getInventory(productId: string, _locationId?: string): Promise<Inventory> {
    const [first] = await this.listInventory(productId);
    if (first === undefined) {
      throw new ShopifyNotSupportedException(`read stock of product ${productId}, which has no variant`);
    }
    return first;
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    return (await this.getInventory(productId, locationId)).available;
  }

  /**
   * Warms the reader for a batch. Best effort: a failure leaves each product to
   * its own read, and a product Shopify no longer has is not warmed, so its
   * per-product read raises the deletion signal (never this path).
   */
  async prefetchInventory(internalProductIds: readonly string[]): Promise<void> {
    try {
      const { locationGid } = await this.shopContext.get();
      const byExternal = new Map<string, string>();
      for (const productId of new Set(internalProductIds)) {
        const mappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
        const externalId = mappings.find((m) => m.connectionId === this.connection.id)?.externalId;
        if (externalId !== undefined) {
          byExternal.set(externalId, productId);
        }
      }
      const externalIds = [...byExternal.keys()];
      let position = 0;
      while (position < externalIds.length) {
        const chunk = await this.batchSizer.run(async (size) => {
          const ids = externalIds.slice(position, position + size);
          const data = await this.client.query<{ nodes: ReadonlyArray<ShopifyInventoryProduct | null> }>(
            PRODUCTS_INVENTORY_BY_IDS_QUERY,
            { ids: ids.map((id) => toShopifyGid('Product', id)), locationId: locationGid, after: null },
          );
          return { count: ids.length, nodes: data.nodes };
        });
        for (const node of chunk.nodes) {
          if (node !== null && typeof node.id === 'string') {
            this.reader.seed(fromShopifyGid(node.id), node, locationGid);
          }
        }
        position += chunk.count;
      }
    } catch (error) {
      this.logger.warn(
        `Shopify bulk inventory prefetch failed for ${internalProductIds.length} product(s) ` +
          `(connection: ${this.connection.id}); falling back to per-product reads: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  async adjustInventory(adjustment: InventoryAdjustment): Promise<InventoryAdjustmentResult> {
    const externalId = await this.resolveExternalProductId(adjustment.productId);
    // The level compared against must be the shop's, not one memoised earlier
    // in this resolution (a sweep prefetch, a listInventory).
    this.reader.forget(externalId);
    const { product, locationGid } = await this.readProduct(adjustment.productId, externalId);
    const variant = await this.pickVariant(product.variants.nodes, adjustment);
    const variantExternalId = fromShopifyGid(variant.id);
    // Ids are minted BEFORE the write: failing after it would report an error
    // (in doubt) for a change that definitely landed.
    const ids = await this.mintIds(adjustment.productId, [variantExternalId]);

    const callerKey = adjustment.idempotencyKey?.trim() ?? '';
    const memoKey = callerKey.length === 0 ? null : `shopify:inventory-adjust:${this.connection.id}:${callerKey}`;
    if (memoKey !== null && this.cache !== undefined) {
      const seen = await this.cache.get<{ appliedAt: string | null }>(memoKey).catch(() => null);
      if (seen !== null) {
        // The master's CURRENT level, never a replay of the old figure.
        return {
          ...this.toInventory(adjustment.productId, variant, ids, this.writableLevel(variant, locationGid)),
          adjustmentOutcome: {
            disposition: 'deduplicated',
            idempotency: 'honoured',
            appliedAt: seen.appliedAt === null ? null : new Date(seen.appliedAt),
          },
        };
      }
    }

    let current = variant;
    let after: LevelNumbers | null = null;
    let appliedAt: Date | null = null;
    let wrote = false;
    for (let attempt = 1; after === null; attempt += 1) {
      const level = this.writableLevel(current, locationGid);
      const delta = this.clampedDelta(level, adjustment.quantity, variantExternalId);
      if (delta === 0) {
        after = level;
        break;
      }
      this.logger.log(
        `Adjusting Shopify variant ${variantExternalId} by ${delta}` +
          `${adjustment.reason !== undefined ? ` (${adjustment.reason})` : ''} at ${locationGid}, ` +
          `${level.available} -> ${level.available + delta}, attempt ${attempt} (connection: ${this.connection.id})`,
      );
      try {
        const payload = await this.client.mutate<AdjustPayload>(
          ADJUST_AVAILABLE_MUTATION,
          {
            key:
              callerKey.length > 0
                ? shopifyIdempotencyKey(this.connection.id, callerKey, attempt)
                : randomUUID(),
            input: {
              name: 'available',
              reason: adjustment.reason === 'return_restock' ? 'restock' : 'correction',
              changes: [
                {
                  inventoryItemId: current.inventoryItem.id,
                  locationId: locationGid,
                  delta,
                  changeFromQuantity: level.available,
                },
              ],
            },
          },
          'inventoryAdjustQuantities',
        );
        wrote = true;
        const group = payload.inventoryAdjustmentGroup;
        appliedAt = group === null ? null : new Date(group.createdAt);
        const availableAfter = group?.changes.find((c) => c.name === 'available')?.quantityAfterChange;
        after = {
          available: typeof availableAfter === 'number' ? availableAfter : level.available + delta,
          onHand: level.onHand + delta,
          committed: level.committed,
          updatedAt: appliedAt ?? undefined,
        };
      } catch (error) {
        if (
          error instanceof ShopifyUserErrorsException &&
          error.isStaleCompareAndSet() &&
          attempt < MAX_WRITE_ATTEMPTS
        ) {
          // Nothing was written: read the level again and compare against that.
          this.logger.log(
            `Shopify stock of variant ${variantExternalId} moved since it was read; re-reading ` +
              `(attempt ${attempt}, connection: ${this.connection.id})`,
          );
          current = await this.rereadVariant(adjustment.productId, externalId, variantExternalId, locationGid);
          continue;
        }
        throw error;
      }
    }

    if (memoKey !== null && this.cache !== undefined && wrote) {
      // Recorded only AFTER the write succeeded: recording first would
      // suppress the retry of an adjustment that never landed.
      await this.cache
        .set(memoKey, { appliedAt: appliedAt?.toISOString() ?? null }, IDEMPOTENCY_TTL_SECONDS)
        .catch(() => undefined);
    }

    return {
      ...this.toInventory(adjustment.productId, variant, ids, after),
      adjustmentOutcome: {
        disposition: 'applied',
        idempotency: memoKey === null ? 'not_requested' : this.cache === undefined ? 'unsupported' : 'honoured',
        appliedAt,
      },
    };
  }

  reserveInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(new ShopifyNotSupportedException('reserveInventory'));
  }

  releaseInventory(_productId: string, _quantity: number, _orderId: string): Promise<void> {
    return Promise.reject(new ShopifyNotSupportedException('releaseInventory'));
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private resolveExternalProductId(productId: string): Promise<string> {
    return resolveShopifyExternalId(this.identifierMapping, this.connection.id, CORE_ENTITY_TYPE.Product, productId);
  }

  private async readProduct(
    productId: string,
    knownExternalId?: string,
  ): Promise<{ product: ShopifyInventoryProduct; locationGid: string }> {
    const externalId = knownExternalId ?? (await this.resolveExternalProductId(productId));
    const { locationGid } = await this.shopContext.get();
    const product = await this.reader.read(externalId, productId, locationGid);
    if (product.variants.pageInfo?.hasNextPage === true) {
      this.logger.warn(
        `Shopify product ${externalId} has more variants than were read; only the first ` +
          `${product.variants.nodes.length} are reported (connection: ${this.connection.id})`,
      );
    }
    return { product, locationGid };
  }

  private async rereadVariant(
    productId: string,
    externalId: string,
    variantExternalId: string,
    locationGid: string,
  ): Promise<ShopifyInventoryVariant> {
    this.reader.forget(externalId);
    const product = await this.reader.read(externalId, productId, locationGid);
    const variant = product.variants.nodes.find((v) => fromShopifyGid(v.id) === variantExternalId);
    if (variant === undefined) {
      throw new ShopifyNotSupportedException(
        `adjust stock of Shopify variant ${variantExternalId}, which is no longer a variant of product ${productId}`,
      );
    }
    return variant;
  }

  /** The level a read reports: the location's figures, or the unmanaged cap for an untracked variant. */
  private levelOf(variant: ShopifyInventoryVariant): LevelNumbers {
    if (!variant.inventoryItem.tracked) {
      const unmanaged = this.unmanagedStockQuantity ?? SHOPIFY_DEFAULT_UNMANAGED_STOCK_QUANTITY;
      return { available: unmanaged, onHand: unmanaged, committed: 0, updatedAt: undefined };
    }
    return readShopifyLevel(variant.inventoryItem.inventoryLevel);
  }

  /** The level a write compares against; refused (nothing written) where there is none to write. */
  private writableLevel(variant: ShopifyInventoryVariant, locationGid: string): LevelNumbers {
    if (!variant.inventoryItem.tracked) {
      throw new ShopifyNotSupportedException('adjust stock of a variant that does not track stock');
    }
    const level = variant.inventoryItem.inventoryLevel;
    if (level === null || level === undefined) {
      throw new ShopifyNotSupportedException(
        `adjust stock of a variant not stocked at the configured location ${locationGid}`,
      );
    }
    return readShopifyLevel(level);
  }

  /** The delta to send: a removal past zero stops at zero, as the other masters do. */
  private clampedDelta(level: LevelNumbers, requested: number, variantExternalId: string): number {
    if (level.available + requested >= 0) {
      return requested;
    }
    this.logger.warn(
      `Shopify variant ${variantExternalId} would go to ${level.available + requested} available; ` +
        `clamped to 0 (connection: ${this.connection.id})`,
    );
    return -level.available;
  }

  /**
   * A product with one variant resolves to it without a `variantId`; with
   * several, the variant must be named - writing the first would move the
   * wrong variant's stock.
   */
  private async pickVariant(
    variants: readonly ShopifyInventoryVariant[],
    adjustment: InventoryAdjustment,
  ): Promise<ShopifyInventoryVariant> {
    if (adjustment.variantId !== undefined) {
      const variantExternalId = await resolveShopifyExternalId(
        this.identifierMapping,
        this.connection.id,
        CORE_ENTITY_TYPE.ProductVariant,
        adjustment.variantId,
      );
      const match = variants.find((v) => fromShopifyGid(v.id) === variantExternalId);
      if (match === undefined) {
        throw new ShopifyNotSupportedException(
          `adjust stock of Shopify variant ${variantExternalId}, which is not a variant of product ${adjustment.productId}`,
        );
      }
      return match;
    }
    if (variants.length === 1) {
      return variants[0];
    }
    throw new ShopifyNotSupportedException(
      `adjust stock of product ${adjustment.productId} without naming one of its ${variants.length} variants`,
    );
  }

  private toInventory(
    productId: string,
    variant: ShopifyInventoryVariant,
    ids: MintedIds,
    level: LevelNumbers,
  ): Inventory {
    const variantExternalId = fromShopifyGid(variant.id);
    const variantId = ids.variants.get(`${variantExternalId}:${this.connection.id}`);
    const inventoryId = ids.levels.get(`level:${variantExternalId}:${this.connection.id}`);
    if (variantId === undefined || inventoryId === undefined) {
      throw new Error(
        `Missing internal id for Shopify variant ${variantExternalId} on connection ${this.connection.id}`,
      );
    }
    return {
      id: inventoryId,
      productId,
      variantId,
      // Pooled on purpose - see the file header.
      locationId: undefined,
      quantity: level.onHand,
      reserved: level.committed,
      available: level.available,
      updatedAt: level.updatedAt,
    };
  }

  private async mintIds(productId: string, variantExternalIds: readonly string[]): Promise<MintedIds> {
    const [variants, levels] = await Promise.all([
      this.identifierMapping.batchGetOrCreateInternalIds(
        variantExternalIds.map((id) => ({
          entityType: CORE_ENTITY_TYPE.ProductVariant,
          externalId: id,
          connectionId: this.connection.id,
          context: {
            parentEntityType: CORE_ENTITY_TYPE.Product,
            parentInternalId: productId,
            metadata: { variantExternalId: id },
          },
        })),
      ),
      this.identifierMapping.batchGetOrCreateInternalIds(
        variantExternalIds.map((id) => ({
          entityType: CORE_ENTITY_TYPE.Inventory,
          externalId: `level:${id}`,
          connectionId: this.connection.id,
          context: { parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: productId },
        })),
      ),
    ]);
    return { variants, levels };
  }
}

interface MintedIds {
  readonly variants: Map<string, string>;
  readonly levels: Map<string, string>;
}
