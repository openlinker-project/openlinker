/**
 * Shopify Inventory Master Adapter
 *
 * Implements `InventoryMasterPort` over the Admin GraphQL API, against ONE
 * Shopify location: the connection's `config.locationId`, or the shop's
 * primary location (`ShopifyShopContextProvider`). OpenLinker runs as a single
 * warehouse until multi-location support arrives with a WMS, so stock is never
 * summed across locations - a variant not stocked at that location reports 0,
 * and stock elsewhere is invisible on purpose.
 *
 * `Inventory.locationId` is left UNDEFINED even though the number is
 * location-scoped: OpenLinker treats a location-less row as pooled, and the
 * operator maps the single warehouse onto an OpenLinker location through the
 * connection's own `stockLocationOverride` (#3206). Reporting the Shopify GID
 * here would name a location OpenLinker has no row for.
 *
 * Quantities: `available` is Shopify's sellable number, `committed` is what
 * unfulfilled orders hold (reported as `reserved`), `on_hand` is the physical
 * count (reported as `quantity`).
 *
 * Three behaviours are load-bearing:
 *   - **Deletion** is reported only where Shopify says so: `product: null`
 *     becomes the neutral `MasterProductNotFoundError` (#1688).
 *   - **Untracked stock is refused, never guessed.** A variant with tracking
 *     off is "always available" on Shopify; reporting 0 would zero live
 *     offers and a large number would oversell. Such variants are skipped
 *     with a warning, and a product whose every variant is untracked raises
 *     `ShopifyUntrackedInventoryException` rather than an empty list (an empty
 *     list would stale every variant through the master-sync prune).
 *   - **The stock write is compare-and-set and idempotent.**
 *     `inventoryAdjustQuantities` carries `changeFromQuantity` (refused when
 *     the level moved since our read) and the REQUIRED `@idempotent` directive.
 *     A caller-supplied idempotency key is also remembered in the host cache
 *     after a successful write, so a job retry that re-reads a moved level
 *     (and would therefore send a different body under the same key) is
 *     recognised as already applied instead of reaching Shopify again.
 *
 * `reserveInventory` / `releaseInventory` are deprecated on the port (ADR-061)
 * and throw `ShopifyNotSupportedException`.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/inventory-master
 * @implements {InventoryMasterPort}
 */
import { randomUUID } from 'node:crypto';

import type {
  Inventory,
  InventoryAdjustment,
  InventoryAdjustmentResult,
  InventoryMasterPort,
} from '@openlinker/core/inventory';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { CachePort } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyNotSupportedException } from '../../../domain/exceptions/shopify-not-supported.exception';
import { ShopifyUntrackedInventoryException } from '../../../domain/exceptions/shopify-untracked-inventory.exception';
import { ShopifyVariantNotFoundException } from '../../../domain/exceptions/shopify-variant-not-found.exception';
import { ShopifyVariantRequiredException } from '../../../domain/exceptions/shopify-variant-required.exception';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type {
  ShopifyConnection,
  ShopifyInventoryItem,
  ShopifyInventoryLevel,
} from '../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import { resolveShopifyExternalId } from '../../readers/shopify-external-id';
import { PRODUCT_INVENTORY_QUERY } from '../../readers/shopify-product.queries';
import type { ShopifyShopContextProvider } from '../../shop-context/shopify-shop-context.provider';

/** Matches the `jobdedup:*` TTL, so the retry ladder's backoff cannot outlive the window (#2368). */
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 3600;

interface InventoryVariantRow {
  readonly id: string;
  readonly inventoryItem: ShopifyInventoryItem;
}

interface ProductInventoryQuery {
  readonly product: {
    readonly id: string;
    readonly variants: ShopifyConnection<InventoryVariantRow>;
  } | null;
}

interface AdjustPayload {
  readonly inventoryAdjustmentGroup: {
    readonly createdAt: string;
    readonly changes: ReadonlyArray<{ readonly name: string; readonly quantityAfterChange: number | null }>;
  } | null;
}

const ADJUST_MUTATION = `mutation OlAdjustStock($input: InventoryAdjustQuantitiesInput!, $key: String!) {
  inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { createdAt changes { name delta quantityAfterChange } }
    userErrors { field message code }
  }
}`;

interface LevelNumbers {
  readonly available: number;
  readonly onHand: number;
  readonly committed: number;
  readonly updatedAt: Date | undefined;
}

