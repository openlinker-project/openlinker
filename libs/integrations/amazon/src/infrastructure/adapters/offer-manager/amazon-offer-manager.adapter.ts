/**
 * Amazon Offer Manager Adapter (#4180)
 *
 * `OfferManager` for Amazon over Listings Items API v2021-08-01. An Amazon
 * offer is addressed by the seller's SKU, so the external offer id IS the SKU.
 *
 *   - `OfferLister`: the seller's listings (`searchListingsItems`, 20 a page,
 *     ordered by SKU so pages tile), reported with SKU and ASIN; the offer
 *     mapping sync links them to variants by SKU.
 *   - `updateOfferQuantity`: `patchListingsItem` replacing
 *     `fulfillment_availability` with the seller channel (`DEFAULT`). A listing
 *     Amazon fulfils (FBA) is refused, never written: its stock is Amazon's.
 *     Quantity 0 is the pause (#1689); `deleteListingsItem` is never used.
 *   - `OfferFieldUpdater`: price only, `patchListingsItem` replacing
 *     `purchasable_offer` for each configured marketplace whose currency is the
 *     price's (FR / DE: EUR, PL: PLN). Title, description and tax rate are
 *     refused rather than ignored.
 *   - `OfferStatusReader`: `getListingsItem` with summaries, offers,
 *     fulfilment and issues: `BUYABLE` is active, otherwise inactive; ERROR
 *     issues are the validation errors; the live price and quantity are the
 *     commercial observation.
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
  CONSERVATIVE_DESCRIPTION_FORMAT,
  type DescriptionFormat,
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

import { AMAZON_KNOWN_MARKETPLACES } from '../../../amazon.constants';
import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import { AmazonConfigException } from '../../../domain/exceptions/amazon-config.exception';
import { AmazonNotSupportedException } from '../../../domain/exceptions/amazon-not-supported.exception';
import type { AmazonConnectionConfig } from '../../../domain/types/amazon-config.types';
import {
  AMAZON_SELLER_FULFILLMENT_CHANNEL,
  type AmazonListingItem,
  type AmazonListingSearchResults,
  type AmazonListingSubmissionResponse,
} from '../../../domain/types/amazon-listing.types';
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';

const LISTINGS_PATH = '/listings/2021-08-01/items';
/** `searchListingsItems` returns at most 20 items a page. */
const MAX_PAGE_SIZE = 20;

export class AmazonOfferManagerAdapter implements OfferManagerPort, OfferLister, OfferStatusReader, OfferFieldUpdater {
  constructor(
    private readonly connectionId: string,
    private readonly client: AmazonSpApiClient,
    private readonly config: AmazonConnectionConfig,
  ) {}

  async listOffers(input: OfferFeedInput): Promise<OfferFeedOutput> {
    const response = await this.client.get<AmazonListingSearchResults>(`${LISTINGS_PATH}/${this.sellerPath()}`, {
      marketplaceIds: [this.primaryMarketplace()],
      includedData: ['summaries'],
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
          raw: { asin: summary?.asin ?? null, productType: summary?.productType ?? null, status: summary?.status ?? [] },
        };
      }),
      nextCursor: response.data.pagination?.nextToken ?? null,
    };
  }

  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    const item = await this.readListing(cmd.offerId);
    const channels = item.fulfillmentAvailability ?? [];
    if (channels.some((entry) => entry.fulfillmentChannelCode !== AMAZON_SELLER_FULFILLMENT_CHANNEL)) {
      throw new AmazonNotSupportedException(
        `listing ${cmd.offerId} is fulfilled by Amazon; its stock is not written from OpenLinker`,
      );
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
    const item = await this.readListing(externalOfferId, true);
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
