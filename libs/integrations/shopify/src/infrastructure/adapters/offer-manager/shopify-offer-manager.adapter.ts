/**
 * Shopify Offer Manager Adapter (#3980)
 *
 * Implements the `OfferManagerPort` base method only - stock write-back to
 * products OpenLinker PUBLISHED to this shop, the WooCommerce #1498 shape.
 * The command's `offerId` is the external id of the `ShopProduct` mapping the
 * publish wrote for the internal variant, which the propagation fan-out reads
 * variant-keyed:
 *   - a simple product: the Shopify PRODUCT id (and a `ShopProductVariant`
 *     mapping for the same internal variant holds its single variant id);
 *   - a variant of a multi-variant product: the Shopify VARIANT id.
 * Both are bare numeric tails, so the id is resolved, never guessed:
 *   1. the `ShopProductVariant` mapping, when the publish wrote one and the
 *      variant it names still belongs to the product `offerId` names;
 *   2. otherwise one `nodes(ids:)` read of `offerId` as a variant AND as a
 *      product. A variant resolves to itself; a product with exactly one
 *      variant resolves to it; a product with several variants, or an id that
 *      names both a product and a variant, is refused - writing a guessed
 *      variant would move the wrong stock.
 *
 * The write is an ABSOLUTE set, at the connection's one location only
 * (`ShopifyShopContextProvider`), and compare-and-set: `inventorySetQuantities`
 * carries `changeFromQuantity` = the level just read, so a level that moved
 * in between is refused (`CHANGE_FROM_QUANTITY_STALE`, retryable: the retry
 * re-reads) instead of silently overwriting a sale. The required `@idempotent`
 * key is derived from the command's key AND the read level, so a retry that
 * read the same level replays the same request, while a retry that read a
 * moved level is a new request to the same absolute target - which is safe,
 * because setting N twice is N. A write that would not change the level is
 * skipped. Without a command key the request key is random.
 *
 * Untracked stock is REFUSED, never switched on: tracking is the merchant's
 * decision, and turning it on silently would make an "always available"
 * product sell out. A variant not stocked at the location is activated there
 * first (`inventoryActivate`), then set.
 *
 * A mapping whose product and variant are both gone shop-side is deleted
 * (the WooCommerce #1846 behaviour), so it stops failing on every stock
 * change and the next publish re-creates the product.
 *
 * `OfferManager` is advertised but NOT enabled by default, and the
 * propagation fan-out skips a connection that also has `InventoryMaster`
 * enabled (`inventory-propagate-to-marketplaces.handler`): the master must
 * never be a write-back target, so enabling both writes nothing back.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/offer-manager
 * @implements {OfferManagerPort}
 */
import { createHash, randomUUID } from 'node:crypto';

import type { OfferManagerPort, UpdateOfferQuantityCommand } from '@openlinker/core/listings';
import {
  CORE_ENTITY_TYPE,
  type Connection,
  type IdentifierMappingPort,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShopifyStockWriteRefusedException } from '../../../domain/exceptions/shopify-stock-write-refused.exception';
import { fromShopifyGid, toShopifyGid } from '../../../domain/policies/shopify-gid.policy';
import type { ShopifyConnection, ShopifyInventoryQuantity } from '../../../domain/types/shopify-api.types';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import type { ShopifyShopContextProvider } from '../../shop-context/shopify-shop-context.provider';

const NUMERIC_ID = /^\d+$/;

interface StockVariantRow {
  readonly id: string;
  readonly product?: { readonly id: string } | null;
  readonly inventoryItem: {
    readonly id: string;
    readonly tracked: boolean;
    readonly inventoryLevel: { readonly quantities: readonly ShopifyInventoryQuantity[] } | null;
  };
}

type TargetNode =
  | ({ readonly __typename: 'ProductVariant' } & StockVariantRow)
  | {
      readonly __typename: 'Product';
      readonly id: string;
      readonly variants: ShopifyConnection<StockVariantRow>;
    };

const VARIANT_STOCK_FIELDS = `
  id
  inventoryItem {
    id tracked
    inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } }
  }
`;

