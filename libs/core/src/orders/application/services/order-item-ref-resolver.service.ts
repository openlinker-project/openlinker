/**
 * Order Item Ref Resolver Service
 *
 * Resolves external-only IncomingOrder item references to internal OpenLinker IDs.
 *
 * @module libs/core/src/orders/application/services
 * @see {@link IProductsService} for cross-context variant reads (#718)
 */
import { Injectable, Inject } from '@nestjs/common';
import { IIdentifierMappingService, IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import type { IncomingOrderItemRef } from '../../domain/types/incoming-order.types';
import { MissingOrderItemMappingError } from '../../domain/exceptions/missing-order-item-mapping.error';
import type {
  ItemResolutionResult,
  ResolvedOrderItemProduct,
} from './order-item-ref-resolver.types';

export type { ItemResolutionResult, ResolvedOrderItemProduct };

@Injectable()
export class OrderItemRefResolverService {
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
      if (error instanceof MissingOrderItemMappingError) {
        return { resolved: false, productRef, reason: error.message };
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
        return { internalProductId: variant.productId, internalVariantId: variant.id };
      }
      case 'product': {
        const internalProductId = await this.identifierMapping.getInternalId(
          CORE_ENTITY_TYPE.Product,
          productRef.externalId,
          connectionId
        );
        if (!internalProductId) {
          throw new MissingOrderItemMappingError(
            connectionId,
            productRef,
            'identifier_mappings:Product'
          );
        }
        return { internalProductId };
      }
      case 'variant': {
        const internalVariantId = await this.identifierMapping.getInternalId(
          CORE_ENTITY_TYPE.ProductVariant,
          productRef.externalId,
          connectionId
        );
        if (!internalVariantId) {
          throw new MissingOrderItemMappingError(
            connectionId,
            productRef,
            'identifier_mappings:ProductVariant'
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
          return { internalProductId: variant.productId, internalVariantId: variant.id };
        }
        return { internalProductId: internalId };
      }
    }
  }
}
