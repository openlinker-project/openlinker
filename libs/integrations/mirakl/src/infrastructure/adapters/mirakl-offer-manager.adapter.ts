/**
 * Mirakl Offer Manager Adapter
 *
 * `OfferManagerPort` for offers a seller listed on a Mirakl operator (#4277).
 * An offer is keyed by its `shop_sku`: the key STO01, PRI01 and order lines
 * (#4275) use, so the identifier mapping is the same in every direction.
 *
 * - **Stock** (`updateOfferQuantity`, `OfferQuantityBatchUpdater`) and
 *   **price** (`OfferFieldUpdater`, price only) are recorded, not sent: the
 *   `marketplace.offerQuantity.reconcile` job sends them as one STO01 / PRI01
 *   file per connection and follows each import (`PendingQuantityAckReconciler`,
 *   see `MiraklOfferWriteReconciler`). Core's freshness guard, pricing rule and
 *   stock buffer run before this adapter, unchanged.
 * - **Linking** (`OfferLister`): OF21 pages, each offer carrying its shop SKU
 *   and EAN, for `marketplace.offers.sync` to match OL variants.
 * - **Status** (`OfferStatusReader`): `active` and `inactivity_reasons` from
 *   OF21 filtered by SKU (the same offer resource OF22 returns, without
 *   needing Mirakl's numeric offer id).
 *
 * **Never OF24 for stock or price.** OF24 resets every field it does not
 * receive; a partial write on staging zeroed the quantity. Nothing here posts
 * to `/api/offers`.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {OfferManagerPort}
 */
