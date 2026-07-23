/**
 * Offer Status Read Service
 *
 * Implements the operator-facing read of persisted live marketplace publication
 * status (#1760). Resolves a product's variants via the products context and
 * returns the matching `offer_status_snapshots` rows (#816). Pure read — never
 * touches the marketplace or the creation record.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferStatusReadService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import type { OfferStatusSnapshot } from '../../domain/entities/offer-status-snapshot.entity';
import { OfferStatusSnapshotRepositoryPort } from '../../domain/ports/offer-status-snapshot-repository.port';
import {
  OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { IOfferStatusReadService } from './offer-status-read.service.interface';

@Injectable()
export class OfferStatusReadService implements IOfferStatusReadService {
  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
    @Inject(OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN)
    private readonly snapshots: OfferStatusSnapshotRepositoryPort
  ) {}

  async getPublicationStatusForProduct(
    productId: string,
    connectionId?: string
  ): Promise<OfferStatusSnapshot[]> {
    const variants = await this.products.getVariantsByProductId(productId);
    if (variants.length === 0) {
      return [];
    }
    const variantIds = variants.map((variant) => variant.id);
    return this.snapshots.findByVariantIds(variantIds, connectionId);
  }
}