const RESOLVE_TARGET_QUERY = `query OlStockWriteTarget($ids: [ID!]!, $locationId: ID!) {
  nodes(ids: $ids) {
    __typename
    ... on ProductVariant { ${VARIANT_STOCK_FIELDS} product { id } }
    ... on Product { id variants(first: 2) { nodes { ${VARIANT_STOCK_FIELDS} } } }
  }
}`;

const SET_QUANTITIES_MUTATION = `mutation OlSetStock($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { createdAt changes { name delta quantityAfterChange } }
    userErrors { field message code }
  }
}`;

const ACTIVATE_MUTATION = `mutation OlActivateStock($inventoryItemId: ID!, $locationId: ID!) {
  inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
    inventoryLevel { quantities(names: ["available"]) { name quantity } }
    userErrors { field message code }
  }
}`;

interface ActivatePayload {
  readonly inventoryLevel: { readonly quantities: readonly ShopifyInventoryQuantity[] } | null;
}

interface SetPayload {
  readonly inventoryAdjustmentGroup: {
    readonly changes: ReadonlyArray<{ readonly name: string; readonly quantityAfterChange: number | null }>;
  } | null;
}

function available(quantities: readonly ShopifyInventoryQuantity[] | undefined): number {
  return quantities?.find((q) => q.name === 'available')?.quantity ?? 0;
}

export class ShopifyOfferManagerAdapter implements OfferManagerPort {
  private readonly logger = new Logger(ShopifyOfferManagerAdapter.name);

  constructor(
    private readonly client: ShopifyGraphqlClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly shopContext: ShopifyShopContextProvider,
    private readonly connection: Connection,
  ) {}

  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    const externalId = String(cmd.offerId).trim();
    // Fail closed before any request: the same job is reachable through the
    // admin sync-jobs route with an arbitrary `offerId`.
    if (!NUMERIC_ID.test(externalId)) {
      throw new ShopifyStockWriteRefusedException(externalId, this.connection.id, 'not a Shopify numeric id');
    }
    if (!Number.isInteger(cmd.quantity) || cmd.quantity < 0) {
      throw new ShopifyStockWriteRefusedException(
        externalId,
        this.connection.id,
        `quantity must be a non-negative integer, got ${JSON.stringify(cmd.quantity)}`,
      );
    }

    const { locationGid } = await this.shopContext.get();
    const variant = await this.resolveVariant(externalId, locationGid);
    if (variant === null) {
      this.logger.warn(
        `Shopify product/variant ${externalId} not found on connection ${this.connection.id}; ` +
          `stale ShopProduct mapping deleted so a future publish re-creates it ` +
          `(quantity=${cmd.quantity} not written this run)`,
      );
      await this.identifierMapping.deleteMapping(CORE_ENTITY_TYPE.ShopProduct, externalId, this.connection.id);
      return;
    }
    const variantId = fromShopifyGid(variant.id);
    if (!variant.inventoryItem.tracked) {
      throw new ShopifyStockWriteRefusedException(
        externalId,
        this.connection.id,
        `variant ${variantId} does not track stock; switch on "Track quantity" for it in Shopify`,
      );
    }

    let current: number;
    if (variant.inventoryItem.inventoryLevel === null) {
      current = await this.activate(variant.inventoryItem.id, locationGid, variantId);
    } else {
      current = available(variant.inventoryItem.inventoryLevel.quantities);
    }
    if (current === cmd.quantity) {
      this.logger.debug(
        `Shopify variant ${variantId} already at ${cmd.quantity} available; skipped (connection: ${this.connection.id})`,
      );
      return;
    }

