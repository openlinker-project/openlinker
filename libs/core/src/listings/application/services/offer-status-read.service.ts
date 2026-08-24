/**
 * Offer Status Read Service
 *
 * Implements the operator-facing read of persisted live marketplace publication
 * status (#1760). Resolves a product's variants via the products context and
 * returns one row per offer OL has mapped to them, carrying the matching
 * `offer_status_snapshots` row (#816) when one exists. Pure read — never
 * touches the marketplace or the creation record.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferStatusReadService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';
import type { OfferStatusSnapshot } from '../../domain/entities/offer-status-snapshot.entity';
import { OfferMappingRepositoryPort } from '../../domain/ports/offer-mapping-repository.port';
import { OfferStatusSnapshotRepositoryPort } from '../../domain/ports/offer-status-snapshot-repository.port';
import type { OfferPublicationStatusView } from '../../domain/types/offer-status-read.types';
import { readValidationProblems } from '../../domain/types/offer-validation-problem.types';
import {
  OFFER_MAPPING_REPOSITORY_TOKEN,
  OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { IOfferStatusReadService } from './offer-status-read.service.interface';

/**
 * Page size for the per-variant offer-mapping read. A variant carries one
 * mapping per connection it is listed on, so this ceiling is far above any
 * real fan-out; it exists because the port's read is paginated.
 */
const MAPPINGS_PER_VARIANT_LIMIT = 100;

@Injectable()
export class OfferStatusReadService implements IOfferStatusReadService {
  private readonly logger = new Logger(OfferStatusReadService.name);

  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
    @Inject(OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN)
    private readonly snapshots: OfferStatusSnapshotRepositoryPort,
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappings: OfferMappingRepositoryPort
  ) {}

  async getPublicationStatusForProduct(
    productId: string,
    connectionId?: string
  ): Promise<OfferPublicationStatusView[]> {
    const variants = await this.products.getVariantsByProductId(productId);
    if (variants.length === 0) {
      return [];
    }
    const variantIds = variants.map((variant) => variant.id);

    const [snapshots, mappings] = await Promise.all([
      this.snapshots.findByVariantIds(variantIds, connectionId),
      this.listOfferMappings(variantIds, connectionId),
    ]);

    const byKey = new Map<string, OfferStatusSnapshot>(
      snapshots.map((snapshot) => [this.key(snapshot.connectionId, snapshot.externalOfferId), snapshot])
    );

    // Mapped offers drive the result, so an offer that exists but has never
    // been read still surfaces (with a null status) instead of vanishing (#2039).
    const views: OfferPublicationStatusView[] = [];
    const covered = new Set<string>();
    for (const mapping of mappings) {
      const key = this.key(mapping.connectionId, mapping.externalId);
      // `(connectionId, externalOfferId)` is the snapshot's own key, so emitting
      // it twice would render the same offer twice; the per-variant reads are
      // unioned, and one offer id bound to two variants is a real (guarded-
      // against, but possible) mapping state.
      if (covered.has(key)) {
        continue;
      }
      covered.add(key);
      const snapshot = byKey.get(key);
      views.push(
        snapshot
          ? this.toView(snapshot)
          : {
              connectionId: mapping.connectionId,
              externalOfferId: mapping.externalId,
              internalVariantId: mapping.internalId,
              publicationStatus: null,
              validationMessages: [],
              validationProblems: [],
              lastStatusSyncedAt: null,
            }
      );
    }

    // A snapshot whose mapping has since been removed still carries the last
    // known status; keep reporting it rather than silently dropping history.
    for (const snapshot of snapshots) {
      if (!covered.has(this.key(snapshot.connectionId, snapshot.externalOfferId))) {
        views.push(this.toView(snapshot));
      }
    }

    return views;
  }

  private async listOfferMappings(
    variantIds: string[],
    connectionId?: string
  ): Promise<{ connectionId: string; externalId: string; internalId: string }[]> {
    // One read per variant: the port filters on a single `internalId`, and a
    // product's variant count is small (this backs a per-product drawer).
    const pages = await Promise.all(
      variantIds.map((internalId) =>
        this.offerMappings.findMany(
          { internalId, connectionId },
          { offset: 0, limit: MAPPINGS_PER_VARIANT_LIMIT }
        )
      )
    );
    return pages.flatMap((page) => {
      // A variant carries one offer mapping per connection, so the cap is far
      // above any real fan-out — say so if that ever stops being true, rather
      // than silently truncating the operator's view.
      if (page.total > MAPPINGS_PER_VARIANT_LIMIT) {
        this.logger.warn(
          `Variant has ${page.total} offer mappings, above the ${MAPPINGS_PER_VARIANT_LIMIT} read cap; the publication-status view is truncated`
        );
      }
      return page.items.map((mapping) => ({
        connectionId: mapping.connectionId,
        externalId: mapping.externalId,
        internalId: mapping.internalId,
      }));
    });
  }

  private toView(snapshot: OfferStatusSnapshot): OfferPublicationStatusView {
    return {
      connectionId: snapshot.connectionId,
      externalOfferId: snapshot.externalOfferId,
      internalVariantId: snapshot.internalVariantId,
      publicationStatus: snapshot.publicationStatus,
      validationMessages: snapshot.statusDetails?.validationMessages ?? [],
      // Guarded read rather than a cast (#2231): `statusDetails` is unconstrained
      // jsonb, and these values reach a render path.
      validationProblems: [...readValidationProblems(snapshot.statusDetails)],
      lastStatusSyncedAt: snapshot.lastStatusSyncedAt,
    };
  }

  private key(connectionId: string, externalOfferId: string): string {
    return `${connectionId}:${externalOfferId}`;
  }
}
