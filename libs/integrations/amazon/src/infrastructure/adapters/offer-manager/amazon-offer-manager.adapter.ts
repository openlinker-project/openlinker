/**
 * Amazon Offer Manager Adapter (#4180)
 *
 * `OfferManager` for Amazon over Listings Items API v2021-08-01. An Amazon
 * offer is addressed by the seller's SKU, so the external offer id IS the SKU.
 *
 *   - `OfferLister`: the seller's listings (`searchListingsItems`, 20 a page,
 *     ordered by SKU so pages tile), reported with SKU and ASIN, and
 *     `raw.fulfilledByAmazon` for a listing Amazon fulfils; the offer mapping
 *     sync links them to variants by SKU.
 *   - `updateOfferQuantity`: `patchListingsItem` replacing
 *     `fulfillment_availability` with the seller channel (`DEFAULT`). A listing
 *     Amazon fulfils (FBA) is skipped with a warning, never written: its stock
 *     is Amazon's, as Erli's seller-frozen stock is the seller's. Skipping
 *     rather than failing keeps every stock change of a product sold both FBM
 *     and FBA from leaving a failed write. Quantity 0 is the pause (#1689);
 *     `deleteListingsItem` is never used.
 *   - `OfferFieldUpdater`: price only, `patchListingsItem` replacing
 *     `purchasable_offer` for each configured marketplace whose currency is the
 *     price's (FR / DE: EUR, PL: PLN). Title, description and tax rate are
 *     refused rather than ignored. Replacing `purchasable_offer` also clears
 *     what else it held for that marketplace (a sale price, min / max price
 *     bounds set in Seller Central).
 *   - `CatalogProductReader` + `EanCategoryMatcher` (#4181): Amazon's catalogue
 *     by EAN (Catalog Items 2022-04-01); a match is the ASIN as the product
 *     card and its product type as the category.
 *   - `OfferCreator` (#4181): `putListingsItem`. On an existing ASIN, an
 *     offer-only listing (`LISTING_OFFER_ONLY`); the SKU is derived from the
 *     variant so a retry addresses the same listing, and an existing listing
 *     under that SKU is reported as already existing rather than overwritten.
 *     Amazon checks the listing after it answers `ACCEPTED`, so the create
 *     reports `validating` and the status read reports the outcome.
 *   - `OfferStatusReader`: `getListingsItem` with summaries, offers,
 *     fulfilment and issues: `BUYABLE` is active, otherwise inactive; ERROR
 *     issues are the validation errors; the live price and quantity are the
 *     commercial observation. A listing Amazon no longer has (404) is `ended`.
 *
 * Reads and the FBA check use the first configured marketplace; a listing that
 * exists only in another one is not listed.
 *
 * Every write first reads the listing, because a patch must name the
 * listing's product type and the channel decides whether stock may be
 * written. `putListingsItem` is never used for an update: it drops every
 * attribute it does not carry. A patch Amazon answers `INVALID` is rejected
 * with Amazon's issues; `ACCEPTED` is asynchronous, and the status read is
 * where a later rejection shows.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/offer-manager
 */
