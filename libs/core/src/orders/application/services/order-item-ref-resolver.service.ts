/**
 * Order Item Ref Resolver Service
 *
 * Resolves external-only IncomingOrder item references to internal OpenLinker IDs.
 *
 * @module libs/core/src/orders/application/services
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import {
  IOfferMappingService,
  OFFER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/listings';
import type { IncomingOrderItemRef } from '../../domain/types/incoming-order.types';
import { MissingOrderItemMappingError } from '../../domain/exceptions/missing-order-item-mapping.error';

export interface ResolvedOrderItemProduct {
  internalProductId: string;
  variantId?: string | null;
}

@Injectable()
export class OrderItemRefResolverService {
  constructor(
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(OFFER_MAPPING_SERVICE_TOKEN)
    private readonly offerMapping: IOfferMappingService,
  ) {}

  async resolve(
    connectionId: string,
    productRef: IncomingOrderItemRef,
  ): Promise<ResolvedOrderItemProduct> {
    switch (productRef.type) {
      case 'offer': {
        const mapping = await this.offerMapping.findByConnectionAndOffer(
          connectionId,
          productRef.externalId,
        );
        if (!mapping) {
          throw new MissingOrderItemMappingError(connectionId, productRef, 'offer_mappings');
        }
        return {
          internalProductId: mapping.internalProductId,
          variantId: mapping.variantId,
        };
      }
      case 'product': {
        const internalProductId = await this.identifierMapping.getInternalId(
          'Product',
          productRef.externalId,
          connectionId,
        );
        if (!internalProductId) {
          throw new MissingOrderItemMappingError(connectionId, productRef, 'identifier_mappings:Product');
        }
        return { internalProductId };
      }
      case 'variant': {
        const internalProductId = await this.identifierMapping.getInternalId(
          'ProductVariant',
          productRef.externalId,
          connectionId,
        );
        if (!internalProductId) {
          throw new MissingOrderItemMappingError(
            connectionId,
            productRef,
            'identifier_mappings:ProductVariant',
          );
        }
        return { internalProductId };
      }
      case 'sku': {
        const internalProductId = await this.identifierMapping.getInternalId(
          'Sku',
          productRef.externalId,
          connectionId,
        );
        if (!internalProductId) {
          throw new MissingOrderItemMappingError(connectionId, productRef, 'identifier_mappings:Sku');
        }
        return { internalProductId };
      }
    }
  }
}

