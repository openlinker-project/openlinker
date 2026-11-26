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
 *     On a connection that is also the stock master (#4183) the write is
 *     skipped: Amazon is where that number comes from, and writing back the
 *     quantity OpenLinker publishes (net of reservations and the safety
 *     buffer) would lower Amazon's stock on every sync. Unreachable while
 *     `ConnectionService` refuses `InventoryMaster` beside `OfferManager`
 *     (#1498); kept as defence in depth should that rule ever be relaxed.
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
 *     reports `validating` and the status read reports the outcome. With no
 *     ASIN, a new catalogue item (`LISTING`) under the chosen product type,
 *     with title, brand, EAN, description, images and the product type's
 *     attributes; a product without a barcode is refused (Amazon's GTIN
 *     exemption is granted in Seller Central only).
 *   - `CategoryBrowser` + `TaxonomyIdentityProvider` + `CategoryParametersReader`
 *     (#4181): a marketplace's product types are its categories, a flat list
 *     (one tree per marketplace and environment); a type's parameters are the
 *     required simple attributes of its JSON Schema.
 *   - `OfferStatusReader`: `getListingsItem` with summaries, offers,
 *     fulfilment and issues: `BUYABLE` is active, otherwise inactive; a
 *     listing with no status for the primary marketplace yet and no ERROR
 *     issue is still being processed (`activating`); ERROR issues are the
 *     validation errors; the live price and quantity are the commercial
 *     observation. A listing Amazon no longer has (404) is `ended`, so a 404
 *     read right after a create closes that record.
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
  amazonTaxonomyOwner,
  CatalogProductNotFoundException,
  CONSERVATIVE_DESCRIPTION_FORMAT,
  type BatchCategoryByEanInput,
  type CatalogProduct,
  type CatalogProductMatchResult,
  type CatalogProductReader,
  type CatalogProductSummary,
  type CategoryBrowser,
  type CategoryParameter,
  type CategoryParametersReader,
  type CreateOfferCommand,
  type CreateOfferResult,
  type DescriptionFormat,
  type EanCategoryMatcher,
  type EanMatchResult,
  type FindProductsByBarcodeInput,
  type OfferCategory,
  type OfferCreator,
  type OfferParameter,
  type OfferFeedInput,
  type OfferFeedOutput,
  type OfferFieldUpdater,
  type OfferLister,
  type OfferManagerPort,
  type OfferStatusReadResult,
  type OfferStatusReader,
  type TaxonomyIdentityProvider,
  type TaxonomyOwner,
  type UpdateOfferFieldsCommand,
  type UpdateOfferFieldsReport,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import type { CachePort } from '@openlinker/shared';
import type { FetchLike } from '@openlinker/shared/http';
import { Logger } from '@openlinker/shared/logging';

import { AMAZON_KNOWN_MARKETPLACES } from '../../../amazon.constants';
import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import { AmazonConfigException } from '../../../domain/exceptions/amazon-config.exception';
import { AmazonNotSupportedException } from '../../../domain/exceptions/amazon-not-supported.exception';
import { resolveAmazonTaxCode } from '../../../domain/policies/amazon-tax-code.policy';
import type { AmazonCatalogEntry } from '../../../domain/types/amazon-catalog.types';
import type { AmazonConnectionConfig } from '../../../domain/types/amazon-config.types';
import {
  AMAZON_SELLER_FULFILLMENT_CHANNEL,
  type AmazonListingItem,
  type AmazonListingSearchResults,
  type AmazonListingSubmissionResponse,
} from '../../../domain/types/amazon-listing.types';
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';
import { patchAmazonListing, sellerQuantityPatch } from '../../writers/amazon-listing-patch';
import {
  AMAZON_OFFER_ONLY_PRODUCT_TYPE,
  composeFullListing,
  composeOfferOnlyListing,
  resolveAmazonSku,
  type AmazonListingPlan,
} from '../../mappers/amazon-listing-composer';
import { mapProductTypeSchemaToParameters } from '../../mappers/amazon-product-type-schema.mapper';
import { listingEan } from '../../mappers/amazon-product.mapper';
import { AmazonCatalogReader, CATALOG_SEARCH_MAX_IDENTIFIERS, normalizeEan } from './amazon-catalog-reader';
import { AmazonProductTypeReader } from './amazon-product-type-reader';

const LISTINGS_PATH = '/listings/2021-08-01/items';
/**
 * Waits before re-asking a throttled catalogue search. The transport already
 * paces Catalog Items at its quota, so a 429 means another app on the seller
 * spent it; a couple of short waits usually clear it.
 */
const CATALOG_THROTTLE_RETRY_DELAYS_MS = [1_000, 3_000] as const;
/** `searchListingsItems` returns at most 20 items a page. */
const MAX_PAGE_SIZE = 20;
/**
 * A product type's parameters change only when Amazon republishes its schema,
 * and reading them costs a Product Type Definitions call plus a schema of
 * several megabytes, once per offer built. Kept a day, as Allegro keeps its
 * category parameters.
 */
const PRODUCT_TYPE_PARAMS_TTL_SEC = 24 * 60 * 60;

export class AmazonOfferManagerAdapter
  implements
    OfferManagerPort,
    OfferLister,
    OfferStatusReader,
    OfferFieldUpdater,
    CatalogProductReader,
    EanCategoryMatcher,
    OfferCreator,
    CategoryBrowser,
    CategoryParametersReader,
    TaxonomyIdentityProvider
{
  private readonly logger = new Logger(AmazonOfferManagerAdapter.name);

  private readonly catalog: AmazonCatalogReader;
  private readonly productTypes: AmazonProductTypeReader;

  constructor(
    private readonly connectionId: string,
    private readonly client: AmazonSpApiClient,
    private readonly config: AmazonConnectionConfig,
    fetchImpl: FetchLike,
    private readonly cache?: CachePort,
    private readonly isStockMaster = false,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {
    this.catalog = new AmazonCatalogReader(client, config.marketplaceIds[0]);
    this.productTypes = new AmazonProductTypeReader(client, fetchImpl, config.marketplaceIds[0]);
  }

  getTaxonomyIdentity(): TaxonomyOwner {
    return amazonTaxonomyOwner(this.primaryMarketplace(), this.config.environment === 'sandbox');
  }

  async fetchCategories(parentId?: string): Promise<OfferCategory[]> {
    // Product types are a flat list: nothing sits under one.
    if (parentId !== undefined) {
      return [];
    }
    const types = await this.productTypes.listProductTypes();
    return types.map((type) => ({ id: type.name, name: type.displayName ?? type.name, parentId: null, leaf: true }));
  }

  async fetchCategoryParameters(input: { categoryId: string }): Promise<CategoryParameter[]> {
    // The schema is the same for every seller of a marketplace in one
    // environment (no seller is named in the read), so the key is not
    // per connection.
    const cacheKey = `amazon:product-type-params:${this.config.environment}:${this.primaryMarketplace()}:${input.categoryId}`;
    const cached = this.cache ? await this.cache.get<CategoryParameter[]>(cacheKey) : null;
    if (cached) {
      return cached;
    }
    const parameters = mapProductTypeSchemaToParameters(await this.productTypes.getSchema(input.categoryId));
    if (this.cache) {
      await this.cache.set(cacheKey, parameters, PRODUCT_TYPE_PARAMS_TTL_SEC);
    }
    return parameters;
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
    const byEan = new Map<string, string[]>();
    for (const item of input.items) {
      if (item.ean === null || item.ean.trim().length === 0) {
        results.set(item.variantId, { kind: 'no-ean' });
        continue;
      }
      const normalized = normalizeEan(item.ean);
      if (normalized === null) {
        results.set(item.variantId, { kind: 'no-match' });
        continue;
      }
      byEan.set(normalized, [...(byEan.get(normalized) ?? []), item.variantId]);
    }

    // One search per 20 barcodes, sequential: the transport paces Catalog Items
    // at 2 requests a second, so a parallel fan-out would only queue there.
    const eans = [...byEan.keys()];
    for (let offset = 0; offset < eans.length; offset += CATALOG_SEARCH_MAX_IDENTIFIERS) {
      const chunk = eans.slice(offset, offset + CATALOG_SEARCH_MAX_IDENTIFIERS);
      let found: Map<string, AmazonCatalogEntry[]>;
      try {
        found = await this.searchCatalogWithRetry(chunk);
      } catch (error) {
        // The port folds a failed lookup into `no-match`; the log is what tells
        // a throttled or refused catalogue read from a barcode Amazon lacks.
        this.logger.warn(
          `Amazon catalogue lookup failed for ${chunk.length} barcode(s) on connection ${this.connectionId}: ${describeLookupFailure(error)}`,
        );
        for (const ean of chunk) {
          for (const variantId of byEan.get(ean) ?? []) {
            results.set(variantId, { kind: 'no-match' });
          }
        }
        continue;
      }
      for (const ean of chunk) {
        const result = toEanMatchResult(found.get(ean) ?? []);
        for (const variantId of byEan.get(ean) ?? []) {
          results.set(variantId, result);
        }
      }
    }
    return results;
  }

  /** A throttled search is asked again after a short wait instead of reading as "no product". */
  private async searchCatalogWithRetry(eans: readonly string[]): Promise<Map<string, AmazonCatalogEntry[]>> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.catalog.searchByEans(eans);
      } catch (error) {
        const delay = CATALOG_THROTTLE_RETRY_DELAYS_MS[attempt];
        if (!(error instanceof AmazonApiError) || error.statusCode !== 429 || delay === undefined) {
          throw error;
        }
        await this.sleep(delay);
      }
    }
  }

  async createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult> {
    // A bundle is a product set on the marketplaces that have one. Amazon
    // lists a bundle as its own catalogue item, which this integration does
    // not compose; refusing before any read keeps a bundle from being listed
    // as its first component, or reported as already listed under that SKU.
    if (cmd.productSet !== undefined && cmd.productSet.length > 0) {
      throw new AmazonNotSupportedException('listing a bundle (a product set) as one offer');
    }
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
      return this.submit(this.planNewItem(cmd));
    }
    const plan = composeOfferOnlyListing({
      taxCode: this.taxCodeFor(cmd.taxRate),
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
      // `attributes` carries the listing's EAN, which offer linking matches
      // within the master catalogue; without it only a unique SKU links.
      includedData: ['summaries', 'attributes', 'fulfillmentAvailability'],
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
          ean: listingEan(item, this.primaryMarketplace()),
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
    if (this.isStockMaster) {
      this.logger.log(
        `Skipping the quantity write to Amazon listing ${cmd.offerId}: this connection is the stock master ` +
          `(connection: ${this.connectionId})`,
      );
      return;
    }
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
    await this.patch(item, this.config.marketplaceIds, [sellerQuantityPatch(cmd.quantity)]);
  }

  async updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<UpdateOfferFieldsReport | void> {
    const unsupported = (['title', 'description'] as const).filter((field) => cmd.fields[field] !== undefined);
    if (unsupported.length > 0) {
      throw new AmazonNotSupportedException(`updating ${unsupported.join(', ')} of a listing`);
    }
    if (cmd.fields.taxRate !== undefined) {
      await this.updateTaxCode(cmd.externalOfferId, cmd.fields.taxRate);
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

  /**
   * The `product_tax_code` the catalogue rate maps to through the connection's
   * `taxCodeRates`, or `null` (the listing then keeps Amazon's account
   * default). An unmapped or ambiguous rate is logged, never guessed.
   */
  private taxCodeFor(rate: string | undefined): string | null {
    const resolution = resolveAmazonTaxCode(rate, this.config.taxCodeRates);
    if (resolution.kind === 'resolved') {
      return resolution.code;
    }
    if (resolution.reason !== 'no-rate') {
      this.logger.warn(
        `Amazon tax code not sent for rate ${rate ?? ''}: ${
          resolution.reason === 'ambiguous'
            ? `codes ${resolution.codes?.join(', ')} map to it`
            : 'no tax code is mapped to it on the connection'
        }`,
      );
    }
    return null;
  }

  /**
   * A tax rate change is a tax CODE change on Amazon. A rate no code maps to is
   * not written and is logged, exactly as `createOffer` leaves the code out
   * (`taxCodeFor`): an unmapped rate is a gap in the connection's map, not a
   * conflict, so it must not fail the job (ADR-063 refuses only behind
   * `OL_TAX_RATE_STRICT_ENABLED` or on a conflict). The code goes to the
   * marketplaces the listing is on, not every configured one.
   */
  private async updateTaxCode(externalOfferId: string, rate: string): Promise<void> {
    const code = this.taxCodeFor(rate);
    if (code === null) {
      return;
    }
    const item = await this.readListing(externalOfferId);
    const listed = this.config.marketplaceIds.filter((marketplaceId) =>
      item.summaries?.some((summary) => summary.marketplaceId === marketplaceId),
    );
    const marketplaces = listed.length > 0 ? listed : this.config.marketplaceIds;
    await this.patch(item, marketplaces, [
      {
        op: 'replace',
        path: '/attributes/product_tax_code',
        value: marketplaces.map((marketplaceId) => ({ value: code, marketplace_id: marketplaceId })),
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
    const summary = item.summaries?.find((entry) => entry.marketplaceId === marketplaceId);
    const errors = (item.issues ?? []).filter((issue) => issue.severity === 'ERROR');
    const offer = item.offers?.find((entry) => entry.marketplaceId === marketplaceId && entry.offerType === 'B2C');
    const sellerStock = item.fulfillmentAvailability?.find(
      (entry) => entry.fulfillmentChannelCode === AMAZON_SELLER_FULFILLMENT_CHANNEL,
    );
    return {
      publicationStatus: readPublicationStatus(summary, errors.length > 0),
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

  private planNewItem(cmd: CreateOfferCommand): AmazonListingPlan {
    const productType = cmd.overrides?.categoryId;
    if (productType === undefined || productType.trim().length === 0) {
      throw new AmazonNotSupportedException('a new catalogue item with no product type: choose a category');
    }
    const barcode = cmd.variantBarcode ?? cmd.overrides?.ean ?? null;
    const ean = barcode === null ? null : normalizeEan(barcode);
    if (ean === null) {
      throw new AmazonNotSupportedException(
        'a new catalogue item without a valid EAN; a GTIN exemption is granted in Seller Central only',
      );
    }
    const title = cmd.overrides?.title?.trim();
    if (title === undefined || title.length === 0) {
      throw new AmazonNotSupportedException('a new catalogue item without a title');
    }
    const parameters = cmd.parameters ?? cmd.overrides?.parameters ?? [];
    const brand = readBrand(cmd, parameters);
    if (brand === null) {
      throw new AmazonNotSupportedException('a new catalogue item without a brand: set the brand parameter');
    }
    return composeFullListing({
      taxCode: this.taxCodeFor(cmd.taxRate),
      cmd,
      productType,
      marketplaceIds: this.config.marketplaceIds,
      content: {
        title,
        brand,
        ean,
        description: cmd.overrides?.description ?? null,
        imageUrls: cmd.overrides?.imageUrls ?? [],
        parameters: parameters.filter((parameter) => parameter.id !== 'brand'),
      },
    });
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

  private patch(
    item: AmazonListingItem,
    marketplaceIds: readonly string[],
    patches: readonly Record<string, unknown>[],
  ): Promise<void> {
    return patchAmazonListing(this.client, this.sellerId(), item, marketplaceIds, patches);
  }

  private sellerPath(): string {
    return encodeURIComponent(this.sellerId());
  }

  private sellerId(): string {
    if (this.config.sellerId === undefined) {
      throw new AmazonConfigException(this.connectionId, 'sellerId (merchant token) is required to manage listings');
    }
    return this.config.sellerId;
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

/**
 * Amazon reports a listing's status per marketplace only once it has processed
 * the listing, minutes after answering `ACCEPTED`. Until then (no summary for
 * the primary marketplace and no ERROR issue) the listing is still being
 * processed, `activating`, so the creation poll waits instead of closing a new
 * listing as a draft, as Allegro does while its create operation runs. ERROR
 * issues mean Amazon has refused it.
 */
function readPublicationStatus(
  summary: { readonly status: readonly string[] } | undefined,
  hasErrors: boolean,
): OfferStatusReadResult['publicationStatus'] {
  if (summary === undefined) {
    return hasErrors ? 'inactive' : 'activating';
  }
  return summary.status.includes('BUYABLE') ? 'active' : 'inactive';
}

/** The status and Amazon's error code, never the response body. */
function toEanMatchResult(entries: readonly AmazonCatalogEntry[]): EanMatchResult {
  if (entries.length === 0) {
    return { kind: 'no-match' };
  }
  if (entries.length === 1) {
    return {
      kind: 'matched',
      allegroCategoryId: entries[0].productType ?? AMAZON_OFFER_ONLY_PRODUCT_TYPE,
      productCardId: entries[0].asin,
      method: 'auto_detect',
    };
  }
  return {
    kind: 'multi-match',
    candidates: entries.map((entry) => ({
      allegroCategoryId: entry.productType ?? AMAZON_OFFER_ONLY_PRODUCT_TYPE,
      productCardId: entry.asin,
      name: entry.name,
    })),
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeLookupFailure(error: unknown): string {
  if (error instanceof AmazonApiError) {
    return `HTTP ${error.statusCode}${error.errorCode ? ` ${error.errorCode}` : ''}`;
  }
  return error instanceof Error ? error.name : 'unknown error';
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

const BRAND_ATTRIBUTE_PATTERN = /^(brand|marka|manufacturer|producent|hersteller|marque)$/i;

/**
 * The brand: the `brand` parameter, else `platformParams.brand`, else the
 * master's brand or manufacturer attribute.
 */
function readBrand(cmd: CreateOfferCommand, parameters: readonly OfferParameter[]): string | null {
  const parameter = parameters.find((entry) => entry.id === 'brand');
  const fromParameter = parameter?.values?.[0] ?? parameter?.valuesIds?.[0];
  const fromParams = cmd.overrides?.platformParams?.['brand'];
  const fromSource = cmd.sourceAttributes?.find((attribute) => BRAND_ATTRIBUTE_PATTERN.test(attribute.name.trim()))?.value;
  const brand = fromParameter ?? (typeof fromParams === 'string' ? fromParams : undefined) ?? fromSource;
  return brand !== undefined && brand.trim().length > 0 ? brand.trim() : null;
}
