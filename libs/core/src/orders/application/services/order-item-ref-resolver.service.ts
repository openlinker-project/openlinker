/**
 * Order Item Ref Resolver Service
 *
 * Resolves external-only IncomingOrder item references to internal OpenLinker IDs.
 *
 * ## The `ShopProduct` fallback (#3365)
 *
 * A `product` or `variant` ref is normally answered by the mapping a
 * ProductMaster sweep wrote while reading that platform's catalogue. But an
 * OpenLinker-managed shop is frequently the other way round: the catalogue
 * lives in an ERP, OpenLinker PUBLISHES to the shop, and the order comes back.
 * On that topology no ProductMaster sweep ever ran against the shop, so no
 * `Product` / `ProductVariant` mapping exists for it - the only record of the
 * shop-side identity is the `ShopProduct` mapping
 * `ProductPublishExecutionService` writes at publish time. Without consulting
 * it, the line either failed to resolve at all, or (where the shop was ALSO
 * swept as a master) resolved to the duplicate product that sweep created,
 * which carries no mapping back to the real catalogue.
 *
 * The fallback runs only AFTER the primary mapping misses, which keeps the
 * precedence right: a shop that really is a ProductMaster has the sweep's own
 * identity for the row, and that answer beats a publish record.
 *
 * `ShopProduct` deliberately holds two kinds of internal id in one entityType -
 * a variant's own shop product id maps to a VARIANT, while a grouped parent's
 * maps to a PRODUCT (they never collide because the two id families are
 * distinctly prefixed). So the fallback asks which one it got rather than
 * assuming, and refuses when the mapped row is gone - returning a variant id in
 * `internalProductId` would be a silent mis-link, which is exactly what the
 * `variant` branch already declines to do.
 *
 * @module libs/core/src/orders/application/services
 * @see {@link IProductsService} for cross-context variant reads (#718)
 */
