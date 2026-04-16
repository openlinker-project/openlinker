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
  normalizeBarcode,
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
    const { connection } = await this.integrationsService.getAdapter(connectionId);
    const masterConnectionId = this.getMasterCatalogConnectionId(connection.config);

    const marketplace = await this.integrationsService.getCapabilityAdapter<MarketplacePort>(
      connectionId,
      'Marketplace',
    );
    const feed = await this.loadOfferFeed(marketplace, {
      cursor: options.cursor ?? null,
      limit: options.limit,
      feedType: options.feedType ?? 'offers',
    });

    const items = feed.items ?? [];
    this.logger.debug(
      `Offer feed loaded (items: ${items.length}, nextCursor: ${feed.nextCursor ?? 'none'})`,
    );
    const resolvedMasterConnectionId = masterConnectionId ?? await this.autoResolveMasterConnectionId(connectionId);
    const lookups = await this.buildLookups(items, resolvedMasterConnectionId);

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

  private async loadOfferFeed(
    marketplace: MarketplacePort,
    input: { cursor: string | null; limit: number; feedType: 'offers' | 'events' },
  ): Promise<{ items: MarketplaceOfferFeedItem[]; nextCursor: string | null }> {
    if (input.feedType === 'events') {
      if (!marketplace.listOfferEvents) {
        this.logger.warn(
          'Marketplace adapter does not support listOfferEvents; falling back to listOffers',
        );
      } else {
        return marketplace.listOfferEvents({ cursor: input.cursor, limit: input.limit });
      }
    }

    if (!marketplace.listOffers) {
      throw new Error('Marketplace adapter does not support listOffers');
    }

    return marketplace.listOffers({ cursor: input.cursor, limit: input.limit });
  }

  private async buildLookups(
    items: MarketplaceOfferFeedItem[],
    masterConnectionId: string | null,
  ): Promise<OfferLinkingLookups> {
    const externalRefs = this.uniqueValues(items.map((i) => i.externalRef));
    const skus = this.uniqueValues(items.map((i) => i.sku));
    const eans = this.uniqueBarcodeValues(items.map((i) => i.ean));
    const gtins = this.uniqueBarcodeValues(items.map((i) => i.gtin));
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

    const eanVariants = masterConnectionId && eans.length > 0
      ? await this.variantRepository.findByEanOrGtinIn(masterConnectionId, eans, 'ean')
      : [];
    const gtinVariants = masterConnectionId && gtins.length > 0
      ? await this.variantRepository.findByEanOrGtinIn(masterConnectionId, gtins, 'gtin')
      : [];
    this.logger.debug(
      `Barcode lookup results (eans: [${eans.join(',')}] → ${eanVariants.length} hit(s), gtins: [${gtins.join(',')}] → ${gtinVariants.length} hit(s))`,
    );

    const eanMap = this.buildUniqueMap(
      eanVariants,
      (variant) =>
        this.normalizeBarcodeValue(
          variant.ean ?? this.getAttributeValue(variant.attributes, 'ean'),
        ),
    );
    const gtinMap = this.buildUniqueMap(
      gtinVariants,
      (variant) =>
        this.normalizeBarcodeValue(
          variant.gtin ?? this.getAttributeValue(variant.attributes, 'gtin'),
        ),
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

  private uniqueBarcodeValues(values: Array<string | null | undefined>): string[] {
    return [
      ...new Set(
        values
          .map((value) => this.normalizeBarcodeValue(value ?? null))
          .filter((value): value is string => !!value),
      ),
    ];
  }

  private buildUniqueMap(
    variants: Array<{
      id: string;
      attributes?: Record<string, string> | null;
      sku?: string | null;
      ean?: string | null;
      gtin?: string | null;
    }>,
    keySelector: (variant: {
      id: string;
      attributes?: Record<string, string> | null;
      sku?: string | null;
      ean?: string | null;
      gtin?: string | null;
    }) => string | null,
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

  private normalizeBarcodeValue(value: string | null): string | null {
    return normalizeBarcode(value ?? null);
  }

  /**
   * Auto-resolve the master catalog connection when not explicitly configured.
   *
   * Policy: if exactly one ProductMaster connection exists (excluding the caller),
   * use it automatically. If zero or multiple exist, barcode linking is disabled.
   *
   * To opt out of barcode linking intentionally, set `masterCatalogConnectionId: ""`
   * in the connection config — getMasterCatalogConnectionId() will return null and
   * skip this path entirely.
   */
  private async autoResolveMasterConnectionId(excludeConnectionId: string): Promise<string | null> {
    const adapters = await this.integrationsService.listCapabilityAdapters({ capability: 'ProductMaster' });
    const candidates = (adapters ?? []).filter((a) => a.connection.id !== excludeConnectionId);
    if (candidates.length === 1) {
      this.logger.debug(
        `masterCatalogConnectionId not set on connection ${excludeConnectionId}; auto-resolved to ${candidates[0].connection.id}`,
      );
      return candidates[0].connection.id;
    }
    if (candidates.length === 0) {
      this.logger.warn(
        `masterCatalogConnectionId not set and no ProductMaster connection found; barcode linking disabled`,
      );
    } else {
      this.logger.warn(
        `masterCatalogConnectionId not set and ${candidates.length} ProductMaster connections found (ambiguous); barcode linking disabled — set masterCatalogConnectionId on the connection config`,
      );
    }
    return null;
  }

  private getMasterCatalogConnectionId(config: Record<string, unknown>): string | null {
    const masterConnectionId = config.masterCatalogConnectionId;
    return typeof masterConnectionId === 'string' ? masterConnectionId : null;
  }
}
