/**
 * Auto-Match Variant Offers Service
 *
 * Automatically matches product variants from the master catalog to marketplace
 * offers using shared identifiers (EAN first, then SKU fallback). Creates
 * identifier mappings for unique matches.
 *
 * @module libs/core/src/products/application/services
 * @implements {IAutoMatchVariantOffersService}
 */
import { Injectable, Inject } from '@nestjs/common';
import { OfferManagerPort } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IdentifierMappingConflictException,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { IAutoMatchVariantOffersService } from './auto-match-variant-offers.service.interface';
import {
  AutoMatchResult,
  AutoMatchOptions,
  MatchError,
  OfferIdentifiers,
  MatchResult,
} from '../types/auto-match.types';
import {
  PRODUCT_VARIANT_REPOSITORY_TOKEN,
} from '../../products.tokens';
import { ProductVariantRepositoryPort } from '../../domain/ports/product-variant-repository.port';
import { normalizeBarcode } from '../../domain/utils/barcode-normalization';

const OFFER_FEED_PAGE_SIZE = 100;
const VARIANT_PAGE_SIZE = 1000;

@Injectable()
export class AutoMatchVariantOffersService implements IAutoMatchVariantOffersService {
  private readonly logger = new Logger(AutoMatchVariantOffersService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(PRODUCT_VARIANT_REPOSITORY_TOKEN)
    private readonly variantRepository: ProductVariantRepositoryPort,
  ) {}

  async autoMatch(
    connectionId: string,
    options: AutoMatchOptions,
  ): Promise<AutoMatchResult> {
    const dryRun = options.dryRun ?? false;
    const { connection } = await this.integrationsService.getAdapter(connectionId);
    const masterConnectionId = this.getMasterCatalogConnectionId(connection.config);

    if (!masterConnectionId) {
      this.logger.warn(
        `No masterCatalogConnectionId configured for connection=${connectionId}; cannot auto-match`,
      );
      return { matched: 0, skippedAmbiguous: 0, skippedNoMatch: 0, errors: [] };
    }

    const marketplace = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager',
    );

    const allOffers = await this.loadAllOffers(marketplace);
    this.logger.log(`Loaded ${allOffers.length} offers from marketplace (connection=${connectionId})`);

    const { eanToOffer, skuToOffer } = this.buildOfferLookups(allOffers);

    const variants = await this.loadVariantsWithIdentifiers(masterConnectionId);
    this.logger.log(`Loaded ${variants.length} variants with identifiers from master catalog (connection=${masterConnectionId})`);

    let matched = 0;
    let skippedAmbiguous = 0;
    let skippedNoMatch = 0;
    const errors: MatchError[] = [];

    for (const variant of variants) {
      const matchResult = this.findMatch(variant, eanToOffer, skuToOffer);

      if (matchResult.status === 'no_match') {
        skippedNoMatch += 1;
        continue;
      }

      if (matchResult.status === 'ambiguous') {
        skippedAmbiguous += 1;
        this.logger.warn(
          `Ambiguous ${matchResult.method} match for variant=${variant.id}`,
        );
        continue;
      }

      if (dryRun) {
        matched += 1;
        continue;
      }

      try {
        await this.identifierMapping.getOrCreateExactMapping(
          'Offer',
          matchResult.offerId,
          variant.id,
          connectionId,
          {
            metadata: {
              linkMethod: matchResult.method,
              source: 'master.variants.autoMatch',
            },
          },
        );
        matched += 1;
      } catch (error) {
        if (error instanceof IdentifierMappingConflictException) {
          this.logger.warn(
            `Mapping conflict for variant=${variant.id}, offer=${matchResult.offerId}: ${error.message}`,
          );
          errors.push({
            variantId: variant.id,
            offerId: matchResult.offerId,
            method: matchResult.method,
            reason: error.message,
          });
          continue;
        }
        throw error;
      }
    }