import { Injectable, Inject } from '@nestjs/common';
import { IIdentifierMappingService, IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import type { IncomingOrderItemRef } from '../../domain/types/incoming-order.types';
import { MissingOrderItemMappingError } from '../../domain/exceptions/missing-order-item-mapping.error';
import { StaleOrderItemError } from '../../domain/exceptions/stale-order-item.error';
import type { IOrderItemRefResolverService } from '../interfaces/order-item-ref-resolver.service.interface';
import type {
  ItemResolutionFailureKind,
  ItemResolutionResult,
  ResolvedOrderItemProduct,
} from './order-item-ref-resolver.types';

export type { ItemResolutionFailureKind, ItemResolutionResult, ResolvedOrderItemProduct };

@Injectable()
export class OrderItemRefResolverService implements IOrderItemRefResolverService {
  constructor(
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService
  ) {}

  async tryResolve(
    connectionId: string,
    productRef: IncomingOrderItemRef
  ): Promise<ItemResolutionResult> {
    try {
      const result = await this.resolve(connectionId, productRef);
      return { resolved: true, ...result };
    } catch (error) {
      if (error instanceof StaleOrderItemError) {
        return { resolved: false, productRef, reason: error.message, kind: 'source_deleted' };
      }
      if (error instanceof MissingOrderItemMappingError) {
        return { resolved: false, productRef, reason: error.message, kind: 'missing_mapping' };
      }
      throw error;
    }
  }

  async resolve(
    connectionId: string,
    productRef: IncomingOrderItemRef
  ): Promise<ResolvedOrderItemProduct> {
    switch (productRef.type) {
      case 'offer': {
        const internalVariantId = await this.identifierMapping.getInternalId(
          CORE_ENTITY_TYPE.Offer,
          productRef.externalId,
          connectionId
        );
        if (!internalVariantId) {
          throw new MissingOrderItemMappingError(
            connectionId,
            productRef,
            'identifier_mappings:Offer'
          );
        }
        const variant = await this.productsService.getVariant(internalVariantId);
        if (!variant) {
          throw new MissingOrderItemMappingError(
            connectionId,
            productRef,
            'identifier_mappings:Offer:variant-missing'
          );
        }
        if (variant.isStale) {
          throw new StaleOrderItemError(connectionId, productRef, variant.id);
        }
        return { internalProductId: variant.productId, internalVariantId: variant.id };
      }
      case 'product': {
        const internalProductId = await this.identifierMapping.getInternalId(
          CORE_ENTITY_TYPE.Product,
          productRef.externalId,
          connectionId
        );
        if (internalProductId) {
          return { internalProductId };
        }
        const published = await this.resolveViaShopProduct(connectionId, productRef);
        if (published) {
          return published;
        }
        throw new MissingOrderItemMappingError(
          connectionId,
          productRef,
          'identifier_mappings:Product,ShopProduct'
        );
      }
      case 'variant': {
        const internalVariantId = await this.identifierMapping.getInternalId(
          CORE_ENTITY_TYPE.ProductVariant,
          productRef.externalId,
          connectionId
        );
        if (!internalVariantId) {
          const published = await this.resolveViaShopProduct(connectionId, productRef);
          if (published) {
            return published;
          }
          throw new MissingOrderItemMappingError(
            connectionId,
            productRef,
            'identifier_mappings:ProductVariant,ShopProduct'
          );
        }
        const variant = await this.productsService.getVariant(internalVariantId);
        if (!variant) {
          throw new MissingOrderItemMappingError(
            connectionId,
            productRef,
            'identifier_mappings:ProductVariant:variant-missing'
          );
        }
        if (variant.isStale) {
          throw new StaleOrderItemError(connectionId, productRef, variant.id);
        }
        return { internalProductId: variant.productId, internalVariantId: variant.id };
      }
      case 'sku': {
        const internalId = await this.identifierMapping.getInternalId(
          CORE_ENTITY_TYPE.Sku,
          productRef.externalId,
          connectionId
        );
        if (!internalId) {
          throw new MissingOrderItemMappingError(
            connectionId,
            productRef,
            'identifier_mappings:Sku'
          );
        }
        const variant = await this.productsService.getVariant(internalId);
        if (variant) {
          if (variant.isStale) {
            throw new StaleOrderItemError(connectionId, productRef, variant.id);
          }
          return { internalProductId: variant.productId, internalVariantId: variant.id };
        }
        return { internalProductId: internalId };
      }
    }
  }

  /**
   * Answer a ref from the `ShopProduct` mapping OpenLinker wrote when it
   * published this product to the shop (see the module docblock for why this
   * exists and why it runs second).
   *
   * `null` means "no such publish record" - the caller decides what that means
   * for its own ref type. A record pointing at a row that no longer exists is
   * NOT null: it is a mapping pointing at nothing, and the caller must not
   * carry that id onwards, so it raises the same missing-mapping error the
   * primary branches raise for the identical condition.
   */
  private async resolveViaShopProduct(
    connectionId: string,
    productRef: IncomingOrderItemRef
  ): Promise<ResolvedOrderItemProduct | null> {
    const internalId = await this.identifierMapping.getInternalId(
      CORE_ENTITY_TYPE.ShopProduct,
      productRef.externalId,
      connectionId
    );
    if (!internalId) {
      return null;
    }

    // A variant's own shop product id maps to a variant; a grouped parent's
    // maps to a product. Ask, rather than infer from the id's shape.
    const variant = await this.productsService.getVariant(internalId);
    if (variant) {
      if (variant.isStale) {
        throw new StaleOrderItemError(connectionId, productRef, variant.id);
      }
      return { internalProductId: variant.productId, internalVariantId: variant.id };
    }

    const product = await this.productsService.getProduct(internalId);
    if (product) {
      return { internalProductId: product.id };
    }

    throw new MissingOrderItemMappingError(
      connectionId,
      productRef,
      'identifier_mappings:ShopProduct:target-missing'
    );
  }
}