import {
  CONSERVATIVE_DESCRIPTION_FORMAT,
  OfferNotFoundOnMarketplaceException,
  type DescriptionFormat,
  type OfferFeedInput,
  type OfferFeedItem,
  type OfferFeedOutput,
  type OfferFieldUpdater,
  type OfferLister,
  type OfferManagerPort,
  type OfferQuantityBatchUpdater,
  type OfferStatusReader,
  type OfferStatusReadResult,
  type PendingQuantityAckReconcileResult,
  type PendingQuantityAckReconciler,
  type UpdateOfferFieldsCommand,
  type UpdateOfferQuantitiesBatchCommand,
  type UpdateOfferQuantitiesBatchResult,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import { MiraklConfigException } from '../../domain/exceptions/mirakl-config.exception';
import { MiraklUnsupportedFieldException } from '../../domain/exceptions/mirakl-unsupported-field.exception';
import { mapMiraklInactivityReasons } from '../../domain/policies/mirakl-inactivity-reason.policy';
import {
  formatMiraklPrice,
  formatMiraklQuantity,
} from '../../domain/policies/mirakl-offer-file.policy';
import type { MiraklOfferWriteRepositoryPort } from '../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklOffer, MiraklOffersPage } from '../../domain/types/mirakl-offer.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { MIRAKL_MAX_PAGE_SIZE } from '../http/mirakl-pagination';
import type { IMiraklImportTracker } from '../imports/mirakl-import-tracker.interface';
import { MiraklOfferWriteReconciler } from './mirakl-offer-write-reconciler';

const OFFERS_PATH = '/api/offers';
const EAN_REFERENCE_TYPES = new Set(['EAN', 'EAN13', 'GTIN', 'ISBN']);

export class MiraklOfferManagerAdapter
  implements
    OfferManagerPort,
    OfferQuantityBatchUpdater,
    PendingQuantityAckReconciler,
    OfferLister,
    OfferStatusReader,
    OfferFieldUpdater
{
  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly importTracker: IMiraklImportTracker,
    private readonly brand: string,
    /** Absent in a process without the database (unit wiring); writes then refuse. */
    private readonly writes: MiraklOfferWriteRepositoryPort | undefined
  ) {}

  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    await this.store().recordPending(this.connectionId, 'stock', [
      { offerSku: cmd.offerId, value: formatMiraklQuantity(cmd.quantity) },
    ]);
  }

  async updateOfferQuantitiesBatch(
    cmd: UpdateOfferQuantitiesBatchCommand
  ): Promise<UpdateOfferQuantitiesBatchResult> {
    await this.store().recordPending(
      this.connectionId,
      'stock',
      cmd.items.map((item) => ({
        offerSku: item.offerId,
        value: formatMiraklQuantity(item.quantity),
      }))
    );
    return { succeeded: cmd.items.map((item) => item.offerId), failed: [] };
  }

  reconcilePendingQuantityAcks(limit: number): Promise<PendingQuantityAckReconcileResult> {
    return new MiraklOfferWriteReconciler(
      this.connectionId,
      this.httpClient,
      this.importTracker,
      this.store()
    ).reconcile(limit);
  }

  async updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<void> {
    const { price, ...others } = cmd.fields;
    const unsupported = Object.entries(others)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field);
    if (unsupported.length > 0) {
      throw new MiraklUnsupportedFieldException(
        `${this.brand} offers take only the price from OpenLinker; not supported: ${unsupported.join(', ')}`,
        unsupported
      );
    }
    if (!price) {
      return;
    }
    const value = formatMiraklPrice(price.amount);
    if (value === null) {
      throw new MiraklUnsupportedFieldException(
        `Price "${price.amount}" for offer ${cmd.externalOfferId} is not a non-negative number`,
        ['price']
      );
    }
    await this.store().recordPending(this.connectionId, 'price', [
      { offerSku: cmd.externalOfferId, value, currency: price.currency },
    ]);
  }

  getDescriptionFormat(): DescriptionFormat {
    // The description is never written (only the price is); declared so the
    // capability resolves, with the conservative subset.
    return CONSERVATIVE_DESCRIPTION_FORMAT;
  }

  async listOffers(input: OfferFeedInput): Promise<OfferFeedOutput> {
    const offset = parseOffset(input.cursor);
    const max = Math.max(1, Math.min(input.limit, MIRAKL_MAX_PAGE_SIZE));
    const { data } = await this.httpClient.get<MiraklOffersPage>(OFFERS_PATH, {
      queryParams: { max, offset },
    });
    const offers = data?.offers ?? [];
    const read = offset + offers.length;
    const total = typeof data?.total_count === 'number' ? data.total_count : undefined;
    const more = offers.length === max && (total === undefined || read < total);
    return {
      items: offers.flatMap((offer) => toFeedItem(offer)),
      nextCursor: more ? String(read) : null,
    };
  }

  async getOfferStatus(externalOfferId: string): Promise<OfferStatusReadResult> {
    const { data } = await this.httpClient.get<MiraklOffersPage>(OFFERS_PATH, {
      queryParams: { sku: externalOfferId },
    });
    const offer = (data?.offers ?? []).find((candidate) => candidate.shop_sku === externalOfferId);
    if (!offer) {
      throw new OfferNotFoundOnMarketplaceException(externalOfferId, this.connectionId);
    }
    return {
      publicationStatus: offer.active === true ? 'active' : 'inactive',
      validationErrors:
        offer.active === true
          ? []
          : mapMiraklInactivityReasons(offer.inactivity_reasons, this.brand),
      commercial: {
        price:
          typeof offer.price === 'number' && offer.currency_iso_code
            ? { amount: offer.price.toFixed(2), currency: offer.currency_iso_code }
            : null,
        availableQuantity: typeof offer.quantity === 'number' ? offer.quantity : null,
      },
    };
  }

  private store(): MiraklOfferWriteRepositoryPort {
    if (!this.writes) {
      throw new MiraklConfigException(
        `${this.brand} stock and price writes need the database; this process has none`,
        this.connectionId
      );
    }
    return this.writes;
  }
}

function parseOffset(cursor: string | null | undefined): number {
  const parsed = Number(cursor ?? 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function toFeedItem(offer: MiraklOffer): OfferFeedItem[] {
  if (!offer.shop_sku) {
    return [];
  }
  const ean = (offer.product_references ?? []).find(
    (reference) =>
      reference.reference && EAN_REFERENCE_TYPES.has((reference.reference_type ?? '').toUpperCase())
  )?.reference;
  return [
    {
      offerId: offer.shop_sku,
      externalRef: offer.shop_sku,
      sku: offer.shop_sku,
      ean: ean ?? null,
      raw: {
        offerId: offer.offer_id,
        productSku: offer.product_sku,
        active: offer.active,
      },
    },
  ];
}