    const payload = await this.client.mutate<SetPayload>(
      SET_QUANTITIES_MUTATION,
      {
        key: this.requestKey(cmd.idempotencyKey, variantId, current, cmd.quantity),
        input: {
          name: 'available',
          reason: 'correction',
          quantities: [
            {
              inventoryItemId: variant.inventoryItem.id,
              locationId: locationGid,
              quantity: cmd.quantity,
              changeFromQuantity: current,
            },
          ],
        },
      },
      'inventorySetQuantities',
    );
    const after = payload.inventoryAdjustmentGroup?.changes.find((c) => c.name === 'available')
      ?.quantityAfterChange;
    this.logger.log(
      `Set Shopify variant ${variantId} available ${current} -> ${after ?? cmd.quantity} at ${locationGid} ` +
        `(offer ${externalId}, connection: ${this.connection.id})`,
    );
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async resolveVariant(externalId: string, locationGid: string): Promise<StockVariantRow | null> {
    const hinted = await this.variantFromMapping(externalId);
    if (hinted !== null) {
      const [node] = await this.readNodes([toShopifyGid('ProductVariant', hinted)], locationGid);
      // Used only when the variant still belongs to the product `offerId`
      // names; otherwise the mapping is stale and the direct read decides.
      if (
        node !== null &&
        node.__typename === 'ProductVariant' &&
        node.product !== null &&
        node.product !== undefined &&
        fromShopifyGid(node.product.id) === externalId
      ) {
        return node;
      }
    }

    const [asVariant, asProduct] = await this.readNodes(
      [toShopifyGid('ProductVariant', externalId), toShopifyGid('Product', externalId)],
      locationGid,
    );
    const variant = asVariant !== null && asVariant.__typename === 'ProductVariant' ? asVariant : null;
    const product = asProduct !== null && asProduct.__typename === 'Product' ? asProduct : null;
    if (variant !== null && product !== null) {
      throw new ShopifyStockWriteRefusedException(
        externalId,
        this.connection.id,
        'the id names both a product and a variant; re-publish so the variant mapping is written',
      );
    }
    if (variant !== null) {
      return variant;
    }
    if (product === null) {
      return null;
    }
    if (product.variants.nodes.length !== 1) {
      throw new ShopifyStockWriteRefusedException(
        externalId,
        this.connection.id,
        `product has ${product.variants.nodes.length} variants; the mapping must name one variant`,
      );
    }
    return product.variants.nodes[0];
  }

  /** The single variant id the publish recorded for the internal variant behind `offerId`, if any. */
  private async variantFromMapping(externalId: string): Promise<string | null> {
    const internalVariantId = await this.identifierMapping.getInternalId(
      CORE_ENTITY_TYPE.ShopProduct,
      externalId,
      this.connection.id,
    );
    if (internalVariantId === null) {
      return null;
    }
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.ShopProductVariant,
      internalVariantId,
    );
    const own = mappings.filter((m) => m.connectionId === this.connection.id);
    return own.length === 1 && NUMERIC_ID.test(own[0].externalId) ? own[0].externalId : null;
  }

  private async readNodes(ids: readonly string[], locationGid: string): Promise<Array<TargetNode | null>> {
    const data = await this.client.query<{ nodes: Array<TargetNode | null> }>(RESOLVE_TARGET_QUERY, {
      ids,
      locationId: locationGid,
    });
    return ids.map((_, index) => data.nodes[index] ?? null);
  }

  /** Stocks the item at the location and returns its `available` there (0 for a fresh level). */
  private async activate(inventoryItemId: string, locationGid: string, variantId: string): Promise<number> {
    this.logger.log(
      `Shopify variant ${variantId} is not stocked at ${locationGid}; activating it there ` +
        `(connection: ${this.connection.id})`,
    );
    const payload = await this.client.mutate<ActivatePayload>(
      ACTIVATE_MUTATION,
      { inventoryItemId, locationId: locationGid },
      'inventoryActivate',
    );
    return available(payload.inventoryLevel?.quantities);
  }

  private requestKey(
    commandKey: string | undefined,
    variantId: string,
    changeFrom: number,
    quantity: number,
  ): string {
    const key = commandKey?.trim();
    if (key === undefined || key.length === 0) {
      return randomUUID();
    }
    // Hashed: the propagation key is long and carries internal ids.
    return createHash('sha256')
      .update(`${this.connection.id}|${key}|${variantId}|${changeFrom}|${quantity}`)
      .digest('hex');
  }
}