    this.logger.log(
      `Auto-match complete (connection=${connectionId}, dryRun=${dryRun}): matched=${matched}, skippedAmbiguous=${skippedAmbiguous}, skippedNoMatch=${skippedNoMatch}, errors=${errors.length}`,
    );

    return { matched, skippedAmbiguous, skippedNoMatch, errors };
  }

  private async loadAllOffers(marketplace: OfferManagerPort): Promise<OfferIdentifiers[]> {
    if (!marketplace.listOffers) {
      throw new Error('Marketplace adapter does not support listOffers');
    }

    const allOffers: OfferIdentifiers[] = [];
    let cursor: string | null = null;

    do {
      const feed = await marketplace.listOffers({ cursor, limit: OFFER_FEED_PAGE_SIZE });
      for (const item of feed.items) {
        allOffers.push({
          offerId: item.offerId,
          ean: this.normalizeBarcodeValue(item.ean),
          sku: this.normalize(item.sku) ?? this.normalize(item.externalRef),
        });
      }
      cursor = feed.nextCursor;
    } while (cursor !== null);

    return allOffers;
  }

  private buildOfferLookups(offers: OfferIdentifiers[]): {
    eanToOffer: Map<string, string | null>;
    skuToOffer: Map<string, string | null>;
  } {
    const eanToOffer = new Map<string, string | null>();
    const skuToOffer = new Map<string, string | null>();

    for (const offer of offers) {
      if (offer.ean) {
        this.addToUniqueMap(eanToOffer, offer.ean, offer.offerId);
      }
      if (offer.sku) {
        this.addToUniqueMap(skuToOffer, offer.sku, offer.offerId);
      }
    }

    return { eanToOffer, skuToOffer };
  }

  private addToUniqueMap(
    map: Map<string, string | null>,
    key: string,
    value: string,
  ): void {
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, value);
    } else if (existing !== value) {
      map.set(key, null);
    }
  }

  private findMatch(
    variant: { id: string; ean: string | null; sku: string | null },
    eanToOffer: Map<string, string | null>,
    skuToOffer: Map<string, string | null>,
  ): MatchResult {
    const ean = this.normalizeBarcodeValue(variant.ean);
    if (ean) {
      const match = eanToOffer.get(ean);
      if (match) {
        return { status: 'matched', offerId: match, method: 'ean' };
      }
      if (match === null) {
        return { status: 'ambiguous', method: 'ean' };
      }
    }

    const sku = this.normalize(variant.sku);
    if (sku) {
      const match = skuToOffer.get(sku);
      if (match) {
        return { status: 'matched', offerId: match, method: 'sku' };
      }
      if (match === null) {
        return { status: 'ambiguous', method: 'sku' };
      }
    }

    return { status: 'no_match' };
  }

  private async loadVariantsWithIdentifiers(
    masterConnectionId: string,
  ): Promise<Array<{ id: string; ean: string | null; sku: string | null }>> {
    const allVariants: Array<{ id: string; ean: string | null; sku: string | null }> = [];
    let offset = 0;

    do {
      const page = await this.variantRepository.findMany(
        { connectionId: masterConnectionId, hasIdentifiers: true },
        { limit: VARIANT_PAGE_SIZE, offset },
      );
      for (const v of page.items) {
        allVariants.push({ id: v.id, ean: v.ean ?? null, sku: v.sku ?? null });
      }
      offset += page.items.length;
      if (page.items.length < VARIANT_PAGE_SIZE || offset >= page.total) {
        break;
      }
    } while (true);

    return allVariants;
  }

  private normalize(value?: string | null): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeBarcodeValue(value?: string | null): string | null {
    return normalizeBarcode(value ?? null);
  }

  private getMasterCatalogConnectionId(config: Record<string, unknown>): string | null {
    const masterConnectionId = config.masterCatalogConnectionId;
    return typeof masterConnectionId === 'string' ? masterConnectionId : null;
  }
}
