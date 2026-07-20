/**
 * Allegro Offer Manager Adapter
 *
 * Adapter implementing `OfferManagerPort` for Allegro. Handles offer feed
 * ingestion, quantity + field updates, offer creation, category directory,
 * barcode-to-category matching, and seller-policy discovery. Order-source
 * concerns live in the sibling `AllegroOrderSourceAdapter` since #328.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {OfferManagerPort}
 */
import type {
  OfferManagerPort,
  OfferLister,
  OfferEventReader,
  OfferFieldUpdater,
  CategoryBrowser,
  CategoryPathReader,
  CategoryPathNode,
  CategoryBarcodeMatcher,
  EanCategoryMatcher,
  BatchCategoryByEanInput,
  EanMatchResult,
  CategoryParametersReader,
  CatalogProductReader,
  CatalogProduct,
  CatalogProductMatchResult,
  CatalogProductSummary,
  FindProductsByBarcodeInput,
  OfferCreator,
  OfferStatusReader,
  OfferStatusReadResult,
  OfferPublicationStatus,
  OfferReader,
  OfferSmartClassificationReader,
  SmartClassificationReport,
  SellerPoliciesReader,
  ResponsibleProducerReader,
  ResponsibleProducerEntry,
  OfferFeedInput,
  OfferFeedOutput,
  UpdateOfferQuantityCommand,
  UpdateOfferFieldsCommand,
  CreateOfferCommand,
  OfferCondition,
  OfferParameter,
  CreateOfferResult,
  CreateOfferResultStatus,
  CreateOfferValidationError,
  OfferCategory,
  CategoryParameter,
  CategoryParameterSection,
  MarketplaceOffer,
  MarketplaceOfferParameter,
  MarketplaceOfferProductSetItem,
  SellerPolicies,
  SafetyAttachmentUploader,
  SafetyAttachmentUploadInput,
  SafetyAttachmentUploadResult,
} from '@openlinker/core/listings';
import {
  OfferCreateRejectedException,
  CategoryNotFoundException,
  OfferNotFoundOnMarketplaceException,
} from '@openlinker/core/listings';
import type { AllegroSellerDefaultsConfig } from '../../domain/types/allegro-seller-defaults.types';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import {
  resolveAllegroProductCardByEan,
  type ResolveProductCardResult,
} from '../util/resolve-allegro-product-card-by-ean';
import { resolveCategoriesForBatchByEan } from '../util/resolve-categories-for-batch-by-ean';
import { fetchAllegroProduct } from '../util/fetch-allegro-product';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CachePort } from '@openlinker/shared';
import type { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import { toNeutralCategoryParameter } from '../mappers/allegro-category-parameter.mapper';
import type {
  AllegroOfferQuantityChangeCommandResponse,
  AllegroQuantityChangeCommandStatusResponse,
  AllegroCategoryParametersResponse,
  AllegroCategoriesResponse,
  AllegroCategoryByIdResponse,
  AllegroOfferParameter,
  AllegroOfferPublicationStatus,
  AllegroProductOffer,
  AllegroOffersResponse,
  AllegroOfferEventsResponse,
  AllegroOfferFieldsPatchBody,
  AllegroProductOfferCreateRequest,
  AllegroProductOfferCreateResponse,
  AllegroProductSetEntry,
  AllegroValidationError,
  AllegroShippingRatesResponse,
  AllegroReturnPoliciesResponse,
  AllegroWarrantiesResponse,
  AllegroImpliedWarrantiesResponse,
  AllegroSellerPolicyEntry,
  AllegroResponsibleProducerEntry,
  AllegroResponsibleProducersResponse,
  AllegroSmartOfferClassificationReport,
} from '../../domain/types/allegro-api.types';
import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import { Logger, formatBodyForLog } from '@openlinker/shared/logging';
import { createHash } from 'crypto';
import { sanitizeAllegroDescription } from '../util/sanitize-allegro-description';
import { sanitizeAllegroName } from '../util/sanitize-allegro-name';
import { uploadImagesViaAllegro } from '../util/upload-images-via-allegro';
import { uploadSafetyAttachmentViaAllegro } from '../util/upload-safety-attachment-via-allegro';
import type { AllegroQuantityCommandRepositoryPort } from '../../index';
import { AllegroQuantityCommand } from '../../index';

/** Adapter key registered for the Allegro marketplace integration. */
const ALLEGRO_ADAPTER_KEY = 'allegro.publicapi.v1';

/**
 * Allegro "Stan" (condition) parameter id and its dictionary value ids (#1500).
 * "Stan" is an offer-section parameter; the adapter owns this neutral → wire
 * mapping so core carries only the neutral `CreateOfferCommand.condition`. Value
 * ids are Allegro's stable global dictionary entries (`11323_1` = Nowy / new,
 * `11323_2` = Używany / used).
 */
const ALLEGRO_CONDITION_PARAMETER_ID = '11323';
const ALLEGRO_CONDITION_VALUE_IDS: Record<OfferCondition, string> = {
  new: '11323_1',
  used: '11323_2',
};

/** Default cache TTL (24h) for `/sale/categories/{id}/parameters` responses. */
const DEFAULT_CAT_PARAMS_TTL_SEC = 24 * 60 * 60;
/** Cache key prefix — global namespace; Allegro category schemas are public taxonomy. */
const CAT_PARAMS_CACHE_PREFIX = 'allegro:cat-params:';

/** Cache key prefix for resolved category breadcrumbs (`getCategoryPath`). */
const CAT_PATH_CACHE_PREFIX = 'allegro:cat-path:';

/**
 * Upper bound on the parent-walk in `getCategoryPath`. Allegro's real tree is
 * far shallower; the cap only guards against a malformed `parent.id` cycle so
 * the loop can never run unbounded.
 */
const CAT_PATH_MAX_DEPTH = 12;

/**
 * Variant key used when `matchCategoryByBarcode` delegates to the batch util
 * with a single-item input. Any stable string works — the result map is
 * consumed by one read in the same call.
 */
const SINGLE_ITEM_KEY = 'single';

/**
 * Defensive runtime check for the persisted `Connection.config.allegro
 * .sellerDefaults` blob. The TypeScript shape (`AllegroSellerDefaultsConfig`)
 * marks every sub-field non-optional, but the JSONB column can carry partial
 * shapes if the operator saved a half-completed wizard before #437 closed
 * the DTO bypass — and on the operator-experience side we still want to
 * surface a per-field "what's missing" list at offer-create time, not just
 * "configure seller defaults". Returns the dot-paths of every missing field;
 * empty result means the blob is structurally complete.
 */
function collectMissingSellerDefaultsFields(
  defaults: AllegroSellerDefaultsConfig | undefined
): string[] {
  if (!defaults) {
    return [
      'sellerDefaults.location',
      'sellerDefaults.responsibleProducerId',
      'sellerDefaults.safetyInformation',
    ];
  }
  const missing: string[] = [];
  const loc = defaults.location;
  if (!loc?.countryCode) missing.push('sellerDefaults.location.countryCode');
  if (!loc?.province) missing.push('sellerDefaults.location.province');
  if (!loc?.city) missing.push('sellerDefaults.location.city');
  if (!loc?.postCode) missing.push('sellerDefaults.location.postCode');
  if (!defaults.responsibleProducerId) {
    missing.push('sellerDefaults.responsibleProducerId');
  }
  const safety = defaults.safetyInformation;
  if (!safety?.type) {
    missing.push('sellerDefaults.safetyInformation.type');
  } else if (
    safety.type === 'TEXT' &&
    (typeof safety.description !== 'string' || safety.description.length === 0)
  ) {
    // Allegro accepts 1–5000 chars on `TEXT.description` (#445). The DTO
    // validator enforces the upper bound at save time; here we only catch
    // empty/missing description which would silently pass the type check.
    missing.push('sellerDefaults.safetyInformation.description');
  } else if (
    safety.type === 'ATTACHMENTS' &&
    (!Array.isArray(safety.attachments) || safety.attachments.length === 0)
  ) {
    missing.push('sellerDefaults.safetyInformation.attachments');
  }
  return missing;
}

/**
 * Polling configuration for Allegro async quantity change commands.
 *
 * Defaults: 5 attempts, 2s initial delay, 30s max delay, 2x backoff multiplier
 * (worst case ~62s total). Override via factory when ops need different tuning.
 */
export interface QuantityPollConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Allegro Offer Manager Adapter
 *
 * Shares the Allegro HTTP client + identifier-mapping instance with its
 * sibling `AllegroOrderSourceAdapter` through the per-connection factory.
 */
export class AllegroOfferManagerAdapter
  implements
    OfferManagerPort,
    OfferLister,
    OfferEventReader,
    OfferFieldUpdater,
    CategoryBrowser,
    CategoryPathReader,
    CategoryBarcodeMatcher,
    EanCategoryMatcher,
    CategoryParametersReader,
    CatalogProductReader,
    OfferCreator,
    OfferStatusReader,
    OfferSmartClassificationReader,
    OfferReader,
    SellerPoliciesReader,
    ResponsibleProducerReader,
    SafetyAttachmentUploader
{
  private readonly logger = new Logger(AllegroOfferManagerAdapter.name);

  private readonly quantityPollConfig: QuantityPollConfig;
  private readonly catParamsTtlSec: number;

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IAllegroHttpClient,
    /**
     * Sibling HTTP client pointed at `upload.allegro.pl[.allegrosandbox.pl]`.
     * Allegro's image-binary endpoint lives on a different host from the
     * rest of the API; the factory builds both clients with shared token
     * state (see `AllegroAdapterFactory`).
     */
    private readonly uploadHttpClient: IAllegroHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    _connection: Connection,
    private readonly commandRepository?: AllegroQuantityCommandRepositoryPort,
    quantityPollConfig?: Partial<QuantityPollConfig>,
    /**
     * Optional distributed cache for `/sale/categories/{id}/parameters`
     * responses. When omitted, every fetch hits Allegro — acceptable for
     * unit tests but not production. The factory injects a `RedisCacheAdapter`
     * via `CACHE_PORT_TOKEN` in real wiring.
     */
    private readonly cache?: CachePort,
    catParamsTtlSec?: number,
    /**
     * Connection-level seller defaults — `location` (every offer),
     * `responsibleProducerId` and `safetyInformation` (inline-product path).
     * Sourced from `Connection.config.allegro.sellerDefaults` by
     * `AllegroAdapterFactory`. When undefined, `createOffer` throws
     * `OfferCreateRejectedException` with code
     * `SELLER_DEFAULTS_NOT_CONFIGURED` rather than silently producing a
     * partial body Allegro will 422 on (#430).
     */
    private readonly sellerDefaults?: AllegroSellerDefaultsConfig,
    /**
     * Storefront base URL used to derive the public buyer-facing offer URL
     * for `getOffer` (#464) — the Allegro web host, resolved per environment by
     * `getAllegroWebBaseUrl` in the adapter factory. When undefined, `getOffer`
     * omits `marketplaceUrl` from its result.
     */
    private readonly storefrontBaseUrl?: string
  ) {
    this.quantityPollConfig = {
      maxAttempts: quantityPollConfig?.maxAttempts ?? 5,
      initialDelayMs: quantityPollConfig?.initialDelayMs ?? 2000,
      maxDelayMs: quantityPollConfig?.maxDelayMs ?? 30000,
      backoffMultiplier: quantityPollConfig?.backoffMultiplier ?? 2,
    };
    this.catParamsTtlSec = catParamsTtlSec ?? DEFAULT_CAT_PARAMS_TTL_SEC;
    void _connection;
  }

  /**
   * List incremental marketplace offer events (Allegro).
   *
   * Uses Allegro offer events journal with cursor-based pagination.
   */
  async listOfferEvents(input: OfferFeedInput): Promise<OfferFeedOutput> {
    this.logger.debug(
      `Listing Allegro offer events (connection: ${this.connectionId}, fromCursor: ${input.cursor || 'none'}, limit: ${input.limit})`
    );

    try {
      const queryParams: Record<string, string | number> = {};
      if (input.cursor) {
        queryParams.from = input.cursor;
      }
      queryParams.limit = input.limit;

      const response = await this.httpClient.get<AllegroOfferEventsResponse>('/sale/offer-events', {
        queryParams,
      });

      const events = response.data.offerEvents || [];
      const nextCursor =
        response.data.lastEventId ||
        (events.length > 0 ? events[events.length - 1]?.id : input.cursor || null);

      this.logger.debug(
        `Fetched ${events.length} offer events (connection: ${this.connectionId}, nextCursor: ${nextCursor || 'none'})`
      );

      const eventMap = new Map<string, (typeof events)[number]>();
      for (const event of events) {
        eventMap.set(event.offer.id, event);
      }

      const offers = Array.from(eventMap.values()).map((event) => ({
        id: event.offer.id,
        external: event.offer.external?.id ? { id: event.offer.external.id } : undefined,
      }));

      return {
        items: await this.buildOfferFeedItems(offers),
        nextCursor,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list Allegro offer events (connection: ${this.connectionId}): ${(error as Error).message}`,
        error
      );
      throw error;
    }
  }

  /**
   * List marketplace offers (Allegro).
   *
   * Uses offset-based pagination. Cursor is treated as an opaque offset string.
   */
  async listOffers(input: OfferFeedInput): Promise<OfferFeedOutput> {
    const offset = this.parseOffset(input.cursor);

    this.logger.debug(
      `Listing Allegro offers (connection: ${this.connectionId}, offset: ${offset}, limit: ${input.limit})`
    );

    try {
      const response = await this.httpClient.get<AllegroOffersResponse>('/sale/offers', {
        queryParams: {
          limit: input.limit,
          offset,
        },
      });

      const offers = response.data.offers ?? [];
      this.logger.debug(
        `Received Allegro offers (connection: ${this.connectionId}, offers: ${offers.length}, total: ${response.data.totalCount})`
      );
      const nextOffset = offset + offers.length;
      const nextCursor = nextOffset < response.data.totalCount ? String(nextOffset) : null;

      return {
        items: await this.buildOfferFeedItems(offers),
        nextCursor,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list Allegro offers (connection: ${this.connectionId}): ${(error as Error).message}`,
        error
      );
      throw error;
    }
  }

  /**
   * Update marketplace offer quantity.
   *
   * Issues an Allegro offer quantity change command. Uses idempotency key
   * to derive a deterministic commandId for deduplication.
   */
  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    if (!cmd.idempotencyKey) {
      throw new Error('idempotencyKey is required for Allegro offer quantity updates');
    }

    this.logger.debug(
      `Updating Allegro offer quantity: offerId=${cmd.offerId}, quantity=${cmd.quantity} (connection: ${this.connectionId}, idempotencyKey: ${cmd.idempotencyKey})`
    );

    try {
      const commandId = this.generateCommandIdFromIdempotencyKey(cmd.idempotencyKey);

      // PUT /sale/offer-quantity-change-commands/{id} is the BATCH modification
      // resource — the payload is modification + offerCriteria (CONTAINS_OFFERS
      // with a single offer id), not a flat offerId/quantityChange pair; the
      // latter 422s with "modification: musi być podane".
      const commandBody: Record<string, unknown> = {
        modification: {
          changeType: 'FIXED',
          value: cmd.quantity,
        },
        offerCriteria: [
          {
            offers: [{ id: cmd.offerId }],
            type: 'CONTAINS_OFFERS',
          },
        ],
      };

      const response = await this.httpClient.put<AllegroOfferQuantityChangeCommandResponse>(
        `/sale/offer-quantity-change-commands/${commandId}`,
        commandBody
      );

      try {
        if (this.commandRepository) {
          const status = this.mapAllegroCommandStatus(response.data.status);
          const command = AllegroQuantityCommand.create(
            response.data.id,
            this.connectionId,
            cmd.offerId,
            cmd.quantity,
            status
          );
          await this.commandRepository.create(command);
        }
      } catch (persistError) {
        this.logger.warn(
          `Failed to persist offer quantity command status (commandId: ${response.data.id}): ${(persistError as Error).message}`
        );
      }

      this.logger.debug(
        `Allegro offer quantity command submitted: commandId=${response.data.id} (connection: ${this.connectionId})`
      );

      await this.pollAndUpdateCommandStatus(response.data.id, cmd.offerId);
    } catch (error) {
      this.logger.error(
        `Failed to update Allegro offer quantity (offerId: ${cmd.offerId}, connection: ${this.connectionId}): ${(error as Error).message}`,
        error
      );
      throw error;
    }
  }

  /**
   * Generate deterministic commandId from idempotency key.
   *
   * Allegro requires commandId to be a UUID. We generate a deterministic UUID
   * from the idempotency key using SHA-256 hash and format as UUID v4.
   */
  private generateCommandIdFromIdempotencyKey(idempotencyKey: string): string {
    const hash = createHash('sha256').update(idempotencyKey).digest('hex');
    return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(12, 15)}-${((parseInt(hash.substring(15, 16), 16) & 0x3) | 0x8).toString(16)}${hash.substring(16, 19)}-${hash.substring(19, 31)}`;
  }

  private parseOffset(cursor?: string | null): number {
    if (!cursor) {
      return 0;
    }
    const parsed = Number.parseInt(cursor, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  private async buildOfferFeedItems(
    offers: AllegroOffersResponse['offers']
  ): Promise<OfferFeedOutput['items']> {
    const items: OfferFeedOutput['items'] = [];

    for (const offer of offers) {
      if (await this.isOfferMapped(offer.id)) {
        this.logger.debug(
          `Skipping Allegro offer ${offer.id} (connection: ${this.connectionId}) - already mapped`
        );
        continue;
      }

      try {
        const identifiers = await this.fetchOfferIdentifiers(offer.id, offer.category?.id);
        items.push({
          offerId: offer.id,
          externalRef: offer.external?.id ?? null,
          sku: identifiers.sku,
          ean: identifiers.ean,
          gtin: identifiers.gtin,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to resolve identifiers for offer ${offer.id} (connection: ${this.connectionId}): ${(error as Error).message}`
        );
        items.push({
          offerId: offer.id,
          externalRef: offer.external?.id ?? null,
        });
      }
    }

    return items;
  }

  private async isOfferMapped(offerId: string): Promise<boolean> {
    try {
      const internalId = await this.identifierMapping.getInternalId(
        CORE_ENTITY_TYPE.Offer,
        offerId,
        this.connectionId
      );
      return internalId !== null;
    } catch (error) {
      this.logger.warn(
        `Failed to check existing offer mapping for ${offerId} (connection: ${this.connectionId}): ${(error as Error).message}`
      );
      return false;
    }
  }

  /**
   * Single source of truth for `GET /sale/product-offers/{id}`. Both
   * `fetchOfferIdentifiers` (sync linking) and `getOfferStatus` (creation
   * poller, #447) call this so they stay in lock-step on transport, headers,
   * and exception shape.
   */
  private async fetchProductOfferById(offerId: string): Promise<AllegroProductOffer> {
    const response = await this.httpClient.get<AllegroProductOffer>(
      `/sale/product-offers/${offerId}`
    );
    return response.data;
  }

  private async fetchOfferIdentifiers(
    offerId: string,
    categoryId?: string
  ): Promise<{ sku: string | null; ean: string | null; gtin: string | null }> {
    const offer = await this.fetchProductOfferById(offerId);
    const resolvedCategoryId = categoryId ?? offer.category?.id ?? null;

    let eanIds: Set<string> = new Set();
    let gtinIds: Set<string> = new Set();

    if (resolvedCategoryId) {
      const categoryParams = await this.fetchCategoryParametersRaw(resolvedCategoryId);
      const { eanIds: resolvedEanIds, gtinIds: resolvedGtinIds } = this.findIdentifierParameterIds(
        categoryParams.parameters
      );
      eanIds = resolvedEanIds;
      gtinIds = resolvedGtinIds;
    }

    const offerParams = offer.parameters ?? [];
    const productParams = offer.productSet?.flatMap((item) => item.product?.parameters ?? []) ?? [];
    const allParams = [...offerParams, ...productParams];

    const eanValues = this.extractIdentifierValues(allParams, eanIds, /ean/i);
    const gtinValues = this.extractIdentifierValues(allParams, gtinIds, /gtin/i);

    return {
      sku: null,
      ean: this.pickSingleValue(eanValues),
      gtin: this.pickSingleValue(gtinValues),
    };
  }

  /**
   * `OfferStatusReader.getOfferStatus` — neutral read of the marketplace-side
   * publication state of an existing offer. Used by `OfferStatusPollService`
   * (#447) to follow up on creates that returned with Allegro still in
   * async-validation (`publication.status: ACTIVATING`).
   *
   * Maps Allegro's UPPERCASE publication.status enum onto the lowercase
   * neutral `OfferPublicationStatus` union; faithful translation — no
   * lifecycle decisions taken here. A 404 from `GET /sale/product-offers/{id}`
   * surfaces as `OfferNotFoundOnMarketplaceException` so the service can map
   * to a terminal `'failed'` record state. Other transport errors propagate.
   */
  async getOfferStatus(externalOfferId: string): Promise<OfferStatusReadResult> {
    let offer: AllegroProductOffer;
    try {
      offer = await this.fetchProductOfferById(externalOfferId);
    } catch (err) {
      if (err instanceof AllegroApiException && err.statusCode === 404) {
        throw new OfferNotFoundOnMarketplaceException(externalOfferId, this.connectionId);
      }
      throw err;
    }

    const rawStatus = offer.publication?.status;
    if (!rawStatus) {
      // Allegro returned the offer but without a publication block. Treat as
      // `'inactive'` (offer exists but is in an unspecified non-live state) —
      // the service maps `inactive + no errors` to `'draft'`, which matches
      // the practical "offer exists, isn't live yet" semantic.
      this.logger.warn(
        `Allegro offer ${externalOfferId} returned without publication.status — treating as 'inactive'. connection=${this.connectionId}`
      );
    }

    const publicationStatus = this.mapAllegroPublicationStatus(rawStatus);
    const validationErrors = this.mapValidationErrors(offer.validation?.errors ?? []);

    return { publicationStatus, validationErrors };
  }

  /**
   * `OfferSmartClassificationReader.getOfferSmartClassification` (#737) —
   * fetch the Allegro Smart! classification for a single offer.
   *
   * 404 collapses to `null` (Allegro hasn't yet classified the offer — most
   * commonly because the offer is fresh from create-offer and pre-validation).
   * Every other error propagates so the caller can decide how to degrade —
   * the bulk-flow handler + poll-service hook catch + log + persist null
   * per AC-7 (Smart readback must not fail the offer-creation job).
   */
  async getOfferSmartClassification(
    externalOfferId: string
  ): Promise<SmartClassificationReport | null> {
    try {
      const response = await this.httpClient.get<AllegroSmartOfferClassificationReport>(
        `/sale/offers/${externalOfferId}/smart`
      );
      return this.mapSmartClassificationReport(response.data);
    } catch (err) {
      if (err instanceof AllegroApiException && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  private mapSmartClassificationReport(
    raw: AllegroSmartOfferClassificationReport
  ): SmartClassificationReport {
    return {
      fulfilled: raw.classification?.fulfilled ?? null,
      conditions: (raw.conditions ?? []).map((c) => ({
        code: c.code,
        name: c.name,
        description: c.description,
        fulfilled: c.fulfilled,
      })),
      scheduledForReclassification: raw.scheduledForReclassification,
    };
  }

  private mapAllegroPublicationStatus(
    raw: AllegroOfferPublicationStatus | undefined
  ): OfferPublicationStatus {
    switch (raw) {
      case 'ACTIVE':
        return 'active';
      case 'ACTIVATING':
        return 'activating';
      case 'INACTIVATING':
        return 'inactivating';
      case 'INACTIVE':
        return 'inactive';
      case 'ENDED':
        return 'ended';
      default:
        // No status → treat as inactive (see comment in caller). Defensive
        // default also covers any unrecognised future Allegro state.
        return 'inactive';
    }
  }

  /**
   * Fetch a single offer's live state (#464 — `OfferReader`).
   *
   * Same endpoint as `fetchOfferIdentifiers` and `getOfferStatus` (#447) —
   * goes through the shared `fetchProductOfferById` helper to keep transport,
   * headers, and exception handling in lock-step. Maps Allegro's native shape
   * into the neutral `MarketplaceOffer` DTO consumed by the listing-detail
   * page. Sparse upstream fields (missing description / images / category
   * name / endsAt) cleanly degrade to `undefined` on the result.
   */
  async getOffer(input: { externalId: string }): Promise<MarketplaceOffer> {
    const { externalId } = input;
    this.logger.debug(
      `Fetching Allegro offer detail: connection=${this.connectionId} offerId=${externalId}`
    );

    const offer = await this.fetchProductOfferById(externalId);

    const price = offer.sellingMode?.price;
    if (!price) {
      // Allegro consistently returns sellingMode.price for every active or
      // ended offer; missing it indicates a malformed payload, not a sparse
      // legitimate response. Throw so the controller's existing error mapping
      // surfaces a 502 instead of silently returning a half-formed DTO.
      throw new AllegroApiException(
        `Allegro offer ${externalId} response missing sellingMode.price`,
        undefined,
        formatBodyForLog(JSON.stringify(offer))
      );
    }

    return {
      externalId: offer.id,
      title: offer.name ?? '',
      description: this.extractOfferDescription(offer),
      imageUrl: offer.images?.[0]?.url,
      price: { amount: price.amount, currency: price.currency },
      availableQuantity: offer.stock?.available ?? 0,
      status: offer.publication?.status ?? 'UNKNOWN',
      category: offer.category ? { id: offer.category.id } : undefined,
      marketplaceUrl: this.buildMarketplaceUrl(offer.id),
      endsAt: offer.publication?.endingAt,
      parameters: this.mapOfferParameters(offer),
      productSet: this.mapOfferProductSet(offer),
    };
  }

  /**
   * Collect the offer's filled parameter values into the neutral shape
   * (#1482). Offer-section values come from `offer.parameters`; product-
   * section values (Brand, Model, manufacturer code, ...) come from each
   * `productSet[].product.parameters` - both already present on the
   * `GET /sale/product-offers/{offerId}` response, so no extra API call.
   * Returns undefined when the response carries no parameter data at all,
   * keeping the previous DTO shape for sparse offers.
   */
  private mapOfferParameters(offer: AllegroProductOffer): MarketplaceOfferParameter[] | undefined {
    const mapped: MarketplaceOfferParameter[] = [];
    for (const parameter of offer.parameters ?? []) {
      mapped.push(this.toMarketplaceOfferParameter(parameter, 'offer'));
    }
    for (const entry of offer.productSet ?? []) {
      for (const parameter of entry.product?.parameters ?? []) {
        mapped.push(this.toMarketplaceOfferParameter(parameter, 'product'));
      }
    }
    return mapped.length > 0 ? mapped : undefined;
  }

  private toMarketplaceOfferParameter(
    parameter: AllegroOfferParameter,
    section: CategoryParameterSection
  ): MarketplaceOfferParameter {
    return {
      id: parameter.id,
      name: parameter.name,
      values: parameter.values ?? [],
      valuesIds: parameter.valuesIds,
      rangeValue: parameter.rangeValue
        ? { from: parameter.rangeValue.from, to: parameter.rangeValue.to }
        : undefined,
      section,
    };
  }

  /**
   * Map `productSet[]` into the neutral catalog-linkage shape (#1482).
   * `product.id` is only present on smart-linked entries (inline products
   * carry no card id); `quantity.value` is Allegro's per-item unit count.
   * Returns undefined when the offer has no product set so adapters without
   * catalog linkage keep the previous shape.
   */
  private mapOfferProductSet(
    offer: AllegroProductOffer
  ): MarketplaceOfferProductSetItem[] | undefined {
    const entries = offer.productSet ?? [];
    if (entries.length === 0) {
      return undefined;
    }
    return entries.map((entry) => ({
      productId: entry.product?.id,
      quantity: entry.quantity?.value,
    }));
  }

  /**
   * Flatten Allegro's structured `description.sections[].items[]` into a
   * single string suitable for FE preview rendering. Items of type `'TEXT'`
   * (or unspecified) contribute their `content`; image items are dropped —
   * the listing-detail surface shows the primary image separately. Returns
   * undefined when there's nothing renderable so the FE can omit the
   * description preview entirely.
   */
  private extractOfferDescription(offer: AllegroProductOffer): string | undefined {
    const sections = offer.description?.sections ?? [];
    const parts: string[] = [];
    for (const section of sections) {
      for (const item of section.items ?? []) {
        if (item.content && (item.type === undefined || item.type === 'TEXT')) {
          parts.push(item.content);
        }
      }
    }
    if (parts.length === 0) {
      return undefined;
    }
    return parts.join('\n\n');
  }

  /**
   * Build the public buyer-facing offer URL. Allegro's storefront and API
   * hosts differ between sandbox and production; the factory passes the
   * right storefront base via the constructor. When unset (legacy callers,
   * tests), omit the URL — the FE renders no link rather than a wrong one.
   */
  private buildMarketplaceUrl(offerId: string): string | undefined {
    if (!this.storefrontBaseUrl) {
      return undefined;
    }
    return `${this.storefrontBaseUrl.replace(/\/+$/, '')}/oferta/${offerId}`;
  }

  /**
   * Raw, uncached fetch of `/sale/categories/{id}/parameters`. Returns Allegro's
   * native shape verbatim. Single source of truth for the HTTP call —
   * `fetchOfferIdentifiers` and `fetchCategoryParameters` (cached + neutral)
   * both delegate here. Public so dev tooling can capture fixtures.
   */
  async fetchCategoryParametersRaw(categoryId: string): Promise<AllegroCategoryParametersResponse> {
    this.logger.debug(
      `Fetching Allegro category parameters (raw): connection=${this.connectionId} categoryId=${categoryId}`
    );
    const response = await this.httpClient.get<AllegroCategoryParametersResponse>(
      `/sale/categories/${categoryId}/parameters`
    );
    return response.data;
  }

  /**
   * Cached, neutral-shape fetch of category parameters for the create-offer
   * wizard (#410). Implements `CategoryParametersReader`.
   *
   * Cache: global key `allegro:cat-params:{categoryId}` (Allegro category
   * schemas are public taxonomy and identical for every seller). TTL defaults
   * to 24h; override via constructor `catParamsTtlSec` (env-driven from the
   * adapter factory).
   *
   * 404 from Allegro maps to the neutral `CategoryNotFoundException`; other
   * upstream errors propagate as-is so the existing `IntegrationError` chain
   * keeps working.
   */
  async fetchCategoryParameters(input: { categoryId: string }): Promise<CategoryParameter[]> {
    const cacheKey = `${CAT_PARAMS_CACHE_PREFIX}${input.categoryId}`;

    if (this.cache) {
      const cached = await this.cache.get<CategoryParameter[]>(cacheKey);
      if (cached) {
        this.logger.debug(
          `Category parameters cache HIT: connection=${this.connectionId} categoryId=${input.categoryId}`
        );
        return cached;
      }
    }

    let raw: AllegroCategoryParametersResponse;
    try {
      raw = await this.fetchCategoryParametersRaw(input.categoryId);
    } catch (err) {
      if (err instanceof AllegroApiException && err.statusCode === 404) {
        throw new CategoryNotFoundException(input.categoryId, 'allegro');
      }
      throw err;
    }

    const neutral = (raw.parameters ?? []).map(toNeutralCategoryParameter);

    if (this.cache) {
      await this.cache.set(cacheKey, neutral, this.catParamsTtlSec);
    }

    return neutral;
  }

  async fetchCategories(parentId?: string): Promise<OfferCategory[]> {
    this.logger.debug(
      `Fetching Allegro categories (connection: ${this.connectionId}, parentId: ${parentId ?? 'root'})`
    );
    const queryParams: Record<string, string | number> = {};
    if (parentId) {
      queryParams['parent.id'] = parentId;
    }
    const response = await this.httpClient.get<AllegroCategoriesResponse>('/sale/categories', {
      queryParams,
    });
    const categories = response.data.categories ?? [];
    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      parentId: cat.parent?.id ?? null,
      leaf: cat.leaf,
    }));
  }

  /**
   * CategoryPathReader.getCategoryPath (#1741).
   *
   * Resolve a category id to its ROOT -> LEAF breadcrumb by walking up the
   * parent chain. Allegro's `GET /sale/categories/{id}` returns the node with
   * only `parent.id` (no ancestor names), so we issue one call per level and
   * prepend each node, stopping when a node has no parent (root) or the depth
   * cap is hit (malformed-data guard).
   *
   * The resolved path is cached under a global key (`allegro:cat-path:{id}`),
   * reusing the same distributed cache + TTL as `/sale/categories/{id}/
   * parameters` - the taxonomy is public and identical for every seller.
   *
   * A 404 on the queried id (or any ancestor) collapses to an empty array
   * rather than throwing: the caller (bulk-wizard chip) degrades to the raw
   * id, so a missing breadcrumb must never break the flow.
   */
  async getCategoryPath(categoryId: string): Promise<CategoryPathNode[]> {
    const cacheKey = `${CAT_PATH_CACHE_PREFIX}${categoryId}`;

    if (this.cache) {
      const cached = await this.cache.get<CategoryPathNode[]>(cacheKey);
      if (cached) {
        this.logger.debug(
          `Category path cache HIT: connection=${this.connectionId} categoryId=${categoryId}`
        );
        return cached;
      }
    }

    const path: CategoryPathNode[] = [];
    let currentId: string | null = categoryId;

    for (let depth = 0; currentId && depth < CAT_PATH_MAX_DEPTH; depth += 1) {
      let node: AllegroCategoryByIdResponse;
      try {
        const response = await this.httpClient.get<AllegroCategoryByIdResponse>(
          `/sale/categories/${currentId}`
        );
        node = response.data;
      } catch (err) {
        if (err instanceof AllegroApiException && err.statusCode === 404) {
          this.logger.warn(
            `Category path walk hit 404: connection=${this.connectionId} categoryId=${currentId}`
          );
          return [];
        }
        throw err;
      }

      // Prepend so the accumulated array stays ROOT -> LEAF as we climb.
      path.unshift({ id: node.id, name: node.name });
      currentId = node.parent?.id ?? null;
    }

    if (this.cache) {
      await this.cache.set(cacheKey, path, this.catParamsTtlSec);
    }

    return path;
  }

  async matchCategoryByBarcode(barcode: string): Promise<string | null> {
    // Delegates to the shared #735 batch util so single-call and batch paths
    // share the `/sale/products?phrase=…&mode=GTIN` endpoint, cache namespace,
    // and exact-GTIN match logic. The util is no-throw — HTTP failures
    // collapse to `no-match`, surfaced at the public boundary as `null`.
    const results = await resolveCategoriesForBatchByEan(
      this.httpClient,
      this.cache,
      this.connectionId,
      { items: [{ variantId: SINGLE_ITEM_KEY, ean: barcode }] }
    );
    const outcome = results.get(SINGLE_ITEM_KEY);
    if (outcome?.kind === 'matched') {
      this.logger.debug(
        `Barcode auto-detect matched category ${outcome.allegroCategoryId} (connection: ${this.connectionId})`
      );
      return outcome.allegroCategoryId;
    }
    return null;
  }

  /**
   * EanCategoryMatcher.resolveCategoriesForBatchByEan (#735).
   *
   * Thin delegate to the `resolveCategoriesForBatchByEan` util — keeps stateful
   * HTTP + cache logic in the util layer (mirrors the #431 pattern). The util
   * is no-throw: HTTP failures collapse to `{ kind: 'no-match' }`, cache
   * outages are logged-and-bypassed, the batch never aborts on per-item
   * failure.
   */
  async resolveCategoriesForBatchByEan(
    input: BatchCategoryByEanInput
  ): Promise<Map<string, EanMatchResult>> {
    return resolveCategoriesForBatchByEan(this.httpClient, this.cache, this.connectionId, input);
  }

  /**
   * CatalogProductReader.findProductsByBarcode (#633).
   *
   * Reuses `resolveAllegroProductCardByEan` — the same util the offer-create
   * smart-link path uses — so a single Allegro `/sale/products?phrase` lookup
   * is cached and shared between submit-time linking and wizard-time prefill.
   *
   * Contract: `categoryId` is optional on the port input, but Allegro's
   * matcher requires it (the underlying resolver scopes by category). When
   * omitted we return `no_match` rather than performing a category-less
   * search — same contract as documented on `FindProductsByBarcodeInput`.
   *
   * Outcome mapping:
   * - `unique` → eager-fetch the full detail via `fetchAllegroProduct` so
   *   the FE can prefill product-section parameters in one round-trip.
   * - `ambiguous` → return summaries (id/name/ean only; image URLs are not
   *   available in Allegro's `/sale/products?phrase` summary response).
   * - `no_match` → identity mapping.
   */
  async findProductsByBarcode(
    input: FindProductsByBarcodeInput
  ): Promise<CatalogProductMatchResult> {
    if (!input.categoryId) {
      this.logger.debug(
        `findProductsByBarcode: categoryId omitted, returning no_match (connection: ${this.connectionId}, barcode: ${input.barcode})`
      );
      return { kind: 'no_match' };
    }

    const result: ResolveProductCardResult = await resolveAllegroProductCardByEan(
      this.httpClient,
      this.cache,
      { ean: input.barcode, categoryId: input.categoryId }
    );

    if (result.kind === 'unique') {
      const product = await fetchAllegroProduct(this.httpClient, this.cache, result.productId);
      return { kind: 'unique', product };
    }
    if (result.kind === 'ambiguous') {
      const products: CatalogProductSummary[] = result.matches.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        ean: m.ean,
        // imageUrl intentionally omitted — Allegro's /sale/products?phrase
        // summary response does not carry image URLs. The FE picker renders
        // text-only options until the operator picks one (which triggers
        // getProduct and surfaces the thumbnail in the linked-state panel).
      }));
      return { kind: 'ambiguous', products };
    }
    return { kind: 'no_match' };
  }

  /**
   * CatalogProductReader.getProduct (#633).
   *
   * Thin wrapper over `fetchAllegroProduct` so the controller doesn't import
   * the util directly. Throws `CatalogProductNotFoundException` on Allegro
   * 404 (controller maps to 404); other HTTP failures bubble as
   * `AllegroApiException`.
   */
  async getProduct(input: { productId: string }): Promise<CatalogProduct> {
    return fetchAllegroProduct(this.httpClient, this.cache, input.productId);
  }

  private findIdentifierParameterIds(parameters: Array<{ id: string; name: string }>): {
    eanIds: Set<string>;
    gtinIds: Set<string>;
  } {
    const eanIds = new Set<string>();
    const gtinIds = new Set<string>();

    for (const param of parameters) {
      const name = param.name.toLowerCase();
      if (name.includes('ean')) {
        eanIds.add(param.id);
      }
      if (name.includes('gtin')) {
        gtinIds.add(param.id);
      }
    }

    return { eanIds, gtinIds };
  }

  private extractIdentifierValues(
    parameters: AllegroOfferParameter[],
    idFilter: Set<string>,
    nameMatcher: RegExp
  ): string[] {
    const values: string[] = [];

    for (const param of parameters) {
      const matchesId = idFilter.size > 0 && idFilter.has(param.id);
      const matchesName = idFilter.size === 0 && !!param.name && nameMatcher.test(param.name);

      if (!matchesId && !matchesName) {
        continue;
      }

      for (const value of param.values ?? []) {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          values.push(trimmed);
        }
      }
    }

    return values;
  }

  private pickSingleValue(values: string[]): string | null {
    const unique = Array.from(new Set(values));
    if (unique.length !== 1) {
      return null;
    }
    return unique[0];
  }

  /**
   * Map Allegro command status to unified status.
   */
  private mapAllegroCommandStatus(
    allegroStatus: 'QUEUED' | 'ACCEPTED' | 'REJECTED'
  ): 'queued' | 'accepted' | 'rejected' {
    switch (allegroStatus) {
      case 'QUEUED':
        return 'queued';
      case 'ACCEPTED':
        return 'accepted';
      case 'REJECTED':
        return 'rejected';
      default: {
        const status = allegroStatus as string;
        this.logger.warn(`Unknown Allegro command status: ${status}, defaulting to 'queued'`);
        return 'queued';
      }
    }
  }

  /**
   * Update offer fields (price, title, description) via Allegro PATCH.
   *
   * Partial update semantics: only fields present in cmd.fields are included
   * in the Allegro request payload. Uses PATCH /sale/product-offers/{offerId}.
   *
   * #487 — Allegro re-validates the whole offer on every PATCH. A description-
   * only update will 422 if the offer happens to be missing required fields
   * that live on `Connection.config.allegro.sellerDefaults` (GPSR
   * `responsibleProducer` / `safetyInformation`, ship-from `location`). When
   * `sellerDefaults` is configured, we opportunistically merge those into the
   * PATCH body via `buildSellerDefaultsPatch`. Caller-supplied fields always
   * win on overlap. The empty-fields guard runs *before* backfill so today's
   * "empty fields → no HTTP call" semantics are preserved (we don't grow a
   * new "republish-with-defaults" surface).
   */
  async updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<void> {
    this.logger.debug(
      `Updating Allegro offer fields: offerId=${cmd.externalOfferId} (connection: ${this.connectionId}, fields=${Object.keys(cmd.fields).join(',')})`
    );

    const callerBody: AllegroOfferFieldsPatchBody = {};

    if (cmd.fields.price !== undefined) {
      callerBody.sellingMode = {
        price: {
          amount: cmd.fields.price.amount,
          currency: cmd.fields.price.currency,
        },
      };
    }

    if (cmd.fields.title !== undefined) {
      // #420 — same Allegro name validator as POST; sanitize operator-typed
      // titles on PATCH too so title edits are subject to the same gate.
      const sanitized = sanitizeAllegroName(cmd.fields.title);
      if (sanitized !== cmd.fields.title) {
        this.logger.debug(
          `Allegro name sanitized on offer update: offerId=${cmd.externalOfferId} ` +
            `connection=${this.connectionId} ` +
            `original=${JSON.stringify(cmd.fields.title)} sanitized=${JSON.stringify(sanitized)}`
        );
      }
      callerBody.name = sanitized;
    }

    if (cmd.fields.description !== undefined) {
      callerBody.description = {
        sections: cmd.fields.description.sections.map((section) => ({
          items: section.items.map((item) => ({
            type: item.type,
            content: sanitizeAllegroDescription(item.content),
          })),
        })),
      };
    }

    if (Object.keys(callerBody).length === 0) {
      this.logger.warn(
        `updateOfferFields called with empty fields for offerId=${cmd.externalOfferId} — skipping`
      );
      return;
    }

    // #487 — opportunistic seller-defaults backfill (see method JSDoc).
    const { patch: defaultsPatch, fields: backfilled } = this.buildSellerDefaultsPatch();
    const body: AllegroOfferFieldsPatchBody = { ...defaultsPatch, ...callerBody };
    if (backfilled.length > 0) {
      this.logger.debug(
        `Allegro updateOfferFields backfilled from sellerDefaults: ` +
          `offerId=${cmd.externalOfferId} connection=${this.connectionId} ` +
          `fields=[${backfilled.join(',')}]`
      );
    }

    try {
      await this.httpClient.patch<void>(`/sale/product-offers/${cmd.externalOfferId}`, body);

      this.logger.debug(
        `Allegro offer fields updated: offerId=${cmd.externalOfferId} (connection: ${this.connectionId})`
      );
    } catch (error) {
      this.logger.error(
        `Failed to update Allegro offer fields (offerId: ${cmd.externalOfferId}, connection: ${this.connectionId}): ${(error as Error).message}`,
        error
      );
      throw error;
    }
  }

  /**
   * Build the slice of `AllegroOfferFieldsPatchBody` that the connection's
   * `sellerDefaults` is willing to provide on PATCH. Each subfield is
   * independently gated — partial configurations still help (the create-time
   * preflight `collectMissingSellerDefaultsFields` is the all-or-nothing gate).
   * Returns `{ patch: {}, fields: [] }` when `sellerDefaults` is undefined.
   *
   * GPSR fields sit at `productSet[0].responsibleProducer` and
   * `productSet[0].safetyInformation` — entry-level siblings — to mirror the
   * working create path (`applyPlatformParams` below). The wire shape is what
   * Allegro accepts on POST, and we expect the same shape on partial product-
   * set updates; sandbox verification is the AC closer (#487).
   *
   * After-sales backfill (`afterSalesServices.{returnPolicy,warranty,
   * impliedWarranty}`) is intentionally not populated here. Those policy ids
   * currently flow through `cmd.overrides.platformParams` per offer
   * (`CreateOfferWizard.tsx`) and are not persisted on
   * `AllegroSellerDefaultsConfig`. When connection-level storage for them
   * lands, this helper grows a third branch — single-field, single-branch
   * extension. Until then, the type slot on `AllegroOfferFieldsPatchBody`
   * exists for forward-compatibility.
   */
  private buildSellerDefaultsPatch(): {
    patch: Pick<AllegroOfferFieldsPatchBody, 'location' | 'productSet'>;
    fields: string[];
  } {
    if (!this.sellerDefaults) {
      return { patch: {}, fields: [] };
    }
    const patch: Pick<AllegroOfferFieldsPatchBody, 'location' | 'productSet'> = {};
    const fields: string[] = [];

    if (this.sellerDefaults.location) {
      patch.location = { ...this.sellerDefaults.location };
      fields.push('location');
    }

    const productSetEntry: AllegroProductSetEntry = {};
    if (this.sellerDefaults.responsibleProducerId) {
      productSetEntry.responsibleProducer = {
        id: this.sellerDefaults.responsibleProducerId,
      };
      fields.push('productSet[0].responsibleProducer');
    }
    if (this.sellerDefaults.safetyInformation) {
      productSetEntry.safetyInformation = this.sellerDefaults.safetyInformation;
      fields.push('productSet[0].safetyInformation');
    }
    if (Object.keys(productSetEntry).length > 0) {
      patch.productSet = [productSetEntry];
    }

    return { patch, fields };
  }

  /**
   * Create a new Allegro offer (outbound OL → Allegro).
   *
   * Translates the neutral `CreateOfferCommand` into Allegro's
   * `POST /sale/product-offers` request. Platform-specific fields flow
   * through `cmd.overrides.platformParams`:
   * - `deliveryPolicyId` → `delivery.shippingRates.id`
   * - `handlingTime` → `delivery.handlingTime`
   * - `returnPolicyId` → `afterSalesServices.returnPolicy.id`
   * - `warrantyId` → `afterSalesServices.warranty.id`
   * - `impliedWarrantyId` → `afterSalesServices.impliedWarranty.id`
   * - `invoice` → `payments.invoice`
   * - `parameters` → passthrough to request `parameters`
   * Unknown keys are ignored.
   *
   * `external.id` precedence: `cmd.idempotencyKey ?? cmd.internalVariantId` —
   * callers set the idempotency key per creation attempt so retries get a
   * unique reference. Allegro's public API does not accept an `Idempotency-Key`
   * header, so this is the adapter's only use of `cmd.idempotencyKey`.
   *
   * Non-2xx responses with structured errors are translated to the neutral
   * `OfferCreateRejectedException` (the core-facing contract).
   * 2xx responses with inline validation errors are **not** thrown — the
   * offer exists as a draft on Allegro and the errors are surfaced through
   * `CreateOfferResult.validationErrors`.
   */
  async createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult> {
    // #430 / #437 — preflight: connection-level seller defaults must be
    // structurally complete before we can build a body Allegro will accept.
    // The check is field-by-field rather than a single `if (!this.sellerDefaults)`
    // because the persisted JSONB blob can carry a partial shape (the cause
    // of the 2026-04-29 sandbox repro: a saved config missing only
    // `responsibleProducerId` because the RP dropdown couldn't load).
    // Surface as the neutral `OfferCreateRejectedException` (one error per
    // missing field) — keeps the `core → integration` boundary clean.
    const missingDefaults = collectMissingSellerDefaultsFields(this.sellerDefaults);
    if (missingDefaults.length > 0) {
      throw new OfferCreateRejectedException(
        ALLEGRO_ADAPTER_KEY,
        0,
        missingDefaults.map((field) => ({
          field,
          code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
          message: `Allegro connection ${this.connectionId} is missing required seller-defaults field "${field}". Complete the seller-defaults section on the connection edit page (ship-from location, Responsible Producer, GPSR safety information) before creating offers.`,
        }))
      );
    }

    // #431 — smart-link pre-step. Compute once at the top so the body
    // builder + platform-params applier stay synchronous (their current
    // contract). On `unique`, `productSet[0]` becomes a card-link reference
    // and Allegro inherits GPSR + parameters from the card; otherwise we
    // fall through to inline (which uses the seller-defaults checked above).
    const cardLinkResult = await this.maybeResolveProductCard(cmd);

    const body = this.buildCreateOfferRequest(cmd, cardLinkResult);

    // Pre-step: re-host any operator image URLs onto Allegro's CDN. Allegro
    // resolves URLs in `images[]` server-side and rejects offer creation when
    // it can't fetch them — so for operators whose PS lives behind localhost,
    // private IPs, basic-auth, or hardened .htaccess, we proxy bytes via OL.
    // The util returns a result object (never throws for image failures); we
    // map it to the neutral `OfferCreateRejectedException` here, where the
    // adapter-key constant lives.
    if (body.images && body.images.length > 0) {
      const originalCount = body.images.length;
      this.logger.debug(
        `Allegro image upload starting: connection=${this.connectionId} count=${originalCount}`
      );
      const uploadResult = await uploadImagesViaAllegro(this.uploadHttpClient, body.images);
      if (!uploadResult.ok) {
        const codes = Array.from(new Set(uploadResult.failures.map((f) => f.code))).join(',');
        this.logger.warn(
          `Allegro image upload rejected create: connection=${this.connectionId} ` +
            `failed=${uploadResult.failures.length}/${originalCount} codes=${codes}`
        );
        throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, uploadResult.failures);
      }
      body.images = uploadResult.locations;
      this.logger.debug(
        `Allegro image upload complete: connection=${this.connectionId} count=${body.images.length}`
      );
    }

    // #419 — Allegro requires `productSet[0].product.images` (≥1) when
    // creating an inline product. Mirror the post-upload `body.images` here
    // (not in applyPlatformParams) so the URLs Allegro sees in the inline
    // product match the ones it just minted on its own CDN.
    //
    // Invariant: when `body.productSet` is present, it always has exactly
    // one entry with a populated `product` — see `applyPlatformParams`,
    // which is the only writer. The optional-chaining guard below is
    // belt-and-braces against future writers introducing a different shape.
    //
    // #431 — Smart-linked entries (`product.id` set) inherit images from
    // the existing Allegro product card; mirroring would write a sibling
    // `images` field that Allegro does not expect on the link path. Skip
    // when `product.id` is present.
    if (
      body.productSet?.[0]?.product &&
      body.productSet[0].product.id === undefined &&
      body.images &&
      body.images.length > 0
    ) {
      body.productSet[0].product.images = body.images;
    }

    this.logger.debug(
      `Creating Allegro offer: connection=${this.connectionId} externalRef=${body.external?.id ?? 'n/a'} publishImmediately=${cmd.publishImmediately}`
    );

    let response: AllegroProductOfferCreateResponse;
    try {
      const httpResponse = await this.httpClient.post<AllegroProductOfferCreateResponse>(
        '/sale/product-offers',
        body as unknown as Record<string, unknown>
      );
      response = httpResponse.data;
    } catch (error) {
      if (error instanceof AllegroApiException && error.statusCode !== undefined) {
        // `allegroErrors` is populated by `AllegroHttpClient.handleError`
        // (#486) — every 4xx/5xx with a JSON body shaped `{ errors: [...] }`
        // has it pre-parsed. Empty body / non-JSON / non-Allegro-shape →
        // undefined, which we collapse to [] for the validation mapper.
        const parsedErrors = error.allegroErrors ?? [];
        this.logger.error(
          `Allegro rejected offer creation: connection=${this.connectionId} status=${error.statusCode} errors=${parsedErrors.length}`,
          error
        );
        throw new OfferCreateRejectedException(
          ALLEGRO_ADAPTER_KEY,
          error.statusCode,
          this.mapValidationErrors(parsedErrors)
        );
      }
      throw error;
    }

    const validationErrors = this.mapValidationErrors(response.validation?.errors ?? []);
    const status = this.resolveCreateOfferStatus(
      response.publication?.status,
      validationErrors.length > 0,
      cmd.publishImmediately
    );

    this.logger.log(
      `Allegro offer created: connection=${this.connectionId} offerId=${response.id} status=${status} validationErrors=${validationErrors.length}`
    );

    const result: CreateOfferResult = {
      externalOfferId: response.id,
      status,
    };
    if (validationErrors.length > 0) {
      result.validationErrors = validationErrors;
    }
    return result;
  }

  /**
   * Fetch seller-configured Allegro policies (shipping-rates + return +
   * warranty + implied-warranty). All four Allegro endpoints are independent;
   * issued in parallel via Promise.all so total latency tracks the slowest
   * call. Any non-2xx propagates as `AllegroApiException` from the HTTP
   * client — the calling service surfaces that to the HTTP layer as a 5xx.
   *
   * @see {@link AllegroShippingRatesResponse} for why delivery policies are
   *   fetched from `/sale/shipping-rates` (not `/sale/delivery-settings`).
   */
  async fetchSellerPolicies(): Promise<SellerPolicies> {
    this.logger.debug(`Fetching Allegro seller policies (connection: ${this.connectionId})`);

    const [shippingRatesResponse, returns, warranties, impliedWarranties] = await Promise.all([
      this.httpClient.get<AllegroShippingRatesResponse>('/sale/shipping-rates'),
      this.httpClient.get<AllegroReturnPoliciesResponse>(
        '/after-sales-service-conditions/return-policies'
      ),
      this.httpClient.get<AllegroWarrantiesResponse>('/after-sales-service-conditions/warranties'),
      this.httpClient.get<AllegroImpliedWarrantiesResponse>(
        '/after-sales-service-conditions/implied-warranties'
      ),
    ]);

    const mapEntry = (p: AllegroSellerPolicyEntry): { id: string; name: string } => ({
      id: p.id,
      name: p.name,
    });

    return {
      deliveryPolicies: (shippingRatesResponse.data.shippingRates ?? []).map(mapEntry),
      returnPolicies: (returns.data.returnPolicies ?? []).map(mapEntry),
      warranties: (warranties.data.warranties ?? []).map(mapEntry),
      impliedWarranties: (impliedWarranties.data.impliedWarranties ?? []).map(mapEntry),
    };
  }

  /**
   * Fetch the seller's EU GPSR responsible-producer registry
   * (`GET /sale/responsible-producers`). Maps the Allegro response shape
   * into the neutral `ResponsibleProducerEntry[]` consumed by the FE
   * connection-settings dropdown. No caching — operator-driven, freshness
   * over latency. (#430)
   */
  async fetchResponsibleProducers(): Promise<ResponsibleProducerEntry[]> {
    this.logger.debug(`Fetching Allegro responsible producers (connection: ${this.connectionId})`);
    const response = await this.httpClient.get<AllegroResponsibleProducersResponse>(
      '/sale/responsible-producers'
    );
    const entries = response.data.responsibleProducers ?? [];
    return entries.map(
      (e: AllegroResponsibleProducerEntry): ResponsibleProducerEntry => ({
        id: e.id,
        name: e.name ?? e.id,
        // Allegro defaults unknown classifications to PRODUCER; mirror that
        // so the FE never has to handle `undefined` here.
        kind: e.type ?? 'PRODUCER',
      })
    );
  }

  /**
   * `SafetyAttachmentUploader.uploadSafetyAttachment` — upload a
   * GPSR safety-information attachment so its returned id can be
   * referenced from `productSet[*].safetyInformation.attachments[].id`
   * on subsequent offer-create payloads. Routes through
   * `this.uploadHttpClient` (the upload-domain client at
   * `upload.allegro.pl[.allegrosandbox.pl]`) — using `this.httpClient`
   * here would 404 since the API host doesn't expose this endpoint.
   * (#449)
   */
  async uploadSafetyAttachment(
    input: SafetyAttachmentUploadInput
  ): Promise<SafetyAttachmentUploadResult> {
    this.logger.debug(
      `Uploading Allegro safety attachment (connection: ${this.connectionId}, fileName: ${input.fileName}, ${input.bytes.byteLength} bytes)`
    );
    return uploadSafetyAttachmentViaAllegro(this.uploadHttpClient, input);
  }

  /**
   * Smart-link pre-step (#431). Resolves the variant's barcode against
   * Allegro's product catalogue *only* when both an EAN-shaped barcode
   * and a category id are available; otherwise short-circuits to
   * `no_match` so `applyPlatformParams` falls through to inline.
   *
   * Splitting out the precondition logic keeps `createOffer` flat and
   * makes the smart-link skip-paths trivially traceable in tests.
   */
  private async maybeResolveProductCard(
    cmd: CreateOfferCommand
  ): Promise<ResolveProductCardResult> {
    // #808 — when the caller already resolved a unique catalogue card (the
    // bulk wizard's EAN match), link it directly. Skipping the re-search
    // avoids the weaker fuzzy `phrase` lookup that can downgrade a known
    // unique match to `ambiguous`/`no_match` and force inline product
    // creation (→ 422 on categories with required product parameters).
    if (cmd.productCardId) {
      this.logger.debug(
        `Allegro smart-link: using pre-resolved productCardId=${cmd.productCardId} ` +
          `connection=${this.connectionId}`
      );
      return { kind: 'unique', productId: cmd.productCardId };
    }
    const ean = cmd.variantBarcode;
    const categoryId = cmd.overrides?.categoryId;
    if (!ean || !categoryId) {
      return { kind: 'no_match' };
    }
    return resolveAllegroProductCardByEan(this.httpClient, this.cache, {
      ean,
      categoryId,
    });
  }

  private buildCreateOfferRequest(
    cmd: CreateOfferCommand,
    cardLinkResult: ResolveProductCardResult
  ): AllegroProductOfferCreateRequest {
    const platformParams = cmd.overrides?.platformParams ?? {};

    // #420 — Allegro's product-name validator (and presumably the offer-name
    // one) rejects Unicode punctuation like em-dash. ASCII-normalize the
    // operator title before any other use so both `body.name` and the
    // mirrored `productSet[0].product.name` (set later in applyPlatformParams)
    // see the same clean string. Sanitize before the empty-precondition
    // check so a title of only banned-and-empty-mapped chars (none today,
    // but future-proof) still trips the precondition correctly.
    const rawTitle = cmd.overrides?.title;
    const name = rawTitle !== undefined ? sanitizeAllegroName(rawTitle) : undefined;
    if (rawTitle !== undefined && name !== rawTitle) {
      this.logger.debug(
        `Allegro name sanitized on offer create: connection=${this.connectionId} ` +
          `original=${JSON.stringify(rawTitle)} sanitized=${JSON.stringify(name)}`
      );
    }

    const categoryId = cmd.overrides?.categoryId;
    if (!name || name.trim().length === 0) {
      throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, [
        {
          code: 'PRECONDITION_TITLE_REQUIRED',
          message: 'overrides.title is required for Allegro offer creation',
        },
      ]);
    }
    if (!categoryId || categoryId.trim().length === 0) {
      throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, [
        {
          code: 'PRECONDITION_CATEGORY_REQUIRED',
          message: 'overrides.categoryId is required for Allegro offer creation',
        },
      ]);
    }
    const externalRef = cmd.idempotencyKey ?? cmd.internalVariantId;

    const body: AllegroProductOfferCreateRequest = {
      name,
      category: { id: categoryId },
      sellingMode: {
        price: {
          amount: cmd.price.amount.toFixed(2),
          currency: cmd.price.currency,
        },
        format: 'BUY_NOW',
      },
      stock: { available: cmd.stock, unit: 'UNIT' },
      publication: { status: cmd.publishImmediately ? 'ACTIVE' : 'INACTIVE' },
      external: { id: externalRef },
    };

    if (cmd.overrides?.description) {
      const sanitized = sanitizeAllegroDescription(cmd.overrides.description).trim();
      if (sanitized.length > 0) {
        body.description = {
          sections: [
            {
              items: [{ type: 'TEXT', content: sanitized }],
            },
          ],
        };
      }
    }

    if (cmd.overrides?.imageUrls && cmd.overrides.imageUrls.length > 0) {
      body.images = cmd.overrides.imageUrls;
    }

    // #430 — every offer needs a ship-from address. Always written from the
    // connection-level seller defaults (preflight guard in `createOffer`
    // ensures `this.sellerDefaults` is defined by the time we get here).
    body.location = { ...this.sellerDefaults!.location };

    this.applyPlatformParams(body, platformParams, cmd.parameters, cardLinkResult, cmd.condition);

    return body;
  }

  /**
   * Map neutral `OfferParameter`s (already merged operator+projected by the
   * core builder, #1071) to the Allegro wire shape for one section: drop the
   * `section` axis (the caller has already filtered by it) and carry
   * `values` / `valuesIds` / `rangeValue`. The Allegro adapter is the **sole**
   * shaper of the offer/product split — `platformParams` no longer carries
   * category parameters.
   */
  private toAllegroParameters(params: readonly OfferParameter[]): AllegroOfferParameter[] {
    return params.map((param) => ({
      id: param.id,
      ...(param.values ? { values: param.values } : {}),
      ...(param.valuesIds ? { valuesIds: param.valuesIds } : {}),
      ...(param.rangeValue ? { rangeValue: param.rangeValue } : {}),
    }));
  }

  /**
   * Build the Allegro "Stan" (condition) offer-section parameter from the neutral
   * `cmd.condition` (#1500). Returns `undefined` when no condition is set OR when
   * the operator already supplied a Stan parameter (id 11323) among the
   * offer-section params — operator intent wins and condition is never
   * double-set. `valuesIds` carries the dictionary entry id ("Stan" is a
   * dictionary parameter).
   *
   * The operator-wins check inspects only the offer-section params
   * (`existingOfferParameters`) by design: "Stan" is inherently an
   * offer-section parameter on Allegro (fixture `describesProduct:false`; the
   * wizard/mapper always treat it as offer-section), so a product-section Stan
   * cannot legitimately arise. If that assumption ever breaks, extend the
   * dedup to scan the product-section params too.
   */
  private buildConditionParameter(
    condition: OfferCondition | undefined,
    existingOfferParameters: readonly AllegroOfferParameter[]
  ): AllegroOfferParameter | undefined {
    if (!condition) {
      return undefined;
    }
    if (existingOfferParameters.some((p) => p.id === ALLEGRO_CONDITION_PARAMETER_ID)) {
      return undefined;
    }
    return {
      id: ALLEGRO_CONDITION_PARAMETER_ID,
      valuesIds: [ALLEGRO_CONDITION_VALUE_IDS[condition]],
    };
  }

  private applyPlatformParams(
    body: AllegroProductOfferCreateRequest,
    platformParams: Record<string, unknown>,
    parameters: readonly OfferParameter[] | undefined,
    cardLinkResult: ResolveProductCardResult,
    condition: OfferCondition | undefined
  ): void {
    const deliveryPolicyId = platformParams['deliveryPolicyId'];
    const handlingTime = platformParams['handlingTime'];
    if (typeof deliveryPolicyId === 'string' || typeof handlingTime === 'string') {
      body.delivery = {};
      if (typeof deliveryPolicyId === 'string') {
        body.delivery.shippingRates = { id: deliveryPolicyId };
      }
      if (typeof handlingTime === 'string') {
        body.delivery.handlingTime = handlingTime;
      }
    }

    const returnPolicyId = platformParams['returnPolicyId'];
    const warrantyId = platformParams['warrantyId'];
    const impliedWarrantyId = platformParams['impliedWarrantyId'];
    if (typeof returnPolicyId === 'string' || typeof warrantyId === 'string') {
      body.afterSalesServices = {};
      if (typeof returnPolicyId === 'string') {
        body.afterSalesServices.returnPolicy = { id: returnPolicyId };
      }
      if (typeof warrantyId === 'string') {
        body.afterSalesServices.warranty = { id: warrantyId };
        // Allegro account-level Complaints Terms (Warunki reklamacji) are required
        // before impliedWarrantyId can be referenced; gate on warrantyId to avoid
        // ImpliedWarrantyNotDefinedException 422 (#406).
        if (typeof impliedWarrantyId === 'string') {
          body.afterSalesServices.impliedWarranty = { id: impliedWarrantyId };
        }
      }
    }

    const invoice = platformParams['invoice'];
    if (invoice === 'VAT' || invoice === 'NO_INVOICE' || invoice === 'VAT_MARGIN') {
      body.payments = { invoice };
    }

    // Offer-section parameters from the neutral `cmd.parameters` (#1071).
    // Applied before the smart-link short-circuit so card-linked offers still
    // carry offer-section params (the card only supplies product-section ones).
    const offerParameters = this.toAllegroParameters(
      (parameters ?? []).filter((p) => p.section === 'offer')
    );
    // #1500 — default marketplace-required condition ("Stan"). Skip when the
    // operator already supplied a Stan parameter (offer-section id 11323) so
    // operator intent wins and condition is never double-set.
    const conditionParameter = this.buildConditionParameter(condition, offerParameters);
    if (conditionParameter) {
      offerParameters.push(conditionParameter);
    }
    if (offerParameters.length > 0) {
      body.parameters = offerParameters;
    }

    // #431 — smart-link short-circuit. When the variant's EAN uniquely
    // matches an existing Allegro product card, build the productSet entry
    // as a card reference: `product.id` only, plus the per-entry quantity.
    // Allegro inherits `name`, `parameters`, `images`, and the EU GPSR
    // fields (`responsibleProducer`, `safetyInformation`) from the card,
    // so we **skip** writing all of those on the entry. Offer-section
    // `body.parameters[]` (set above) still flows through normally.
    if (cardLinkResult.kind === 'unique') {
      // Reference the catalogue card by id only. The offer's sellable quantity
      // lives on `body.stock.available` (set in buildCreateOfferRequest on
      // every path). `productSet[].quantity` is the *multipack size* — units of
      // the card per sale item — which defaults to 1 when omitted. Writing the
      // sellable stock here was both wrong-typed (Allegro wants an object, not
      // a bare int → `JsonMappingException` at `productSet[0].quantity`) and
      // wrong semantics. OL lists 1 variant = 1 sale unit, so we omit it (#808).
      body.productSet = [{ product: { id: cardLinkResult.productId } }];
      this.logger.log(
        `Allegro smart-link applied: connection=${this.connectionId} ` +
          `productId=${cardLinkResult.productId} outcome=unique`
      );
      return;
    }

    if (cardLinkResult.kind === 'ambiguous') {
      this.logger.log(
        `Allegro smart-link skipped: connection=${this.connectionId} ` +
          `outcome=ambiguous matchCount=${cardLinkResult.matches.length}`
      );
    }
    // `no_match` — not logged here; resolver path is the cheap default.

    // #419 — product-section parameters travel under
    // `body.productSet[0].product.parameters[]`. The earlier #415 fix wrote
    // them under a top-level `body.product`, which Allegro rejects with
    // `UnknownJSONProperty: { unknownProperties: "product" }`. Allegro's POST
    // contract mirrors the GET shape (`AllegroProductOffer.productSet[]`).
    //
    // Allegro additionally requires `productSet[].product.name` when creating
    // an inline product (no existing `product.id` to inherit from). We reuse
    // `body.name` (the offer title, already validated ≤75 chars) — MVP
    // coupling, revisited by the smart-link follow-up (#412).
    //
    // `productSet[0].product.images` is also required (≥1) — confirmed by
    // sandbox repro returning `ProductValidationException` at path
    // `productSet[0].product`. We populate it later in `createOffer`, *after*
    // the image-upload step has rewritten `body.images` to Allegro CDN URLs:
    // doing it here would copy the pre-upload operator URL, which Allegro
    // rejects.
    //
    // #439 — `productSet[0]` is emitted on every non-card-linked offer,
    // even when the operator hasn't supplied any `productParameters`. The
    // earlier code gated the entire entry on `productParameters.length > 0`
    // (an unverified assumption inherited from #415). Allegro's GPSR
    // enforcement (Reg. 2023/988, mandatory since 13 Dec 2024) requires
    // `responsibleProducer` + `safetyInformation` on `productSet[0]` for
    // every inline product, so omitting the array yields a 422 with
    // `SAFETY_INFO_NOT_DEFINED` at `productSet[0].safetyInformation`. The
    // 2026-04-29 sandbox repro confirmed this: smart-link missed, the
    // offer carried no `productParameters`, and the create was rejected
    // because the GPSR fields never reached Allegro.
    //
    // #420 — `body.name` arrives already sanitized via sanitizeAllegroName
    // in buildCreateOfferRequest (which calls this method); no re-sanitization
    // needed at this site. Keeping a single sanitization point per request
    // lifecycle avoids "why is this being sanitized — wasn't it already?"
    // reader confusion.
    // Product-section parameters from the neutral `cmd.parameters` (#1071).
    // Reached only on the inline-product path — the `unique` smart-link branch
    // above early-returned, inheriting product params from the catalog card.
    const filtered = this.toAllegroParameters(
      (parameters ?? []).filter((p) => p.section === 'product')
    );
    // `parameters` is attached only when the operator supplied any — Allegro
    // rejects an explicit empty array on inline products. Spread-with-conditional
    // keeps the construction declarative and avoids a post-create mutation.
    const inlineProduct: NonNullable<AllegroProductSetEntry['product']> = {
      name: body.name,
      ...(filtered.length > 0 ? { parameters: filtered } : {}),
    };
    // The `sellerDefaults!` non-null assertions below are guaranteed by the
    // per-field preflight in `createOffer` (`collectMissingSellerDefaultsFields`,
    // #430 / #437): if `responsibleProducerId` or `safetyInformation` were
    // missing, the preflight throws `OfferCreateRejectedException` before this
    // method runs. Do not weaken the preflight without revisiting these sites.
    body.productSet = [
      {
        product: inlineProduct,
        // #430 — GPSR fields required by Allegro on inline-product creation
        // (Reg. 2023/988, mandatory since 13 Dec 2024).
        responsibleProducer: { id: this.sellerDefaults!.responsibleProducerId },
        safetyInformation: this.sellerDefaults!.safetyInformation,
      },
    ];
  }

  private resolveCreateOfferStatus(
    publicationStatus: string | undefined,
    hasValidationErrors: boolean,
    publishImmediately: boolean
  ): CreateOfferResultStatus {
    if (hasValidationErrors) {
      return 'draft';
    }
    if (publicationStatus === 'ACTIVE') {
      return 'active';
    }
    if (publicationStatus === 'ACTIVATING') {
      return 'validating';
    }
    if (publishImmediately) {
      return 'validating';
    }
    return 'draft';
  }

  private mapValidationErrors(errors: AllegroValidationError[]): CreateOfferValidationError[] {
    return errors.map((err) => ({
      field: err.path,
      code: err.code,
      message: err.userMessage ?? err.message,
    }));
  }

  /**
   * Poll Allegro for quantity change command completion status.
   *
   * Uses exponential backoff: 2s initial, 2x multiplier, 30s max, 5 attempts.
   * Returns the final status response, or the last response if still pending after timeout.
   */
  private async pollQuantityCommandStatus(
    commandId: string
  ): Promise<AllegroQuantityChangeCommandStatusResponse | null> {
    const { maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier } = this.quantityPollConfig;

    let delayMs = initialDelayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.sleep(delayMs);

      try {
        const response = await this.httpClient.get<AllegroQuantityChangeCommandStatusResponse>(
          `/sale/offer-quantity-change-commands/${commandId}`
        );

        const tasks = response.data.tasks ?? [];
        const allTerminal =
          tasks.length > 0 && tasks.every((t) => t.status === 'SUCCESS' || t.status === 'FAIL');

        if (allTerminal) {
          return response.data;
        }

        this.logger.debug(
          `Allegro command ${commandId} still pending (attempt ${attempt}/${maxAttempts}, connection: ${this.connectionId})`
        );
      } catch (error) {
        this.logger.warn(
          `Failed to poll Allegro command status (commandId: ${commandId}, attempt ${attempt}/${maxAttempts}): ${(error as Error).message}`
        );
      }

      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
    }

    this.logger.warn(
      `Allegro command ${commandId} did not reach terminal status after ${maxAttempts} polling attempts (connection: ${this.connectionId})`
    );
    return null;
  }

  /**
   * Poll for command status and update the persisted command record.
   *
   * On SUCCESS: update to 'succeeded'
   * On FAIL: update to 'failed' with error details, then throw
   * On timeout: leave as 'queued', log warning
   */
  private async pollAndUpdateCommandStatus(commandId: string, offerId: string): Promise<void> {
    const result = await this.pollQuantityCommandStatus(commandId);

    if (!result) {
      return;
    }

    const tasks = result.tasks ?? [];
    const failedTasks = tasks.filter((t) => t.status === 'FAIL');

    if (failedTasks.length > 0) {
      const errorMessages = failedTasks
        .map((t) => {
          const errDetails =
            t.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? t.message ?? 'unknown';
          return `offer ${t.offerId}: ${errDetails}`;
        })
        .join(', ');

      try {
        if (this.commandRepository) {
          await this.commandRepository.updateStatus(commandId, 'failed', errorMessages);
        }
      } catch (persistError) {
        this.logger.warn(
          `Failed to persist command failure status (commandId: ${commandId}): ${(persistError as Error).message}`
        );
      }

      throw new Error(
        `Allegro quantity command ${commandId} failed for offer ${offerId}: ${errorMessages}`
      );
    }

    try {
      if (this.commandRepository) {
        await this.commandRepository.updateStatus(commandId, 'succeeded');
      }
    } catch (persistError) {
      this.logger.warn(
        `Failed to persist command success status (commandId: ${commandId}): ${(persistError as Error).message}`
      );
    }

    this.logger.debug(
      `Allegro quantity command ${commandId} confirmed SUCCESS (connection: ${this.connectionId})`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
