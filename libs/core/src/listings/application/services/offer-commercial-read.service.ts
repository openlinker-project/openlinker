/**
 * Offer Commercial Read Service (#3621)
 *
 * Reads the persisted channel-side quantity snapshots and reduces them to the
 * newest observation per `(variant, connection)`. Pure read - it never touches
 * the marketplace, so showing the stock view spends none of the operator's API
 * quota.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferCommercialReadService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { OfferCommercialSnapshotRepositoryPort } from '../../domain/ports/offer-commercial-snapshot-repository.port';
import { OFFER_COMMERCIAL_SNAPSHOT_REPOSITORY_TOKEN } from '../../listings.tokens';
import type {
  ChannelObservedQuantity,
  IOfferCommercialReadService,
} from './offer-commercial-read.service.interface';

@Injectable()
export class OfferCommercialReadService implements IOfferCommercialReadService {
  constructor(
    @Inject(OFFER_COMMERCIAL_SNAPSHOT_REPOSITORY_TOKEN)
    private readonly snapshots: OfferCommercialSnapshotRepositoryPort
  ) {}

  async getObservedQuantities(
    variantIds: readonly string[]
  ): Promise<readonly ChannelObservedQuantity[]> {
    if (variantIds.length === 0) return [];
    const rows = await this.snapshots.findByVariantIds(variantIds);

    const newest = new Map<string, ChannelObservedQuantity>();
    for (const row of rows) {
      // A snapshot that observed no quantity (price-only) says nothing about
      // stock; it must not shadow an older one that did.
      if (row.availableQuantity === null) continue;
      const key = `${row.internalVariantId}:${row.connectionId}`;
      const current = newest.get(key);
      if (current === undefined || row.lastCommercialSyncedAt > current.observedAt) {
        newest.set(key, {
          connectionId: row.connectionId,
          internalVariantId: row.internalVariantId,
          externalOfferId: row.externalOfferId,
          availableQuantity: row.availableQuantity,
          observedAt: row.lastCommercialSyncedAt,
        });
      }
    }
    return [...newest.values()];
  }
}
