/**
 * Offer Mapping Sync Service
 *
 * Orchestrates marketplace offer discovery and deterministic linking to internal variants.
 *
 * @module libs/core/src/listings/application/services
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  MarketplacePort,
  MarketplaceOfferFeedItem,
} from '@openlinker/core/integrations';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IdentifierMappingConflictException,
} from '@openlinker/core/identifier-mapping';
import {
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
  ProductVariantRepositoryPort,
} from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';
import {
  IOfferMappingSyncService,
  OfferMappingSyncOptions,
  OfferMappingSyncResult,
} from './offer-mapping-sync.service.interface';
import {
  OfferLinkingService,
  OfferLinkingLookups,
} from './offer-linking.service';

@Injectable()
export class OfferMappingSyncService implements IOfferMappingSyncService {
  private readonly logger = new Logger(OfferMappingSyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(PRODUCT_VARIANT_REPOSITORY_TOKEN)
    private readonly variantRepository: ProductVariantRepositoryPort,
    private readonly offerLinking: OfferLinkingService,
  ) {}

  async sync(
    connectionId: string,
    options: OfferMappingSyncOptions,
  ): Promise<OfferMappingSyncResult> {
    const marketplace = await this.integrationsService.getCapabilityAdapter<MarketplacePort>(
      connectionId,
      'Marketplace',
    );
    if (!marketplace.listOffers) {
      throw new Error('Marketplace adapter does not support listOffers');
    }

    const feed = await marketplace.listOffers({
      cursor: options.cursor ?? null,
      limit: options.limit,
    });

    const items = feed.items ?? [];
    this.logger.debug(
      `Offer feed loaded (items: ${items.length}, nextCursor: ${feed.nextCursor ?? 'none'})`,
    );
    const lookups = await this.buildLookups(items);

    let linked = 0;
    let skipped = 0;

    for (const item of items) {
      const result = this.offerLinking.linkOffer(item, lookups);
      if (result.status === 'linked' && result.internalVariantId) {
        try {
          await this.identifierMapping.getOrCreateExactMapping(
            'Offer',
            item.offerId,
            result.internalVariantId,
            connectionId,
            {
              metadata: {
                linkMethod: result.linkMethod,
                source: 'marketplace.offers.sync',
              },
            },
          );
          linked += 1;
        } catch (error) {
          if (error instanceof IdentifierMappingConflictException) {
            this.logger.warn(
              `Offer mapping conflict for offerId=${item.offerId} (connection=${connectionId}): ${error.message}`,
            );
            skipped += 1;
            continue;
          }
          throw error;
        }
      } else {
        skipped += 1;
      }
    }

    return {
      scanned: items.length,
      linked,
      skipped,
      nextCursor: feed.nextCursor ?? null,
    };
  }

  private async buildLookups(items: MarketplaceOfferFeedItem[]): Promise<OfferLinkingLookups> {
    const externalRefs = this.uniqueValues(items.map((i) => i.externalRef));
    const skus = this.uniqueValues(items.map((i) => i.sku));
    const eans = this.uniqueValues(items.map((i) => i.ean));
    const gtins = this.uniqueValues(items.map((i) => i.gtin));
    this.logger.debug(
      `Offer lookup inputs (externalRefs: ${externalRefs.length}, skus: ${skus.length}, eans: ${eans.length}, gtins: ${gtins.length})`,
    );

    const skuCandidates = this.uniqueValues([...externalRefs, ...skus]);
    const skuVariants = skuCandidates.length > 0
      ? await this.variantRepository.findBySkuIn(skuCandidates)
      : [];

    const skuMap = this.buildUniqueMap(skuVariants, (variant) => variant.sku ?? null);
    const externalRefMap = this.selectLookup(externalRefs, skuMap);
    const directSkuMap = this.selectLookup(skus, skuMap);

    const eanVariants = eans.length > 0
      ? await this.variantRepository.findByEanOrGtinIn(eans)
      : [];
    const gtinVariants = gtins.length > 0
      ? await this.variantRepository.findByEanOrGtinIn(gtins)
      : [];

    const eanMap = this.buildUniqueMap(eanVariants, (variant) => this.getAttributeValue(variant.attributes, 'ean'));
    const gtinMap = this.buildUniqueMap(
      gtinVariants,
      (variant) => this.getAttributeValue(variant.attributes, 'gtin'),
    );

    return {
      externalRefToVariantId: externalRefMap,
      skuToVariantId: directSkuMap,
      eanToVariantId: eanMap,
      gtinToVariantId: gtinMap,
    };
  }

  private uniqueValues(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((v): v is string => !!v && v.trim().length > 0).map((v) => v.trim()))];
  }

  private buildUniqueMap(
    variants: Array<{ id: string; attributes?: Record<string, string> | null; sku?: string | null }>,
    keySelector: (variant: { id: string; attributes?: Record<string, string> | null; sku?: string | null }) => string | null,
  ): Map<string, string | null> {
    const map = new Map<string, string | null>();
    for (const variant of variants) {
      const key = keySelector(variant);
      if (!key) {
        continue;
      }
      const existing = map.get(key);
      if (existing === undefined) {
        map.set(key, variant.id);
        continue;
      }
      if (existing !== variant.id) {
        map.set(key, null);
      }
    }
    return map;
  }

  private selectLookup(
    values: string[],
    source: Map<string, string | null>,
  ): Map<string, string | null> {
    const map = new Map<string, string | null>();
    for (const value of values) {
      if (source.has(value)) {
        map.set(value, source.get(value) ?? null);
      }
    }
    return map;
  }

  private getAttributeValue(
    attributes: Record<string, string> | null | undefined,
    key: string,
  ): string | null {
    if (!attributes) {
      return null;
    }
    const value = attributes[key];
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