import {
  CatalogProductNotFoundException,
  CONSERVATIVE_DESCRIPTION_FORMAT,
  type BatchCategoryByEanInput,
  type CatalogProduct,
  type CatalogProductMatchResult,
  type CatalogProductReader,
  type CatalogProductSummary,
  type CreateOfferCommand,
  type CreateOfferResult,
  type DescriptionFormat,
  type EanCategoryMatcher,
  type EanMatchResult,
  type FindProductsByBarcodeInput,
  type OfferCreator,
  type OfferFeedInput,
  type OfferFeedOutput,
  type OfferFieldUpdater,
  type OfferLister,
  type OfferManagerPort,
  type OfferStatusReadResult,
  type OfferStatusReader,
  type UpdateOfferFieldsCommand,
  type UpdateOfferFieldsReport,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

import { AMAZON_KNOWN_MARKETPLACES } from '../../../amazon.constants';
import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import { AmazonConfigException } from '../../../domain/exceptions/amazon-config.exception';
import { AmazonNotSupportedException } from '../../../domain/exceptions/amazon-not-supported.exception';
import type { AmazonCatalogEntry } from '../../../domain/types/amazon-catalog.types';
import type { AmazonConnectionConfig } from '../../../domain/types/amazon-config.types';
import {
  AMAZON_SELLER_FULFILLMENT_CHANNEL,
  type AmazonListingItem,
  type AmazonListingSearchResults,
  type AmazonListingSubmissionResponse,
} from '../../../domain/types/amazon-listing.types';
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';
import {
  AMAZON_OFFER_ONLY_PRODUCT_TYPE,
  composeOfferOnlyListing,
  resolveAmazonSku,
  type AmazonListingPlan,
} from '../../mappers/amazon-listing-composer';
import { AmazonCatalogReader } from './amazon-catalog-reader';

const LISTINGS_PATH = '/listings/2021-08-01/items';
/** `searchListingsItems` returns at most 20 items a page. */
const MAX_PAGE_SIZE = 20;

export class AmazonOfferManagerAdapter
  implements
    OfferManagerPort,
    OfferLister,
    OfferStatusReader,
    OfferFieldUpdater,
    CatalogProductReader,
    EanCategoryMatcher,
    OfferCreator
{
  private readonly logger = new Logger(AmazonOfferManagerAdapter.name);
  private readonly catalog: AmazonCatalogReader;

  constructor(
    private readonly connectionId: string,
    private readonly client: AmazonSpApiClient,
    private readonly config: AmazonConnectionConfig,
  ) {
    this.catalog = new AmazonCatalogReader(client, config.marketplaceIds[0]);
  }

  async findProductsByBarcode(input: FindProductsByBarcodeInput): Promise<CatalogProductMatchResult> {
    const entries = await this.catalog.findByEan(input.barcode);
    if (entries.length === 0) {
      return { kind: 'no_match' };
    }
    if (entries.length > 1) {
      return { kind: 'ambiguous', products: entries.map(toSummary) };
    }
    return { kind: 'unique', product: toCatalogProduct(entries[0]) };
  }

  async getProduct(input: { productId: string }): Promise<CatalogProduct> {
    try {
      return toCatalogProduct(await this.catalog.getByAsin(input.productId));
    } catch (error) {
      if (error instanceof AmazonApiError && error.statusCode === 404) {
        throw new CatalogProductNotFoundException(input.productId);
      }
      throw error;
    }
  }

  async resolveCategoriesForBatchByEan(input: BatchCategoryByEanInput): Promise<Map<string, EanMatchResult>> {
    const results = new Map<string, EanMatchResult>();
    // Sequential: Catalog Items allows 2 requests a second; the client's
    // limiter paces each call, a parallel fan-out would only queue there.
    for (const item of input.items) {
      if (item.ean === null || item.ean.trim().length === 0) {
        results.set(item.variantId, { kind: 'no-ean' });
        continue;
      }
      let entries: AmazonCatalogEntry[];
      try {
        entries = await this.catalog.findByEan(item.ean);
      } catch {
        results.set(item.variantId, { kind: 'no-match' });
        continue;
      }
      if (entries.length === 0) {
        results.set(item.variantId, { kind: 'no-match' });
      } else if (entries.length === 1) {
        results.set(item.variantId, {
          kind: 'matched',
          allegroCategoryId: entries[0].productType ?? AMAZON_OFFER_ONLY_PRODUCT_TYPE,
          productCardId: entries[0].asin,
          method: 'auto_detect',
        });
      } else {
        results.set(item.variantId, {
          kind: 'multi-match',
          candidates: entries.map((entry) => ({
            allegroCategoryId: entry.productType ?? AMAZON_OFFER_ONLY_PRODUCT_TYPE,
            productCardId: entry.asin,
            name: entry.name,
          })),
        });
      }
    }
    return results;
  }

  async createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult> {
    const sku = resolveAmazonSku(cmd);
    const existing = await this.findListing(sku);
    if (existing !== null) {
      const summary = existing.summaries?.[0];
      return {
        externalOfferId: sku,
        status: summary?.status.includes('BUYABLE') ? 'active' : 'validating',
        alreadyExisted: true,
      };
    }

    const asin = cmd.productCardId ?? cmd.overrides?.productCardId ?? null;
    if (asin === null) {
      throw new AmazonNotSupportedException(
        'creating a new catalogue item: no Amazon product (ASIN) matches this barcode',
      );
    }
    const plan = composeOfferOnlyListing({
      cmd,
      asin,
      productType: cmd.overrides?.categoryId ?? null,
      marketplaceIds: this.config.marketplaceIds,
    });
    return this.submit(plan);
  }

  async listOffers(input: OfferFeedInput): Promise<OfferFeedOutput> {
    const response = await this.client.get<AmazonListingSearchResults>(`${LISTINGS_PATH}/${this.sellerPath()}`, {
      marketplaceIds: [this.primaryMarketplace()],
      includedData: ['summaries', 'fulfillmentAvailability'],
      sortBy: 'sku',
      sortOrder: 'ASC',
      pageSize: Math.min(Math.max(input.limit, 1), MAX_PAGE_SIZE),
      ...(input.cursor ? { pageToken: input.cursor } : {}),
    });
    return {
      items: response.data.items.map((item) => {
        const summary = item.summaries?.[0];
        return {
          offerId: item.sku,
          sku: item.sku,
          externalRef: summary?.asin ?? null,
          raw: {
            asin: summary?.asin ?? null,
            productType: summary?.productType ?? null,
            status: summary?.status ?? [],
            fulfilledByAmazon: isFulfilledByAmazon(item),
          },
        };
      }),
      nextCursor: response.data.pagination?.nextToken ?? null,
    };
  }

  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    const item = await this.readListing(cmd.offerId);
    if (isFulfilledByAmazon(item)) {
      // warn, not debug: OpenLinker stops propagating stock to this listing,
      // including a drop to 0, so the operator should see which SKU it is.
      this.logger.warn(
        `Skipping stock push for an Amazon-fulfilled listing (stock=${String(cmd.quantity)} not written) ` +
          `[connectionId=${this.connectionId}, sku=${cmd.offerId}]`,
      );
      return;
    }
    await this.patch(item, this.config.marketplaceIds, [
      {
        op: 'replace',
        path: '/attributes/fulfillment_availability',
        value: [
          { fulfillment_channel_code: AMAZON_SELLER_FULFILLMENT_CHANNEL, quantity: Math.max(0, Math.floor(cmd.quantity)) },
        ],
      },
    ]);
  }

  async updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<UpdateOfferFieldsReport | void> {
    const unsupported = (['title', 'description', 'taxRate'] as const).filter((field) => cmd.fields[field] !== undefined);
    if (unsupported.length > 0) {
      throw new AmazonNotSupportedException(`updating ${unsupported.join(', ')} of a listing`);
    }
    const price = cmd.fields.price;
    if (price === undefined) {
      return;
    }
    const marketplaces = this.config.marketplaceIds.filter(
      (id) => AMAZON_KNOWN_MARKETPLACES[id]?.currency === price.currency,
    );
    if (marketplaces.length === 0) {
      throw new AmazonNotSupportedException(
        `a ${price.currency} price: no configured marketplace sells in ${price.currency}`,
      );
    }
    const item = await this.readListing(cmd.externalOfferId);
    await this.patch(item, marketplaces, [
      {
        op: 'replace',
        path: '/attributes/purchasable_offer',
        value: marketplaces.map((marketplaceId) => ({
          marketplace_id: marketplaceId,
          currency: price.currency,
          our_price: [{ schedule: [{ value_with_tax: Number(price.amount) }] }],
        })),
      },
    ]);
  }

  getDescriptionFormat(): DescriptionFormat {
    // Descriptions are not written to Amazon (refused above); the conservative
    // subset keeps the content editor honest about it.
    return CONSERVATIVE_DESCRIPTION_FORMAT;
  }

  async getOfferStatus(externalOfferId: string): Promise<OfferStatusReadResult> {
    let item: AmazonListingItem;
    try {
      item = await this.readListing(externalOfferId, true);
    } catch (error) {
      if (error instanceof AmazonApiError && error.statusCode === 404) {
        // The listing is gone from Amazon: ended, so it can be listed again.
        return { publicationStatus: 'ended', validationErrors: [] };
      }
      throw error;
    }
    const marketplaceId = this.primaryMarketplace();
    const summary = item.summaries?.find((entry) => entry.marketplaceId === marketplaceId) ?? item.summaries?.[0];
    const errors = (item.issues ?? []).filter((issue) => issue.severity === 'ERROR');
    const offer = item.offers?.find((entry) => entry.marketplaceId === marketplaceId && entry.offerType === 'B2C');
    const sellerStock = item.fulfillmentAvailability?.find(
      (entry) => entry.fulfillmentChannelCode === AMAZON_SELLER_FULFILLMENT_CHANNEL,
    );
    return {
      publicationStatus: summary?.status.includes('BUYABLE') ? 'active' : 'inactive',
      validationErrors: errors.map((issue) => ({
        code: issue.code,
        message: issue.message,
        ...(issue.attributeNames?.[0] ? { field: issue.attributeNames[0] } : {}),
      })),
      commercial: {
        price: offer ? { amount: offer.price.amount, currency: offer.price.currencyCode } : null,
        availableQuantity: typeof sellerStock?.quantity === 'number' ? sellerStock.quantity : null,
      },
    };
  }

  private async submit(plan: AmazonListingPlan): Promise<CreateOfferResult> {
    const response = await this.client.put<AmazonListingSubmissionResponse>(
      `${LISTINGS_PATH}/${this.sellerPath()}/${encodeURIComponent(plan.sku)}`,
      plan.body,
      { marketplaceIds: plan.marketplaceIds },
    );
    const errors = (response.data.issues ?? []).filter((issue) => issue.severity === 'ERROR');
    if (response.data.status === 'INVALID') {
      return {
        externalOfferId: plan.sku,
        status: 'draft',
        validationErrors: (errors.length > 0 ? errors : (response.data.issues ?? [])).map((issue) => ({
          code: issue.code,
          message: issue.message,
          ...(issue.attributeNames?.[0] ? { field: issue.attributeNames[0] } : {}),
        })),
      };
    }
    return { externalOfferId: plan.sku, status: 'validating' };
  }

  /** The listing under `sku`, or `null` when Amazon has none. */
  private async findListing(sku: string): Promise<AmazonListingItem | null> {
    try {
      return await this.readListing(sku);
    } catch (error) {
      if (error instanceof AmazonApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  private async readListing(sku: string, withIssues = false): Promise<AmazonListingItem> {
    const response = await this.client.get<AmazonListingItem>(
      `${LISTINGS_PATH}/${this.sellerPath()}/${encodeURIComponent(sku)}`,
      {
        marketplaceIds: [this.primaryMarketplace()],
        includedData: withIssues
          ? ['summaries', 'offers', 'fulfillmentAvailability', 'issues']
          : ['summaries', 'fulfillmentAvailability'],
      },
    );
    return response.data;
  }

  private async patch(
    item: AmazonListingItem,
    marketplaceIds: readonly string[],
    patches: readonly Record<string, unknown>[],
  ): Promise<void> {
    const productType = item.summaries?.[0]?.productType;
    if (productType === undefined) {
      throw new AmazonNotSupportedException(`listing ${item.sku} reports no product type to patch`);
    }
    const response = await this.client.patch<AmazonListingSubmissionResponse>(
      `${LISTINGS_PATH}/${this.sellerPath()}/${encodeURIComponent(item.sku)}`,
      { productType, patches },
      { marketplaceIds },
    );
    if (response.data.status === 'INVALID') {
      const first = response.data.issues?.find((issue) => issue.severity === 'ERROR') ?? response.data.issues?.[0];
      throw new AmazonApiError(400, first?.code ?? 'INVALID', first?.message ?? 'Amazon refused the listing update', response.requestId);
    }
  }

  private sellerPath(): string {
    if (this.config.sellerId === undefined) {
      throw new AmazonConfigException(this.connectionId, 'sellerId (merchant token) is required to manage listings');
    }
    return encodeURIComponent(this.config.sellerId);
  }

  private primaryMarketplace(): string {
    return this.config.marketplaceIds[0];
  }
}

/** A listing whose stock any channel other than the seller's own (`DEFAULT`) holds is FBA. */
function isFulfilledByAmazon(item: AmazonListingItem): boolean {
  return (item.fulfillmentAvailability ?? []).some(
    (entry) => entry.fulfillmentChannelCode !== AMAZON_SELLER_FULFILLMENT_CHANNEL,
  );
}

function toSummary(entry: AmazonCatalogEntry): CatalogProductSummary {
  return {
    id: entry.asin,
    name: entry.name,
    ...(entry.ean ? { ean: entry.ean } : {}),
    ...(entry.images[0] ? { imageUrl: entry.images[0] } : {}),
  };
}

function toCatalogProduct(entry: AmazonCatalogEntry): CatalogProduct {
  return {
    ...toSummary(entry),
    images: [...entry.images],
    parameters: entry.brand ? [{ parameterId: 'brand', name: 'Brand', valueStrings: [entry.brand] }] : [],
  };
}
