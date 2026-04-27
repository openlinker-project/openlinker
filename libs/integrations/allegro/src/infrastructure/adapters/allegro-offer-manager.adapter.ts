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
  CategoryBarcodeMatcher,
  CategoryParametersReader,
  OfferCreator,
  SellerPoliciesReader,
  OfferFeedInput,
  OfferFeedOutput,
  UpdateOfferQuantityCommand,
  UpdateOfferFieldsCommand,
  CreateOfferCommand,
  CreateOfferResult,
  CreateOfferResultStatus,
  CreateOfferValidationError,
  OfferCategory,
  CategoryParameter,
  SellerPolicies,
} from '@openlinker/core/listings';
import { OfferCreateRejectedException, CategoryNotFoundException } from '@openlinker/core/listings';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CachePort } from '@openlinker/shared';
import { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import { toNeutralCategoryParameter } from '../mappers/allegro-category-parameter.mapper';
import {
  AllegroOfferQuantityChangeCommandResponse,
  AllegroQuantityChangeCommandStatusResponse,
  AllegroCategoryParametersResponse,
  AllegroCategoriesResponse,
  AllegroOfferParameter,
  AllegroProductOffer,
  AllegroOffersResponse,
  AllegroOfferEventsResponse,
  AllegroOfferFieldsPatchBody,
  AllegroMatchingCategoriesResponse,
  AllegroProductOfferCreateRequest,
  AllegroProductOfferCreateResponse,
  AllegroValidationError,
  AllegroShippingRatesResponse,
  AllegroReturnPoliciesResponse,
  AllegroWarrantiesResponse,
  AllegroImpliedWarrantiesResponse,
  AllegroSellerPolicyEntry,
} from '../../domain/types/allegro-api.types';
import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import { Logger, formatBodyForLog } from '@openlinker/shared/logging';
import { createHash } from 'crypto';
import { sanitizeAllegroDescription } from '../util/sanitize-allegro-description';
import { uploadImagesViaAllegro } from '../util/upload-images-via-allegro';
import {
  AllegroQuantityCommandRepositoryPort,
  AllegroQuantityCommand,
} from '../../index';

/** Adapter key registered for the Allegro marketplace integration. */
const ALLEGRO_ADAPTER_KEY = 'allegro.publicapi.v1';

/** Default cache TTL (24h) for `/sale/categories/{id}/parameters` responses. */
const DEFAULT_CAT_PARAMS_TTL_SEC = 24 * 60 * 60;
/** Cache key prefix — global namespace; Allegro category schemas are public taxonomy. */
const CAT_PARAMS_CACHE_PREFIX = 'allegro:cat-params:';

/**
 * Type guard used when filtering untyped `platformParams.parameters` into the
 * Allegro-accepted shape. Requires `id: string` and, when present, `values` /
 * `valuesIds` must be arrays of strings. Anything that fails this check is
 * silently dropped — Allegro would reject it anyway, and keeping the guard
 * strict means invalid shapes fail fast at the request-build step.
 */
function isAllegroOfferParameterShape(candidate: unknown): candidate is AllegroOfferParameter {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const c = candidate as { id?: unknown; values?: unknown; valuesIds?: unknown };
  if (typeof c.id !== 'string' || c.id.length === 0) return false;
  if (c.values !== undefined) {
    if (!Array.isArray(c.values) || !c.values.every((v) => typeof v === 'string')) return false;
  }
  if (c.valuesIds !== undefined) {
    if (!Array.isArray(c.valuesIds) || !c.valuesIds.every((v) => typeof v === 'string')) return false;
  }
  return true;
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
    CategoryBarcodeMatcher,
    CategoryParametersReader,
    OfferCreator,
    SellerPoliciesReader {
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
      `Listing Allegro offer events (connection: ${this.connectionId}, fromCursor: ${input.cursor || 'none'}, limit: ${input.limit})`,
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
        `Fetched ${events.length} offer events (connection: ${this.connectionId}, nextCursor: ${nextCursor || 'none'})`,
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
        error,
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
      `Listing Allegro offers (connection: ${this.connectionId}, offset: ${offset}, limit: ${input.limit})`,
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
        `Received Allegro offers (connection: ${this.connectionId}, offers: ${offers.length}, total: ${response.data.totalCount})`,
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
        error,
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
      `Updating Allegro offer quantity: offerId=${cmd.offerId}, quantity=${cmd.quantity} (connection: ${this.connectionId}, idempotencyKey: ${cmd.idempotencyKey})`,
    );

    try {
      const commandId = this.generateCommandIdFromIdempotencyKey(cmd.idempotencyKey);

      const commandBody: Record<string, unknown> = {
        offerId: cmd.offerId,
        quantityChange: {
          changeType: 'FIXED',
          value: cmd.quantity,
        },
      };

      const response = await this.httpClient.put<AllegroOfferQuantityChangeCommandResponse>(
        `/sale/offer-quantity-change-commands/${commandId}`,
        commandBody,
      );

      try {
        if (this.commandRepository) {
          const status = this.mapAllegroCommandStatus(response.data.status);
          const command = AllegroQuantityCommand.create(
            response.data.id,
            this.connectionId,
            cmd.offerId,
            cmd.quantity,
            status,
          );
          await this.commandRepository.create(command);
        }
      } catch (persistError) {
        this.logger.warn(
          `Failed to persist offer quantity command status (commandId: ${response.data.id}): ${(persistError as Error).message}`,
        );
      }

      this.logger.debug(
        `Allegro offer quantity command submitted: commandId=${response.data.id} (connection: ${this.connectionId})`,
      );

      await this.pollAndUpdateCommandStatus(response.data.id, cmd.offerId);
    } catch (error) {
      this.logger.error(
        `Failed to update Allegro offer quantity (offerId: ${cmd.offerId}, connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
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
    offers: AllegroOffersResponse['offers'],
  ): Promise<OfferFeedOutput['items']> {
    const items: OfferFeedOutput['items'] = [];

    for (const offer of offers) {
      if (await this.isOfferMapped(offer.id)) {
        this.logger.debug(
          `Skipping Allegro offer ${offer.id} (connection: ${this.connectionId}) - already mapped`,
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
          `Failed to resolve identifiers for offer ${offer.id} (connection: ${this.connectionId}): ${(error as Error).message}`,
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
        'Offer',
        offerId,
        this.connectionId,
      );
      return internalId !== null;
    } catch (error) {
      this.logger.warn(
        `Failed to check existing offer mapping for ${offerId} (connection: ${this.connectionId}): ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async fetchOfferIdentifiers(
    offerId: string,
    categoryId?: string,
  ): Promise<{ sku: string | null; ean: string | null; gtin: string | null }> {
    const response = await this.httpClient.get<AllegroProductOffer>(
      `/sale/product-offers/${offerId}`,
    );

    const offer = response.data;
    const resolvedCategoryId = categoryId ?? offer.category?.id ?? null;

    let eanIds: Set<string> = new Set();
    let gtinIds: Set<string> = new Set();

    if (resolvedCategoryId) {
      const categoryParams = await this.fetchCategoryParametersRaw(resolvedCategoryId);
      const { eanIds: resolvedEanIds, gtinIds: resolvedGtinIds } =
        this.findIdentifierParameterIds(categoryParams.parameters);
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
   * Raw, uncached fetch of `/sale/categories/{id}/parameters`. Returns Allegro's
   * native shape verbatim. Single source of truth for the HTTP call —
   * `fetchOfferIdentifiers` and `fetchCategoryParameters` (cached + neutral)
   * both delegate here. Public so dev tooling can capture fixtures.
   */
  async fetchCategoryParametersRaw(
    categoryId: string,
  ): Promise<AllegroCategoryParametersResponse> {
    this.logger.debug(
      `Fetching Allegro category parameters (raw): connection=${this.connectionId} categoryId=${categoryId}`,
    );
    const response = await this.httpClient.get<AllegroCategoryParametersResponse>(
      `/sale/categories/${categoryId}/parameters`,
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
          `Category parameters cache HIT: connection=${this.connectionId} categoryId=${input.categoryId}`,
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
      `Fetching Allegro categories (connection: ${this.connectionId}, parentId: ${parentId ?? 'root'})`,
    );
    const queryParams: Record<string, string | number> = {};
    if (parentId) {
      queryParams['parent.id'] = parentId;
    }
    const response = await this.httpClient.get<AllegroCategoriesResponse>(
      '/sale/categories',
      { queryParams },
    );
    const categories = response.data.categories ?? [];
    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      parentId: cat.parent?.id ?? null,
      leaf: cat.leaf,
    }));
  }

  async matchCategoryByBarcode(barcode: string): Promise<string | null> {
    this.logger.debug(
      `Matching Allegro category by barcode (connection: ${this.connectionId}, barcode: ${barcode})`,
    );
    try {
      const response = await this.httpClient.get<AllegroMatchingCategoriesResponse>(
        '/sale/matching-categories',
        { queryParams: { ean: barcode } },
      );
      const matches = response.data.matchingCategories ?? [];
      if (matches.length === 1) {
        const categoryId = matches[0].category.id;
        this.logger.debug(
          `Barcode auto-detect matched category ${categoryId} (connection: ${this.connectionId})`,
        );
        return categoryId;
      }
      if (matches.length > 1) {
        this.logger.debug(
          `Barcode auto-detect returned ${matches.length} categories, skipping (connection: ${this.connectionId})`,
        );
      }
      return null;
    } catch (error) {
      this.logger.warn(
        `Failed to match category by barcode (connection: ${this.connectionId}): ${(error as Error).message}`,
      );
      return null;
    }
  }

  private findIdentifierParameterIds(
    parameters: Array<{ id: string; name: string }>,
  ): { eanIds: Set<string>; gtinIds: Set<string> } {
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
    nameMatcher: RegExp,
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
    allegroStatus: 'QUEUED' | 'ACCEPTED' | 'REJECTED',
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
   */
  async updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<void> {
    this.logger.debug(
      `Updating Allegro offer fields: offerId=${cmd.externalOfferId} (connection: ${this.connectionId}, fields=${Object.keys(cmd.fields).join(',')})`,
    );

    const body: AllegroOfferFieldsPatchBody = {};

    if (cmd.fields.price !== undefined) {
      body.sellingMode = {
        price: {
          amount: cmd.fields.price.amount,
          currency: cmd.fields.price.currency,
        },
      };
    }

    if (cmd.fields.title !== undefined) {
      body.name = cmd.fields.title;
    }

    if (cmd.fields.description !== undefined) {
      body.description = {
        sections: cmd.fields.description.sections.map((section) => ({
          items: section.items.map((item) => ({
            type: item.type,
            content: sanitizeAllegroDescription(item.content),
          })),
        })),
      };
    }

    if (Object.keys(body).length === 0) {
      this.logger.warn(
        `updateOfferFields called with empty fields for offerId=${cmd.externalOfferId} — skipping`,
      );
      return;
    }

    try {
      await this.httpClient.patch<void>(
        `/sale/product-offers/${cmd.externalOfferId}`,
        body,
      );

      this.logger.debug(
        `Allegro offer fields updated: offerId=${cmd.externalOfferId} (connection: ${this.connectionId})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update Allegro offer fields (offerId: ${cmd.externalOfferId}, connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
      );
      throw error;
    }
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
    const body = this.buildCreateOfferRequest(cmd);

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
        `Allegro image upload starting: connection=${this.connectionId} count=${originalCount}`,
      );
      const uploadResult = await uploadImagesViaAllegro(this.uploadHttpClient, body.images);
      if (!uploadResult.ok) {
        const codes = Array.from(new Set(uploadResult.failures.map((f) => f.code))).join(',');
        this.logger.warn(
          `Allegro image upload rejected create: connection=${this.connectionId} ` +
            `failed=${uploadResult.failures.length}/${originalCount} codes=${codes}`,
        );
        throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, uploadResult.failures);
      }
      body.images = uploadResult.locations;
      this.logger.debug(
        `Allegro image upload complete: connection=${this.connectionId} count=${body.images.length}`,
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
    if (body.productSet?.[0]?.product && body.images && body.images.length > 0) {
      body.productSet[0].product.images = body.images;
    }

    this.logger.debug(
      `Creating Allegro offer: connection=${this.connectionId} externalRef=${body.external?.id ?? 'n/a'} publishImmediately=${cmd.publishImmediately}`,
    );

    let response: AllegroProductOfferCreateResponse;
    try {
      const httpResponse = await this.httpClient.post<AllegroProductOfferCreateResponse>(
        '/sale/product-offers',
        body as unknown as Record<string, unknown>,
      );
      response = httpResponse.data;
    } catch (error) {
      if (error instanceof AllegroApiException && error.statusCode !== undefined) {
        const parsedErrors = this.parseAllegroErrors(error.responseBody);
        this.logger.error(
          `Allegro rejected offer creation: connection=${this.connectionId} status=${error.statusCode} errors=${parsedErrors.length}`,
          error,
        );
        throw new OfferCreateRejectedException(
          ALLEGRO_ADAPTER_KEY,
          error.statusCode,
          this.mapValidationErrors(parsedErrors),
        );
      }
      throw error;
    }

    const validationErrors = this.mapValidationErrors(response.validation?.errors ?? []);
    const status = this.resolveCreateOfferStatus(
      response.publication?.status,
      validationErrors.length > 0,
      cmd.publishImmediately,
    );

    this.logger.log(
      `Allegro offer created: connection=${this.connectionId} offerId=${response.id} status=${status} validationErrors=${validationErrors.length}`,
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
    this.logger.debug(
      `Fetching Allegro seller policies (connection: ${this.connectionId})`,
    );

    const [shippingRatesResponse, returns, warranties, impliedWarranties] = await Promise.all([
      this.httpClient.get<AllegroShippingRatesResponse>('/sale/shipping-rates'),
      this.httpClient.get<AllegroReturnPoliciesResponse>('/after-sales-service-conditions/return-policies'),
      this.httpClient.get<AllegroWarrantiesResponse>('/after-sales-service-conditions/warranties'),
      this.httpClient.get<AllegroImpliedWarrantiesResponse>('/after-sales-service-conditions/implied-warranties'),
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

  private buildCreateOfferRequest(cmd: CreateOfferCommand): AllegroProductOfferCreateRequest {
    const platformParams = cmd.overrides?.platformParams ?? {};

    const name = cmd.overrides?.title;
    const categoryId = cmd.overrides?.categoryId;
    if (!name || name.trim().length === 0) {
      throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, [
        { code: 'PRECONDITION_TITLE_REQUIRED', message: 'overrides.title is required for Allegro offer creation' },
      ]);
    }
    if (!categoryId || categoryId.trim().length === 0) {
      throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, [
        { code: 'PRECONDITION_CATEGORY_REQUIRED', message: 'overrides.categoryId is required for Allegro offer creation' },
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

    this.applyPlatformParams(body, platformParams);

    return body;
  }

  private applyPlatformParams(
    body: AllegroProductOfferCreateRequest,
    platformParams: Record<string, unknown>,
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

    const parameters = platformParams['parameters'];
    if (Array.isArray(parameters)) {
      body.parameters = parameters.filter(isAllegroOfferParameterShape);
    }

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
    // Omit `body.productSet` entirely when the array would be empty: sending
    // `productSet: []` or `productSet: [{ product: { parameters: [] } }]` is
    // rejected the same way `body.product` was. The empty-rejection
    // assumption is inherited from #415 and is itself unverified — if the
    // sandbox repro contradicts it we revisit here.
    const productParameters = platformParams['productParameters'];
    if (Array.isArray(productParameters)) {
      const filtered = productParameters.filter(isAllegroOfferParameterShape);
      if (filtered.length > 0) {
        body.productSet = [{ product: { name: body.name, parameters: filtered } }];
      }
    }
  }

  private resolveCreateOfferStatus(
    publicationStatus: string | undefined,
    hasValidationErrors: boolean,
    publishImmediately: boolean,
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

  private parseAllegroErrors(responseBody: string | undefined): AllegroValidationError[] {
    if (!responseBody) return [];
    try {
      const parsed = JSON.parse(responseBody) as { errors?: AllegroValidationError[] };
      if (Array.isArray(parsed.errors)) {
        return parsed.errors;
      }
    } catch (err) {
      // Genuinely malformed body (HTML proxy errors, etc.) — log breadcrumbs
      // so operators don't see an opaque `errors=0` upstream (#409). Body is
      // routed through `formatBodyForLog` (#416) — uncapped by default,
      // operator-tunable via `OL_LOG_BODY_MAX_BYTES`.
      this.logger.warn(
        `Failed to parse Allegro error body as JSON: ${(err as Error).message}. ` +
          `Raw body: ${formatBodyForLog(responseBody)}`,
      );
    }
    return [];
  }

  /**
   * Poll Allegro for quantity change command completion status.
   *
   * Uses exponential backoff: 2s initial, 2x multiplier, 30s max, 5 attempts.
   * Returns the final status response, or the last response if still pending after timeout.
   */
  private async pollQuantityCommandStatus(
    commandId: string,
  ): Promise<AllegroQuantityChangeCommandStatusResponse | null> {
    const { maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier } = this.quantityPollConfig;

    let delayMs = initialDelayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.sleep(delayMs);

      try {
        const response = await this.httpClient.get<AllegroQuantityChangeCommandStatusResponse>(
          `/sale/offer-quantity-change-commands/${commandId}`,
        );

        const tasks = response.data.tasks ?? [];
        const allTerminal =
          tasks.length > 0 && tasks.every((t) => t.status === 'SUCCESS' || t.status === 'FAIL');

        if (allTerminal) {
          return response.data;
        }

        this.logger.debug(
          `Allegro command ${commandId} still pending (attempt ${attempt}/${maxAttempts}, connection: ${this.connectionId})`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to poll Allegro command status (commandId: ${commandId}, attempt ${attempt}/${maxAttempts}): ${(error as Error).message}`,
        );
      }

      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
    }

    this.logger.warn(
      `Allegro command ${commandId} did not reach terminal status after ${maxAttempts} polling attempts (connection: ${this.connectionId})`,
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
  private async pollAndUpdateCommandStatus(
    commandId: string,
    offerId: string,
  ): Promise<void> {
    const result = await this.pollQuantityCommandStatus(commandId);

    if (!result) {
      return;
    }

    const tasks = result.tasks ?? [];
    const failedTasks = tasks.filter((t) => t.status === 'FAIL');

    if (failedTasks.length > 0) {
      const errorMessages = failedTasks
        .map((t) => {
          const errDetails = t.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? t.message ?? 'unknown';
          return `offer ${t.offerId}: ${errDetails}`;
        })
        .join(', ');

      try {
        if (this.commandRepository) {
          await this.commandRepository.updateStatus(commandId, 'failed', errorMessages);
        }
      } catch (persistError) {
        this.logger.warn(
          `Failed to persist command failure status (commandId: ${commandId}): ${(persistError as Error).message}`,
        );
      }

      throw new Error(
        `Allegro quantity command ${commandId} failed for offer ${offerId}: ${errorMessages}`,
      );
    }

    try {
      if (this.commandRepository) {
        await this.commandRepository.updateStatus(commandId, 'succeeded');
      }
    } catch (persistError) {
      this.logger.warn(
        `Failed to persist command success status (commandId: ${commandId}): ${(persistError as Error).message}`,
      );
    }

    this.logger.debug(
      `Allegro quantity command ${commandId} confirmed SUCCESS (connection: ${this.connectionId})`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