function readLevel(level: ShopifyInventoryLevel | null | undefined): LevelNumbers {
  const get = (name: string): number =>
    level?.quantities.find((q) => q.name === name)?.quantity ?? 0;
  return {
    available: get('available'),
    onHand: get('on_hand'),
    committed: get('committed'),
    updatedAt: level?.updatedAt ? new Date(level.updatedAt) : undefined,
  };
}

export class ShopifyInventoryMasterAdapter implements InventoryMasterPort {
  private readonly logger = new Logger(ShopifyInventoryMasterAdapter.name);

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShopifyShopContextProvider,
    private readonly connection: Connection,
    private readonly cache: CachePort | undefined,
  ) {}

  // ─── Read methods ──────────────────────────────────────────────────────────

  /** One `Inventory` per TRACKED variant, at the connection's single location. */
  async listInventory(productId: string): Promise<Inventory[]> {
    const externalId = await this.resolveExternalProductId(productId);
    const variants = await this.readVariants(externalId, productId);
    const tracked = variants.filter((v) => v.inventoryItem.tracked);
    const untracked = variants.length - tracked.length;
    if (untracked > 0) {
      this.logger.warn(
        `Shopify product ${externalId}: ${untracked} variant(s) do not track stock and are not synced ` +
          `(connection: ${this.connection.id})`,
      );
    }
    if (tracked.length === 0) {
      throw new ShopifyUntrackedInventoryException(productId, this.connection.id);
    }

    const [variantIds, inventoryIds] = await this.mintIds(productId, tracked.map((v) => fromShopifyGid(v.id)));
    return tracked.map((variant) => {
      const variantExternalId = fromShopifyGid(variant.id);
      return this.toInventory(
        productId,
        variantIds.get(`${variantExternalId}:${this.connection.id}`),
        inventoryIds.get(`level:${variantExternalId}:${this.connection.id}`),
        variantExternalId,
        readLevel(variant.inventoryItem.inventoryLevel),
      );
    });
  }

  /**
   * The FIRST tracked variant only, for a multi-variant product - the contract
   * the WooCommerce and Shoper adapters document. Callers needing per-variant
   * precision use `listInventory`.
   */
  async getInventory(productId: string, _locationId?: string): Promise<Inventory> {
    const [first] = await this.listInventory(productId);
    return first;
  }

  async getAvailableQuantity(productId: string, locationId?: string): Promise<number> {
    return (await this.getInventory(productId, locationId)).available;
  }

  // ─── Write ─────────────────────────────────────────────────────────────────

  async adjustInventory(adjustment: InventoryAdjustment): Promise<InventoryAdjustmentResult> {
    const externalId = await this.resolveExternalProductId(adjustment.productId);
    const variant = await this.pickVariant(
      await this.readVariants(externalId, adjustment.productId),
      adjustment,
    );
    if (!variant.inventoryItem.tracked) {
      throw new ShopifyNotSupportedException('adjust stock of a variant that does not track stock');
    }
    const { locationGid } = await this.shopContext.get();
    if (variant.inventoryItem.inventoryLevel === null || variant.inventoryItem.inventoryLevel === undefined) {
      throw new ShopifyNotSupportedException(
        `adjust stock of a variant not stocked at the configured location ${locationGid}`,
      );
    }

    const variantExternalId = fromShopifyGid(variant.id);
    // Ids are minted BEFORE the write: failing after it would report an error
    // (in doubt) for a change that definitely landed.
    const [variantIds, inventoryIds] = await this.mintIds(adjustment.productId, [variantExternalId]);
    const variantId = variantIds.get(`${variantExternalId}:${this.connection.id}`);
    const inventoryId = inventoryIds.get(`level:${variantExternalId}:${this.connection.id}`);
    const current = readLevel(variant.inventoryItem.inventoryLevel);
    const callerKey = adjustment.idempotencyKey?.trim();
    const memoKey =
      callerKey === undefined || callerKey.length === 0
        ? null
        : `shopify:inventory-adjust:${this.connection.id}:${callerKey}`;

    if (memoKey !== null && this.cache !== undefined) {
      const seen = await this.cache.get<{ appliedAt: string | null }>(memoKey).catch(() => null);
      if (seen !== null) {
        // Report the master's CURRENT level, never a replay of the old figure.
        return {
          ...this.toInventory(adjustment.productId, variantId, inventoryId, variantExternalId, current),
          adjustmentOutcome: {
            disposition: 'deduplicated',
            idempotency: 'honoured',
            appliedAt: seen.appliedAt === null ? null : new Date(seen.appliedAt),
          },
        };
      }
    }

    const requested = current.available + adjustment.quantity;
    const delta = requested < 0 ? -current.available : adjustment.quantity;
    if (delta !== adjustment.quantity) {
      this.logger.warn(
        `Shopify variant ${variantExternalId} would go to ${requested} available; clamped to 0 ` +
          `(connection: ${this.connection.id})`,
      );
    }
    this.logger.log(
      `Adjusting Shopify variant ${variantExternalId} by ${delta}` +
        `${adjustment.reason !== undefined ? ` (${adjustment.reason})` : ''} at ${locationGid}, ` +
        `${current.available} -> ${current.available + delta} (connection: ${this.connection.id})`,
    );

    let after = current;
    let appliedAt: Date | null = null;
    if (delta !== 0) {
      const payload = await this.client.mutate<AdjustPayload>(
        ADJUST_MUTATION,
        {
          key: callerKey !== undefined && callerKey.length > 0 ? callerKey : randomUUID(),
          input: {
            name: 'available',
            reason: adjustment.reason === 'return_restock' ? 'restock' : 'correction',
            changes: [
              {
                inventoryItemId: variant.inventoryItem.id,
                locationId: locationGid,
                delta,
                changeFromQuantity: current.available,
              },
            ],
          },
        },
        'inventoryAdjustQuantities',
      );
      const group = payload.inventoryAdjustmentGroup;
      const availableAfter = group?.changes.find((c) => c.name === 'available')?.quantityAfterChange;
      appliedAt = group === null ? null : new Date(group.createdAt);
      after = {
        available: availableAfter ?? current.available + delta,
        onHand: current.onHand + delta,
        committed: current.committed,
        updatedAt: appliedAt ?? undefined,
      };
    }

    if (memoKey !== null && this.cache !== undefined) {
      // Recorded only AFTER the write succeeded: recording first would
      // suppress the retry of an adjustment that never landed.
      await this.cache
        .set(memoKey, { appliedAt: appliedAt?.toISOString() ?? null }, IDEMPOTENCY_TTL_SECONDS)
        .catch(() => undefined);
    }

    return {
      ...this.toInventory(adjustment.productId, variantId, inventoryId, variantExternalId, after),
      adjustmentOutcome: {
        disposition: 'applied',
        idempotency:
          memoKey === null ? 'not_requested' : this.cache === undefined ? 'unsupported' : 'honoured',
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
    return resolveShopifyExternalId(
      this.identifierMapping,
      this.connection.id,
      CORE_ENTITY_TYPE.Product,
      productId,
    );
  }

  private async readVariants(externalId: string, productId: string): Promise<readonly InventoryVariantRow[]> {
    const { locationGid } = await this.shopContext.get();
    const data = await this.client.query<ProductInventoryQuery>(PRODUCT_INVENTORY_QUERY, {
      id: toShopifyGid('Product', externalId),
      locationId: locationGid,
    });
    if (data.product === null) {
      throw new MasterProductNotFoundError(productId, this.connection.id);
    }
    if (data.product.variants.pageInfo?.hasNextPage === true) {
      this.logger.warn(
        `Shopify product ${externalId} has more variants than one page; only the first ` +
          `${data.product.variants.nodes.length} are read (connection: ${this.connection.id})`,
      );
    }
    return data.product.variants.nodes;
  }

  /**
   * A product with one variant resolves to it without a `variantId`; with
   * several, the variant must be named - writing the first would move the
   * wrong variant's stock.
   */
  private async pickVariant(
    variants: readonly InventoryVariantRow[],
    adjustment: InventoryAdjustment,
  ): Promise<InventoryVariantRow> {
    if (adjustment.variantId !== undefined) {
      const variantExternalId = await resolveShopifyExternalId(
        this.identifierMapping,
        this.connection.id,
        CORE_ENTITY_TYPE.ProductVariant,
        adjustment.variantId,
      );
      const match = variants.find((v) => fromShopifyGid(v.id) === variantExternalId);
      if (match === undefined) {
        throw new ShopifyVariantNotFoundException(
          adjustment.productId,
          variantExternalId,
          this.connection.id,
        );
      }
      return match;
    }
    if (variants.length === 1) {
      return variants[0];
    }
    throw new ShopifyVariantRequiredException(adjustment.productId, this.connection.id);
  }

  private toInventory(
    productId: string,
    variantId: string | undefined,
    inventoryId: string | undefined,
    variantExternalId: string,
    level: LevelNumbers,
  ): Inventory {
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

  private mintIds(
    productId: string,
    variantExternalIds: readonly string[],
  ): Promise<[Map<string, string>, Map<string, string>]> {
    return Promise.all([
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
  }
}
