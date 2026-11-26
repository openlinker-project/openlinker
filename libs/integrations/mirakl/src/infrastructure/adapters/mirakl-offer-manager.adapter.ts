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
 *   needing Mirakl's numeric offer id). An offer whose create import is still
 *   running reads `activating`, and one the import refused reads `inactive`
 *   with the import's reason (#4278).
 * - **Listing** (#4278): categories, category parameters and EAN-to-card
 *   matching (`MiraklCatalog`), the taxonomy identity, and offer creation on
 *   an existing card (`MiraklOfferCreator`).
 *
 * **Never OF24 for stock or price changes.** OF24 resets every field it does
 * not receive; a partial write on staging zeroed the quantity. It is used once
 * per offer, by the creator, with the full field set; this class never posts
 * to `/api/offers`.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {OfferManagerPort}
 */
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import {
  CONSERVATIVE_DESCRIPTION_FORMAT,
  OfferNotFoundOnMarketplaceException,
  type BatchCategoryByEanInput,
  type CategoryBarcodeMatcher,
  type CategoryBrowser,
  type CategoryParameter,
  type CategoryParametersReader,
  type CreateOfferCommand,
  type CreateOfferResult,
  type DescriptionFormat,
  type EanCategoryMatcher,
  type EanMatchResult,
  type OfferCategory,
  type OfferCreator,
  type TaxonomyIdentityProvider,
  type TaxonomyOwner,
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
import { pickMiraklBarcode } from '../../domain/policies/mirakl-offer-reference.policy';
import {
  formatMiraklPrice,
  formatMiraklQuantity,
} from '../../domain/policies/mirakl-offer-file.policy';
import type { MiraklOfferWriteRepositoryPort } from '../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklOfferDefaults } from '../../domain/types/mirakl-connection.types';
import type { MiraklOffer, MiraklOffersPage } from '../../domain/types/mirakl-offer.types';
import type { MiraklCardAttributeCodes } from '../../domain/types/mirakl-operator-profile.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { MIRAKL_MAX_PAGE_SIZE } from '../http/mirakl-pagination';
import type { IMiraklImportTracker } from '../imports/mirakl-import-tracker.interface';
import { MiraklCardCreationPass } from './mirakl-card-creation-pass';
import { MiraklCatalog } from './mirakl-catalog';
import { MiraklOfferCreator } from './mirakl-offer-creator';
import { MiraklOfferWriteReconciler } from './mirakl-offer-write-reconciler';

const OFFERS_PATH = '/api/offers';

/** What one connection's offer manager is built from. */
export interface MiraklOfferManagerSettings {
  readonly connectionId: string;
  readonly adapterKey: string;
  readonly brand: string;
  readonly httpClient: IMiraklHttpClient;
  readonly importTracker: IMiraklImportTracker;
  /** Absent in a process without the database (unit wiring); writes then refuse. */
  readonly writes: MiraklOfferWriteRepositoryPort | undefined;
  readonly taxonomyOwner: TaxonomyOwner;
  readonly offerDefaults?: MiraklOfferDefaults;
  /** The card attributes OpenLinker fills when it creates a card (#4278). */
  readonly cardAttributes: MiraklCardAttributeCodes;
  /** Lets the card pass drop the offer mapping of a card that failed. */
  readonly identifierMapping?: Pick<IdentifierMappingPort, 'deleteMapping'>;
}

export class MiraklOfferManagerAdapter
  implements
    OfferManagerPort,
    OfferQuantityBatchUpdater,
    PendingQuantityAckReconciler,
    OfferLister,
    OfferStatusReader,
    OfferFieldUpdater,
    OfferCreator,
    CategoryBrowser,
    CategoryParametersReader,
    EanCategoryMatcher,
    CategoryBarcodeMatcher,
    TaxonomyIdentityProvider
{
  private readonly connectionId: string;
  private readonly httpClient: IMiraklHttpClient;
  private readonly importTracker: IMiraklImportTracker;
  private readonly brand: string;
  private readonly writes: MiraklOfferWriteRepositoryPort | undefined;
  private readonly catalog: MiraklCatalog;
  private readonly creator: MiraklOfferCreator;

  constructor(private readonly settings: MiraklOfferManagerSettings) {
    this.connectionId = settings.connectionId;
    this.httpClient = settings.httpClient;
    this.importTracker = settings.importTracker;
    this.brand = settings.brand;
    this.writes = settings.writes;
    this.catalog = new MiraklCatalog(
      settings.connectionId,
      settings.httpClient,
      settings.cardAttributes
    );
    this.creator = new MiraklOfferCreator({
      connectionId: settings.connectionId,
      adapterKey: settings.adapterKey,
      brand: settings.brand,
      httpClient: settings.httpClient,
      catalog: this.catalog,
      writes: (): MiraklOfferWriteRepositoryPort => this.store(),
      offerDefaults: settings.offerDefaults ?? {},
      cardAttributes: settings.cardAttributes,
    });
  }

  getTaxonomyIdentity(): TaxonomyOwner {
    return this.settings.taxonomyOwner;
  }

  fetchCategories(parentId?: string): Promise<OfferCategory[]> {
    return this.catalog.fetchCategories(parentId);
  }

  fetchCategoryParameters(input: { categoryId: string }): Promise<CategoryParameter[]> {
    return this.catalog.fetchCategoryParameters(input);
  }

  resolveCategoriesForBatchByEan(
    input: BatchCategoryByEanInput
  ): Promise<Map<string, EanMatchResult>> {
    return this.catalog.resolveCategoriesForBatchByEan(input);
  }

  /**
   * The category of the card this EAN points to, for the offer build. The
   * wizard matches cards in batches (`EanCategoryMatcher`) but submits a
   * card-linked row without a category, and the build resolves it again one
   * EAN at a time through this method; without it every Empik offer on a
   * card needed a category picked by hand.
   */
  matchCategoryByBarcode(barcode: string): Promise<string | null> {
    return this.catalog.matchCategoryByBarcode(barcode);
  }

  createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult> {
    return this.creator.createOffer(cmd);
  }

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

  /**
   * The offer-writes pass (stock and price files, offer imports), then the
   * card pass (#4278): cards OpenLinker creates are sent, followed through the
   * operator's review and turned into offers. The card pass runs even when the
   * first one throws, and the first failure is thrown at the end.
   */
  async reconcilePendingQuantityAcks(limit: number): Promise<PendingQuantityAckReconcileResult> {
    let writes: PendingQuantityAckReconcileResult = { reconciled: 0, stillPending: 0 };
    let firstFailure: unknown;
    try {
      writes = await new MiraklOfferWriteReconciler(
        this.connectionId,
        this.httpClient,
        this.importTracker,
        this.store()
      ).reconcile(limit);
    } catch (error) {
      firstFailure = error;
    }
    const cards = await new MiraklCardCreationPass({
      connectionId: this.connectionId,
      brand: this.brand,
      httpClient: this.httpClient,
      importTracker: this.importTracker,
      catalog: this.catalog,
      writes: this.store(),
      codes: this.settings.cardAttributes,
      identifierMapping: this.settings.identifierMapping,
    }).run();
    if (firstFailure !== undefined) {
      throw firstFailure;
    }
    return {
      reconciled: writes.reconciled + cards.settled,
      stillPending: writes.stillPending + cards.waiting,
    };
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
      const pending =
        (await this.statusOfCreateImport(externalOfferId)) ??
        (await this.statusOfCardRequest(externalOfferId));
      if (pending) {
        return pending;
      }
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

  /**
   * An offer OpenLinker just created is not in OF21 until its OF24 import has
   * run. While it runs the offer reads `activating`; if the import refused the
   * offer, `inactive` with the import's reason. `null` when OpenLinker did not
   * create it, which leaves the not-found answer to the caller.
   */
  /**
   * An offer whose card OpenLinker is creating (#4278): `activating` while the
   * card is queued or under the operator's review, refused with Mirakl's
   * reason when the card was refused.
   */
  private async statusOfCardRequest(offerSku: string): Promise<OfferStatusReadResult | null> {
    const card = await this.writes?.findLatest(this.connectionId, 'card', offerSku);
    if (!card || card.status === 'applied') {
      return null;
    }
    if (card.status === 'failed') {
      return refused(card.error ?? `${this.brand} refused the product card`);
    }
    return { publicationStatus: 'activating', validationErrors: [] };
  }

  private async statusOfCreateImport(offerSku: string): Promise<OfferStatusReadResult | null> {
    const created = await this.writes?.findLatest(this.connectionId, 'offer', offerSku);
    if (!created?.importId) {
      return null;
    }
    if (created.status === 'failed') {
      return refused(created.error ?? 'The offer import failed');
    }
    const status = await this.importTracker.getStatus('offers', created.importId);
    if (status.state === 'failed') {
      return refused(`The offer import ended as ${status.rawStatus ?? 'failed'}`);
    }
    if (status.state === 'done' && ((status.linesInError ?? 0) > 0 || status.hasErrorReport)) {
      const lines = await this.importTracker.getErrorReport('offers', created.importId);
      const line =
        lines.find((candidate) => candidate.sku === offerSku) ??
        (lines.length === 1 ? lines[0] : undefined);
      if (line) {
        return refused(line.reason);
      }
    }
    return { publicationStatus: 'activating', validationErrors: [] };
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

function refused(reason: string): OfferStatusReadResult {
  return {
    publicationStatus: 'inactive',
    validationErrors: [{ code: 'MIRAKL_OFFER_IMPORT_FAILED', message: reason }],
  };
}

function parseOffset(cursor: string | null | undefined): number {
  const parsed = Number(cursor ?? 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function toFeedItem(offer: MiraklOffer): OfferFeedItem[] {
  if (!offer.shop_sku) {
    return [];
  }
  const ean = pickMiraklBarcode(offer.product_references);
  return [
    {
      offerId: offer.shop_sku,
      externalRef: offer.shop_sku,
      sku: offer.shop_sku,
      ean,
      raw: {
        offerId: offer.offer_id,
        productSku: offer.product_sku,
        active: offer.active,
      },
    },
  ];
}
