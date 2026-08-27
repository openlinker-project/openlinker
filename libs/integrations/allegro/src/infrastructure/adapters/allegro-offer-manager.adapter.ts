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
  CategoryPathSegment,
  CategoryBarcodeMatcher,
  EanCategoryMatcher,
  EanCategoryMatcherStreaming,
  EanCategoryMatchStreamItem,
  EanCategoryMatchStreamOptions,
  BatchCategoryByEanInput,
  EanMatchResult,
  CategoryParametersReader,
  CatalogProductReader,
  CatalogProduct,
  CatalogProductMatchResult,
  CatalogProductSummary,
  FindProductsByBarcodeInput,
  AdapterSuppliedParametersReader,
  OfferCreator,
  OfferStatusReader,
  OfferStatusReadResult,
  OfferCommercialObservation,
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
  PendingQuantityAckReconciler,
  PendingQuantityAckReconcileResult,
  OfferQuantityBatchUpdater,
  UpdateOfferQuantitiesBatchCommand,
  UpdateOfferQuantitiesBatchResult,
  UpdateOfferQuantitiesBatchFailure,
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
  TaxonomyIdentityProvider,
  TaxonomyOwner,
  ResolveConcurrencyCeiling,
} from '@openlinker/core/listings';

import { ALLEGRO_DESCRIPTION_FORMAT } from '../util/allegro-description-format';
import {
  type DescriptionFormat,
  OfferCreateRejectedException,
  CategoryNotFoundException,
  OfferNotFoundOnMarketplaceException,
} from '@openlinker/core/listings';
import type { AllegroSellerDefaultsConfig } from '../../domain/types/allegro-seller-defaults.types';
import type { AllegroEnvironment } from '../../domain/types/allegro-config.types';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import {
  resolveAllegroProductCardByEan,
  type ResolveProductCardResult,
} from '../util/resolve-allegro-product-card-by-ean';
import {
  resolveCategoriesForBatchByEan,
  resolveBatchConcurrency,
  resolveStreamConcurrency,
  streamCategoriesForBatchByEan,
} from '../util/resolve-categories-for-batch-by-ean';
import { fetchAllegroProduct } from '../util/fetch-allegro-product';
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CachePort } from '@openlinker/shared';
import type { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import { toNeutralCategoryParameter } from '../mappers/allegro-category-parameter.mapper';
import type {
  AllegroOfferQuantityChangeCommandResponse,
  AllegroQuantityChangeCommandStatusResponse,
  AllegroTaskError,
  AllegroCategoryParametersResponse,
  AllegroCategoriesResponse,
  AllegroCategoryResponse,
  AllegroOfferParameter,
  AllegroOfferPublicationStatus,
  AllegroProductOffer,
  AllegroOffersResponse,
  AllegroOfferEventsResponse,
  AllegroOfferFieldsPatchBody,
  AllegroProductOfferCreateRequest,
  AllegroTaxSettingsResponse,
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
import { sanitizeAllegroName } from '../util/sanitize-allegro-name';
import {
  formatAllegroRate,
  readPermittedTaxRates,
  toAllegroRate,
  type PermittedTaxRate,
} from './allegro-tax-rate.mapper';
import { isTaxRateStrictEnabled } from '@openlinker/core/sales-documents';

import { uploadImagesViaAllegro } from '../util/upload-images-via-allegro';
import { uploadSafetyAttachmentViaAllegro } from '../util/upload-safety-attachment-via-allegro';
import type { AllegroQuantityCommandRepositoryPort } from '../../index';
import { AllegroQuantityCommand } from '../../index';

/** Adapter key registered for the Allegro marketplace integration. */
const ALLEGRO_ADAPTER_KEY = 'allegro.publicapi.v1';

/**
 * Country the offer's tax settings are written for when the catalogue rate
 * carries no provenance country (#2249). Allegro's marketplace is PL-first and
 * `taxSettings.rates[]` requires a country, so a default is unavoidable; it is
 * a named constant rather than an inline literal so the assumption is visible.
 */
const DEFAULT_ALLEGRO_TAX_COUNTRY = 'PL';

/**
 * Allegro's hard limit on `body.name` (the offer title). Platform-specific, so
 * it is enforced here rather than in the neutral builder - Erli imposes no
 * title limit and the shop-publish path caps at 255 (#1934/F11).
 */
const ALLEGRO_OFFER_TITLE_MAX_LENGTH = 75;

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
/**
 * Cache key prefix for a single category node (`GET /sale/categories/{id}`).
 * Global namespace — a category node is immutable public taxonomy, so it is
 * shared across connections and reused by every breadcrumb walk that touches it.
 */
const CATEGORY_NODE_CACHE_PREFIX = 'allegro:category-node:';

/**
 * Upper bound on category-breadcrumb ancestor hops (#1752). Allegro's tree is
 * far shallower; the cap only guards against a malformed/cyclic parent chain.
 */
const MAX_CATEGORY_PATH_DEPTH = 12;

/**
 * Variant key used when `matchCategoryByBarcode` delegates to the batch util
 * with a single-item input. Any stable string works — the result map is
 * consumed by one read in the same call.
 */
const SINGLE_ITEM_KEY = 'single';

/**
 * Build a URL-safe slug from a human offer name for the cosmetic path segment
 * of a public offer URL. Lowercases, strips diacritics (NFD + drop combining
 * marks), collapses every non-alphanumeric run to a single `-`, and trims
 * leading/trailing separators. Returns an empty string for blank/symbol-only
 * input so the caller can fall back to an id-only URL.
 *
 * The slug is cosmetic only \u2014 Allegro resolves the offer by the trailing id and
 * 301s to the canonical URL \u2014 so it must never be treated as canonical.
 */
function slugify(name: string): string {
  return (
    name
      // Latin letters with a stroke (Polish \u0142/\u0141, and the same family for other
      // languages) are single codepoints NFD does not decompose, so map them
      // explicitly before the combining-mark strip \u2014 otherwise `s\u0142uchawki`
      // would slug to `s-uchawki`.
      .replace(/[\u0142\u0141]/g, 'l')
      .replace(/[\u0111\u0110]/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

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
    PendingQuantityAckReconciler,
    OfferQuantityBatchUpdater,
    OfferLister,
    OfferEventReader,
    OfferFieldUpdater,
    CategoryBrowser,
    CategoryPathReader,
    CategoryBarcodeMatcher,
    EanCategoryMatcher,
    EanCategoryMatcherStreaming,
    CategoryParametersReader,
    CatalogProductReader,
    OfferCreator,
    AdapterSuppliedParametersReader,
    OfferStatusReader,
    OfferSmartClassificationReader,
    OfferReader,
    SellerPoliciesReader,
    ResponsibleProducerReader,
    SafetyAttachmentUploader,
    TaxonomyIdentityProvider
{
  private readonly logger = new Logger(AllegroOfferManagerAdapter.name);

  /**
   * Allegro accepts seven tags with a CONTEXT-SENSITIVE content model, no
   * attributes, a block opener, and 40 000 bytes (ADR-046).
   *
   * Allegro publishes no tag list. Every value below is reconstructed from
   * verbatim validator rejection messages in `allegro/allegro-api`:
   *   #11708 (2025-06-24)  Błędny tag "br", dozwolone są: {b}
   *   #9714  (2024-08-22)  Błędny tag "strong", dozwolone są: {b}
   *                        Błędny tag "b", dozwolone są: {h1, h2, p, ul, ol}
   *   #10656 (2025-01-13)  Błędny tag "ul", dozwolone są: {b, p}
   *   #3856               Błędny tag "h2", dozwolone są: {b}
   * Two opposite allowed sets for one payload (#9714) is what makes this a
   * grammar rather than a list. #3856 also carries an Allegro employee stating
   * `<br>` is not accepted and that h1/h2 take no additional formatting.
   *
   * Do not widen this set without a new rejection message to cite - the spec
   * pins it exactly so a widening is a deliberate test change.
   */
  getDescriptionFormat(): DescriptionFormat {
    return ALLEGRO_DESCRIPTION_FORMAT;
  }


  private readonly quantityPollConfig: QuantityPollConfig;
  private readonly catParamsTtlSec: number;
  /**
   * The operator's own outbound concurrency cap, read once at construction
   * (#2229). Clamps the resolve ceilings downward - see
   * `resolveStreamConcurrency` / `resolveBatchConcurrency`. Read from the
   * connection rather than injected so the reported and enforced ceilings share
   * one input.
   *
   * Typed `unknown` on purpose: `Connection.config` is a JSONB column, so the
   * declared `ConnectionRateLimit.maxConcurrent?: number` is a shape the read
   * cannot guarantee. The coercion lives in one covered place, inside the
   * resolver.
   */
  private readonly configuredMaxConcurrent: unknown;

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
    connection: Connection,
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
    private readonly storefrontBaseUrl?: string,
    /**
     * Which Allegro API host this connection talks to. Resolved by
     * `AllegroAdapterFactory` from the required, already-validated
     * `config.environment` — deliberately NOT re-parsed from `_connection`
     * here, which would put config-shape knowledge in two places.
     *
     * Optional with a `'production'` default only so the 13 existing spec
     * construction sites keep compiling; the factory always passes it.
     */
    private readonly environment: AllegroEnvironment = 'production'
  ) {
    this.quantityPollConfig = {
      maxAttempts: quantityPollConfig?.maxAttempts ?? 5,
      initialDelayMs: quantityPollConfig?.initialDelayMs ?? 2000,
      maxDelayMs: quantityPollConfig?.maxDelayMs ?? 30000,
      backoffMultiplier: quantityPollConfig?.backoffMultiplier ?? 2,
    };
    this.catParamsTtlSec = catParamsTtlSec ?? DEFAULT_CAT_PARAMS_TTL_SEC;
    this.configuredMaxConcurrent = connection.config?.rateLimit?.maxConcurrent;
  }

  /**
   * Declare WHICH Allegro category tree this connection reads and writes
   * (`TaxonomyIdentityProvider`, ADR-037 / #2063).
   *
   * Sandbox is a genuinely different tree, not a different view of one: it is a
   * different API host with independently-seeded category data, so sharing the
   * `'allegro'` scope let a sandbox and a production connection overwrite each
   * other's rows — and the watermark sweep then deleted the loser's whole tree
   * on every completing run.
   *
   * Region is deliberately NOT part of the identity: Allegro publishes one tree
   * across .pl/.cz/.sk/.hu with consistent identifiers (see
   * `taxonomy-owner.types.ts`), so `'allegro:pl'` would be a false distinction.
   */
  getTaxonomyIdentity(): TaxonomyOwner {
    return this.environment === 'sandbox' ? 'allegro:sandbox' : 'allegro';
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
   * Issues an Allegro offer quantity change command and returns as soon as
   * Allegro acknowledges the SUBMISSION — it does not wait for the command to
   * reach a terminal status (#2621). Allegro's own per-offer throttle
   * (~60/minute) means waiting here made propagation queue depth a direct
   * function of platform latency rather than of OL's own throughput. A
   * synchronous `REJECTED` submission (the platform's own definitive,
   * immediately-known answer) still throws so the caller marks the write
   * failed right away; a `QUEUED`/`ACCEPTED` submission resolves as
   * "dispatched" and is reconciled later by `reconcilePendingQuantityAcks`,
   * driven by the `marketplace.offerQuantity.reconcile` job.
   *
   * Uses idempotency key to derive a deterministic commandId for
   * deduplication.
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

      const status = this.mapAllegroCommandStatus(response.data.status);

      try {
        if (this.commandRepository) {
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
        `Allegro offer quantity command submitted: commandId=${response.data.id}, status=${status} (connection: ${this.connectionId})`
      );

      if (status === 'rejected') {
        const errorMessages =
          response.data.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? 'rejected';
        throw new Error(
          `Allegro rejected offer quantity command ${response.data.id} for offer ${cmd.offerId}: ${errorMessages}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to update Allegro offer quantity (offerId: ${cmd.offerId}, connection: ${this.connectionId}): ${(error as Error).message}`,
        error
      );
      throw error;
    }
  }

  /**
   * Batched counterpart of `updateOfferQuantity` (#2622). Allegro's
   * quantity-change-commands endpoint applies ONE `modification` value to
   * every offer named in `offerCriteria` — there is no per-offer distinct
   * quantity in a single command — so items are grouped by their target
   * quantity and one command is issued per group, rather than one per item.
   * A batch that happens to share the same quantity across all offers costs
   * exactly one request; a batch with N distinct quantities costs N requests
   * (still far below Allegro's ~60/min single-offer throttle for anything
   * larger than a handful of distinct values).
   *
   * Returns as soon as Allegro acknowledges submission, exactly like the
   * single-item `updateOfferQuantity` (#2621) — it does not poll for a
   * terminal status. A `QUEUED`/`ACCEPTED` group resolves every one of its
   * items as dispatched; `reconcilePendingQuantityAcks` resolves the
   * persisted queued/accepted rows to succeeded/failed later, on its own
   * schedule.
   *
   * Never throws: a whole-group failure (submit, or a synchronous platform
   * rejection) is reported as a per-item failure for every offer in that
   * group, so one bad group cannot sink offers in a sibling group, and the
   * caller never falls back to the N-request single-item path unnecessarily.
   */
  async updateOfferQuantitiesBatch(
    cmd: UpdateOfferQuantitiesBatchCommand
  ): Promise<UpdateOfferQuantitiesBatchResult> {
    const succeeded: string[] = [];
    const failed: UpdateOfferQuantitiesBatchFailure[] = [];

    const groups = new Map<number, UpdateOfferQuantityCommand[]>();
    for (const item of cmd.items) {
      if (!item.idempotencyKey) {
        failed.push({
          offerId: item.offerId,
          errorCode: 'missing-idempotency-key',
          message: 'idempotencyKey is required for Allegro offer quantity updates',
        });
        continue;
      }
      const group = groups.get(item.quantity);
      if (group) {
        group.push(item);
      } else {
        groups.set(item.quantity, [item]);
      }
    }

    await Promise.all(
      Array.from(groups.values()).map((items) => this.submitQuantityGroup(items, succeeded, failed))
    );

    return { succeeded, failed };
  }

  /**
   * Submits one quantity-change command covering every item in `items` (all
   * sharing the same target quantity) and maps Allegro's per-offer task
   * outcomes onto `succeeded`/`failed`. The commandId is derived from the
   * sorted set of item idempotency keys, so a retried batch with the same
   * membership dedupes against the same Allegro command.
   */
  private async submitQuantityGroup(
    items: UpdateOfferQuantityCommand[],
    succeeded: string[],
    failed: UpdateOfferQuantitiesBatchFailure[]
  ): Promise<void> {
    const quantity = items[0].quantity;
    const groupKey = items
      .map((item) => item.idempotencyKey)
      .sort()
      .join(',');
    const commandId = this.generateCommandIdFromIdempotencyKey(groupKey);

    try {
      const commandBody: Record<string, unknown> = {
        modification: {
          changeType: 'FIXED',
          value: quantity,
        },
        offerCriteria: [
          {
            offers: items.map((item) => ({ id: item.offerId })),
            type: 'CONTAINS_OFFERS',
          },
        ],
      };

      const response = await this.httpClient.put<AllegroOfferQuantityChangeCommandResponse>(
        `/sale/offer-quantity-change-commands/${commandId}`,
        commandBody
      );

      this.logger.debug(
        `Allegro batch offer quantity command submitted: commandId=${commandId}, offers=${items.length}, status=${response.data.status} (connection: ${this.connectionId})`
      );

      await this.persistBatchCommandRows(commandId, response.data.status, items);

      if (response.data.status === 'REJECTED') {
        // Allegro answered synchronously — this is the platform's own
        // definitive, immediately-known answer, so it fails right away
        // rather than waiting for a reconcile pass that will never resolve
        // it (no task for a rejected command ever appears).
        const message = this.formatAllegroTaskErrors(response.data.errors) ?? 'rejected';
        for (const item of items) {
          failed.push({ offerId: item.offerId, errorCode: 'rejected', message });
          await this.persistBatchOfferStatus(commandId, item.offerId, 'failed', message);
        }
        return;
      }

      // QUEUED/ACCEPTED — dispatched, not yet terminal (#2621). Every item in
      // the group resolves as accepted-for-processing here, exactly like the
      // single-item path; `reconcilePendingQuantityAcks` resolves the
      // already-persisted queued/accepted rows to succeeded/failed later.
      for (const item of items) {
        succeeded.push(item.offerId);
      }
    } catch (error) {
      this.logger.error(
        `Failed to submit Allegro batch offer quantity command (offers=${items.length}, connection: ${this.connectionId}): ${(error as Error).message}`,
        error
      );
      for (const item of items) {
        failed.push({
          offerId: item.offerId,
          errorCode: 'transport-error',
          message: (error as Error).message,
        });
      }
    }
  }

  /**
   * Best-effort per-offer command-record creation for a batch group (#2622
   * review). `updateOfferQuantity`'s single-item path persists one row per
   * command via `commandRepository.create`; a batch command covers several
   * offers under one Allegro commandId, so this persists one row PER OFFER
   * against that same commandId — the widened (commandId, offerId) unique
   * index (see the migration) is what makes that possible. Never throws:
   * losing observability must never sink a batch that Allegro itself accepted.
   */
  private async persistBatchCommandRows(
    commandId: string,
    allegroStatus: 'QUEUED' | 'ACCEPTED' | 'REJECTED',
    items: UpdateOfferQuantityCommand[]
  ): Promise<void> {
    if (!this.commandRepository) {
      return;
    }
    const status = this.mapAllegroCommandStatus(allegroStatus);
    await Promise.all(
      items.map(async (item) => {
        try {
          const command = AllegroQuantityCommand.create(
            commandId,
            this.connectionId,
            item.offerId,
            item.quantity,
            status
          );
          await this.commandRepository?.create(command);
        } catch (persistError) {
          this.logger.warn(
            `Failed to persist batch offer quantity command row (commandId: ${commandId}, offerId: ${item.offerId}): ${(persistError as Error).message}`
          );
        }
      })
    );
  }

  /**
   * Best-effort per-offer status update for a batch group (#2622 review).
   * Mirrors `pollAndUpdateCommandStatus`'s persistence, but disambiguated by
   * (commandId, offerId) since one batch commandId can back several rows.
   */
  private async persistBatchOfferStatus(
    commandId: string,
    offerId: string,
    status: 'succeeded' | 'failed',
    error?: string | null
  ): Promise<void> {
    if (!this.commandRepository) {
      return;
    }
    try {
      await this.commandRepository.updateOfferStatus(commandId, offerId, status, error);
    } catch (persistError) {
      this.logger.warn(
        `Failed to persist batch offer quantity command status (commandId: ${commandId}, offerId: ${offerId}): ${(persistError as Error).message}`
      );
    }
  }

  /**
   * Joins Allegro's `{code, message}` error list into one string, or
   * returns `undefined` when there is nothing to report — including when
   * `errors` is present but empty, so callers can safely `?? fallback`
   * without a defined-but-empty string masking it (#2622 review).
   */
  private formatAllegroTaskErrors(errors: AllegroTaskError[] | undefined): string | undefined {
    if (!errors || errors.length === 0) {
      return undefined;
    }
    return errors.map((e) => `${e.code}: ${e.message}`).join('; ');
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

    // #2024: price + available quantity read off this SAME fetched offer
    // (identical fields `getOffer` maps below) - no second per-offer call.
    const commercial = this.toCommercialObservation(offer);

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

    return { publicationStatus, validationErrors, commercial };
  }

  /**
   * Read-only projection of price + available quantity off an already-fetched
   * AllegroProductOffer (#2024). Each axis reports null independently when the
   * response omits it - never fabricated as zero, since a persisted 0 is
   * indistinguishable from a genuine sell-out (or a free item) at list scale.
   * getOffer's stricter contract, which treats a missing price as a malformed
   * payload, is unchanged; this read tolerates absence instead of throwing.
   *
   * The field guards match the Erli side's discipline because both read untyped
   * wire JSON: an amount without a currency would persist unlabeled money (the
   * service stores a real number next to a `null` currency), and
   * `typeof x === 'number'` alone admits `Infinity`, which `JSON.parse` really
   * does produce from a `1e999` literal. Allegro's amount arrives as a string,
   * so it is finite-checked after coercion too - Postgres `numeric` accepts the
   * literal `'NaN'`, which would then render as a real reading rather than as
   * "not reported".
   */
  private toCommercialObservation(offer: AllegroProductOffer): OfferCommercialObservation {
    const amount = offer.sellingMode?.price?.amount;
    const currency = offer.sellingMode?.price?.currency;
    const available = offer.stock?.available;
    const hasUsablePrice =
      typeof amount === 'string' &&
      amount.length > 0 &&
      Number.isFinite(Number(amount)) &&
      typeof currency === 'string' &&
      currency.length > 0;
    return {
      price: hasUsablePrice ? { amount, currency } : null,
      availableQuantity:
        typeof available === 'number' && Number.isFinite(available) ? available : null,
    };
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
      marketplaceUrl: this.buildMarketplaceUrl(offer),
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
   *
   * Canonical shape is `/oferta/{slug}-{offerId}`; the numeric id suffix is
   * what resolves, the slug is cosmetic (Allegro 301s to the canonical slug),
   * so a stale/mismatched slug is safe. When the offer carries no name we fall
   * back to the id-only `/oferta/{offerId}` form.
   */
  private buildMarketplaceUrl(offer: AllegroProductOffer): string | undefined {
    if (!this.storefrontBaseUrl) {
      return undefined;
    }
    const base = `${this.storefrontBaseUrl.replace(/\/+$/, '')}/oferta`;
    const slug = slugify(offer.name ?? '');
    return slug ? `${base}/${slug}-${offer.id}` : `${base}/${offer.id}`;
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
   * Fetch a single category node (`GET /sale/categories/{id}`, not its
   * children), returning Allegro's native shape verbatim. Cached under a global
   * namespace when a cache is wired — a category node is immutable public
   * taxonomy — so repeat breadcrumb walks that share an ancestor hit the cache.
   * 404 surfaces as an `AllegroApiException` the caller maps to a neutral
   * not-found.
   */
  private async fetchCategoryByIdRaw(categoryId: string): Promise<AllegroCategoryResponse> {
    const cacheKey = `${CATEGORY_NODE_CACHE_PREFIX}${categoryId}`;
    if (this.cache) {
      const cached = await this.cache.get<AllegroCategoryResponse>(cacheKey);
      if (cached) {
        return cached;
      }
    }
    const response = await this.httpClient.get<AllegroCategoryResponse>(
      `/sale/categories/${categoryId}`
    );
    if (this.cache) {
      await this.cache.set(cacheKey, response.data, this.catParamsTtlSec);
    }
    return response.data;
  }

  /**
   * `CategoryPathReader.fetchCategoryPath` — resolve `categoryId` to its full
   * breadcrumb ordered root -> leaf. Walks up the tree via each node's
   * `parent.id`, one `GET /sale/categories/{id}` per ancestor (nodes are cached
   * in `fetchCategoryByIdRaw`); a depth cap + a `seen` set guard against a
   * malformed/cyclic parent chain. 404 on the requested leaf (the first hop)
   * maps to the neutral `CategoryNotFoundException`; a 404 on an *ancestor*
   * returns the partial breadcrumb resolved so far rather than discarding it.
   */
  async fetchCategoryPath(categoryId: string): Promise<CategoryPathSegment[]> {
    this.logger.debug(
      `Fetching Allegro category path (connection: ${this.connectionId}, categoryId: ${categoryId})`
    );
    const segments: CategoryPathSegment[] = [];
    const seen = new Set<string>();

    let currentId: string | null = categoryId;
    for (let depth = 0; currentId && depth < MAX_CATEGORY_PATH_DEPTH; depth += 1) {
      if (seen.has(currentId)) {
        // Defensive: a cyclic parent chain should never happen, but stop
        // rather than loop.
        break;
      }
      seen.add(currentId);

      let node: AllegroCategoryResponse;
      try {
        node = await this.fetchCategoryByIdRaw(currentId);
      } catch (err) {
        if (err instanceof AllegroApiException && err.statusCode === 404) {
          // The requested leaf not existing is a genuine not-found; an ancestor
          // vanishing mid-walk just truncates the breadcrumb — keep what we have.
          if (depth === 0) {
            throw new CategoryNotFoundException(currentId, 'allegro');
          }
          break;
        }
        throw err;
      }

      // Prepend so the result stays root -> leaf.
      segments.unshift({ id: node.id, name: node.name });
      currentId = node.parent?.id ?? null;
    }

    return segments;
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
    return resolveCategoriesForBatchByEan(this.httpClient, this.cache, this.connectionId, input, {
      // The batch default stays narrower than the streamed one (#2215), but it
      // goes through the same clamp so the operator's `maxConcurrent` binds on
      // every resolve path rather than only the one that reports itself (#2229).
      concurrency: resolveBatchConcurrency(this.configuredMaxConcurrent).maxInFlight,
    });
  }

  /**
   * EanCategoryMatcherStreaming.streamCategoriesForBatchByEan (#2208).
   *
   * Same delegation as the batch sibling above, onto the generator the batch
   * method itself collects over - so per-item cache, GTIN re-filter and
   * no-throw semantics are one implementation, not two.
   */
  streamCategoriesForBatchByEan(
    input: BatchCategoryByEanInput,
    options?: EanCategoryMatchStreamOptions
  ): AsyncIterable<EanCategoryMatchStreamItem> {
    return streamCategoriesForBatchByEan(this.httpClient, this.cache, this.connectionId, input, {
      // Resolved, never the bare constant: the operator's own `maxConcurrent`
      // clamps the ceiling, and `getStreamConcurrency` below reports whatever
      // this same call computes (#2229).
      concurrency: resolveStreamConcurrency(this.configuredMaxConcurrent).maxInFlight,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  /**
   * EanCategoryMatcherStreaming.getStreamConcurrency (#2229).
   *
   * Reports the ceiling the method above actually enforces - same function,
   * same input - so the number an operator reads on the connection page cannot
   * drift from the number that paces their resolve run.
   */
  getStreamConcurrency(): ResolveConcurrencyCeiling {
    return resolveStreamConcurrency(this.configuredMaxConcurrent);
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

    // #2249 — propagate a rate change onto the live offer. An unmappable code is
    // DROPPED rather than raising, unlike on the create path: a create that
    // cannot state its tax must not happen at all, while an update that cannot
    // is a partial update of an offer that already exists and already sells, and
    // raising would take a title or price fix down with it. The category's
    // permitted-values check is not repeated here - Allegro validates the PATCH
    // itself, and a second discovery call per update would double the request
    // count on the hot path.
    if (cmd.fields.taxRate !== undefined) {
      const rate = toAllegroRate(cmd.fields.taxRate);
      if (rate === null) {
        this.logger.warn(
          `Allegro offer tax settings carry a numeric rate, so "${cmd.fields.taxRate}" cannot be ` +
            `patched; leaving the offer's rate unchanged: offerId=${cmd.externalOfferId} ` +
            `connection=${this.connectionId}`
        );
      } else {
        // Same exact-string rule as the create path (#2249). No permitted-values
        // read here - this is the hot update path and Allegro validates the
        // PATCH itself - so the two-decimal fallback is what goes on the wire.
        callerBody.taxSettings = {
          rates: [
            { rate: formatAllegroRate(rate, []), countryCode: DEFAULT_ALLEGRO_TAX_COUNTRY },
          ],
        };
      }
    }

    if (cmd.fields.description !== undefined) {
      callerBody.description = {
        sections: cmd.fields.description.sections.map((section) => ({
          items: section.items.map((item) => ({
            type: item.type,
            // ADR-046: core applied the destination's declared format before
            // dispatch (`formatOfferFieldsForDestination`), so the content
            // arrives already shaped. The adapter deliberately keeps no
            // defensive second pass - two sources of truth drift, and the
            // previous adapter-local regex is exactly how the wrong allowlist
            // shipped.
            content: item.content,
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
  /**
   * `AdapterSuppliedParametersReader` (#1934/F1). "Stan" is a REQUIRED
   * offer-section parameter in effectively every Allegro category, and this
   * adapter synthesises it from the neutral `command.condition` (which the
   * builder always sets) - so the builder's gate must not reject an offer for
   * "missing" it. Declared here because the neutral -> wire id mapping is the
   * adapter's; core has no business knowing that 11323 means condition.
   */
  getAdapterSuppliedParameterIds(
    cmd: Pick<CreateOfferCommand, 'condition'>,
  ): readonly string[] {
    return cmd.condition !== undefined ? [ALLEGRO_CONDITION_PARAMETER_ID] : [];
  }

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

    // #1934/F11 — preflight: the offer title must fit Allegro's 75-char limit.
    // The request DTO's `@MaxLength(75)` only ever sees a title the operator
    // SUBMITTED as an override; a row nobody opened carries none, and the
    // builder then falls back to `product.name`, which no OL layer measures.
    // A routine long PrestaShop name therefore reached Allegro unchecked and
    // came back as an opaque platform validation error. Reject it here, with
    // the actual length, so the failure names the field and the fix.
    // Measured AFTER sanitisation, matching what actually goes on the wire -
    // sanitising can only shorten, so checking the raw value would reject a
    // title that ends up within the limit.
    const offerTitle = sanitizeAllegroName(cmd.overrides?.title ?? '');
    if (offerTitle.length > ALLEGRO_OFFER_TITLE_MAX_LENGTH) {
      throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, [
        {
          field: 'title',
          code: 'TITLE_TOO_LONG',
          message: `Allegro offer titles are limited to ${ALLEGRO_OFFER_TITLE_MAX_LENGTH} characters; this one is ${offerTitle.length}. Set a shorter title on the offer (the product name is used when no title override is given).`,
        },
      ]);
    }

    // #2249 (ADR-063) — preflight the tax rate BEFORE anything is created.
    // Allegro's own tax settings are what make an order line report a rate at
    // all: OL wrote nothing here until this epic, so every offer it published
    // produced `tax: null` on purchase. Resolved up front so a refusal costs no
    // image upload and no product card.
    const taxSettings = await this.resolveTaxSettings(cmd);

    // #431 — smart-link pre-step. Compute once at the top so the body
    // builder + platform-params applier stay synchronous (their current
    // contract). On `unique`, `productSet[0]` becomes a card-link reference
    // and Allegro inherits GPSR + parameters from the card; otherwise we
    // fall through to inline (which uses the seller-defaults checked above).
    const cardLinkResult = await this.maybeResolveProductCard(cmd);

    const body = this.buildCreateOfferRequest(cmd, cardLinkResult);
    if (taxSettings) {
      body.taxSettings = taxSettings;
    }

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
    // Report Allegro's own publication status so core can persist a status
    // snapshot without waiting for the hourly scan (#2039). Only when the
    // response actually carried one: `mapAllegroPublicationStatus` defaults an
    // absent value to `'inactive'`, which is the right *read-path* fallback but
    // would be a guess here — and a guessed `inactive` reads as a rejected
    // offer. Absent ⇒ omit the field ⇒ core writes no row.
    if (response.publication?.status !== undefined) {
      result.publicationStatus = this.mapAllegroPublicationStatus(response.publication.status);
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
      // ADR-046: already shaped by core. The emptiness check that used to live
      // here moved with it - `formatDescriptionForDestination` returns
      // undefined when nothing survives, so an empty description never reaches
      // this branch at all.
      const shaped = cmd.overrides.description.trim();
      if (shaped.length > 0) {
        body.description = {
          sections: [
            {
              items: [{ type: 'TEXT', content: shaped }],
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
   * Resolve the offer's `taxSettings` from the neutral command rate (#2249).
   *
   * Three refusals, and each names what the operator can act on. Publishing
   * with the rate silently omitted is precisely how the rate-less offers this
   * epic exists to fix were produced, and the failure it causes surfaces months
   * later on somebody's invoice rather than here.
   *
   * The first refusal - no rate at all - is gated on
   * `OL_TAX_RATE_STRICT_ENABLED` (#2245 review). Catalogue coverage is zero on
   * deploy, so refusing every rate-less publish on day one fails every child of
   * every bulk batch with no badge, no counter and no held state to read it
   * from. With the switch off the offer publishes with no `taxSettings`, byte
   * for byte as it did before this epic. The other two refusals are NOT gated:
   * they mean the shop DID name a rate and Allegro cannot carry that exact
   * value, which is a real conflict at any coverage level.
   *
   * - **No rate at all.** The shop does not know, and Allegro is not going to
   *   invent one either. The remedy is in the shop's catalogue.
   * - **An exemption code.** `taxSettings.rates[]` carries numbers, so `zw` /
   *   `np` / `oo` cannot be expressed. Publishing without them would list a
   *   product at the category's default rate, which is a different sale.
   * - **A rate the category refuses.** `GET /sale/tax-settings` lists what the
   *   category allows; when OpenLinker's value is not among them the shop
   *   record is almost certainly the wrong one, so the error names the
   *   permitted values rather than picking one.
   *
   * The permitted-values read is best-effort: a failure to LIST is not a
   * failure to publish, so it warns and proceeds with the value the shop gave.
   * Allegro validates the body itself, and refusing a publish because a
   * secondary discovery call was unavailable would be worse than the check.
   */
  private async resolveTaxSettings(
    cmd: CreateOfferCommand,
  ): Promise<{ rates: Array<{ rate: string; countryCode: string }> } | undefined> {
    const categoryId = cmd.overrides?.categoryId;
    const countryCode = cmd.taxRateCountry ?? DEFAULT_ALLEGRO_TAX_COUNTRY;

    if (!cmd.taxRate) {
      if (!isTaxRateStrictEnabled()) {
        this.logger.warn(
          `Publishing an Allegro offer with no tax rate because ` +
            `OL_TAX_RATE_STRICT_ENABLED is off. The resulting offer states no tax, so the ` +
            `orders it produces will carry no rate either. Add the rate in the shop's ` +
            `catalogue and re-sync the product.`,
        );
        return undefined;
      }
      throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, [
        {
          field: 'taxRate',
          code: 'TAX_RATE_MISSING',
          message:
            `No tax rate is known for this product, so the offer cannot state what tax it ` +
            `charges. Add the rate in the shop's catalogue and re-sync the product; ` +
            `OpenLinker does not substitute one.`,
        },
      ]);
    }

    const rate = toAllegroRate(cmd.taxRate);
    if (rate === null) {
      throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, [
        {
          field: 'taxRate',
          code: 'TAX_RATE_NOT_EXPRESSIBLE',
          message:
            `Allegro offer tax settings carry a numeric rate, so the exemption code ` +
            `"${cmd.taxRate}" cannot be published. Set a numeric rate on the product in the ` +
            `shop, or list it on a channel that supports the exemption.`,
        },
      ]);
    }

    const permitted = await this.fetchPermittedTaxRates(categoryId, countryCode);
    if (
      permitted !== null &&
      permitted.length > 0 &&
      !permitted.some((entry) => entry.numeric === rate)
    ) {
      throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, [
        {
          field: 'taxRate',
          code: 'TAX_RATE_NOT_ALLOWED_IN_CATEGORY',
          message:
            `This Allegro category does not allow a ${String(rate)}% rate in ${countryCode}. ` +
            `Allowed: ${permitted.map((entry) => `${entry.wire}%`).join(', ')}. ` +
            `The shop's rate for this product is most likely the one to correct.`,
        },
      ]);
    }

    // The wire value is Allegro's own published string where we have it (#2249):
    // the API matches it against the seller's VAT settings exactly, so a bare
    // `23` is refused where `"23.00"` is accepted.
    return { rates: [{ rate: formatAllegroRate(rate, permitted ?? []), countryCode }] };
  }

  /**
   * What rates the category allows, or `null` when the listing could not be
   * read. `null` is deliberately distinct from `[]`: an empty list means
   * Allegro answered and named none, which is not a reason to block.
   */
  private async fetchPermittedTaxRates(
    categoryId: string | undefined,
    countryCode: string,
  ): Promise<PermittedTaxRate[] | null> {
    if (!categoryId) return null;
    try {
      const response = await this.httpClient.get<AllegroTaxSettingsResponse>(
        '/sale/tax-settings',
        { queryParams: { 'category.id': categoryId, countryCode } },
      );
      // Verified against the live sandbox (#2249). The parsing is a pure,
      // spec-pinned function because the first version of it was a guess about
      // the response shape and was silently wrong.
      return readPermittedTaxRates(response.data.rates, countryCode);
    } catch (error) {
      this.logger.warn(
        `Could not read Allegro tax settings for category ${categoryId} (${countryCode}); ` +
          `publishing with the shop's rate and letting Allegro validate: ` +
          `${(error as Error).message}`,
      );
      return null;
    }
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
    // `body.name` (the offer title) — MVP coupling, revisited by the smart-link
    // follow-up (#412). The ≤75-char guarantee comes from the explicit
    // preflight in `createOffer`, NOT from the request DTO: that only validates
    // an operator-SUBMITTED title override, and the builder's `product.name`
    // fallback used to reach here unmeasured (#1934/F11).
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
   * Uses exponential backoff: 2s initial, 2x multiplier, 30s max, 5 attempts
   * by default. `overrides` lets a caller that already paces its own retries
   * (the reconcile sweep, driven by its own scheduled cadence) ask for a
   * single, immediate check instead of layering a second backoff loop on
   * top of the sweep's own — see `reconcileOneQuantityCommand`.
   */
  private async pollQuantityCommandStatus(
    commandId: string,
    overrides?: Partial<QuantityPollConfig>
  ): Promise<AllegroQuantityChangeCommandStatusResponse | null> {
    const { maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier } = {
      ...this.quantityPollConfig,
      ...overrides,
    };

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
   * Reconciles up to `limit` of this connection's outstanding
   * asynchronously-acknowledged quantity commands (#2621) — the "confirm
   * later" half of `updateOfferQuantity`, which returns as soon as Allegro
   * acknowledges submission rather than waiting for a terminal status.
   *
   * Never throws for an individual command's outcome — a genuinely failed
   * command is persisted as `'failed'` and counted, not raised, since there
   * is no caller left waiting to catch it. Only a whole-pass infrastructure
   * error (e.g. the repository itself failing) propagates.
   */
  async reconcilePendingQuantityAcks(limit: number): Promise<PendingQuantityAckReconcileResult> {
    if (!this.commandRepository) {
      return { reconciled: 0, stillPending: 0 };
    }

    const perStatusLimit = Math.max(1, Math.ceil(limit / 2));
    const [queued, accepted] = await Promise.all([
      this.commandRepository.find({
        connectionId: this.connectionId,
        status: 'queued',
        limit: perStatusLimit,
      }),
      this.commandRepository.find({
        connectionId: this.connectionId,
        status: 'accepted',
        limit: perStatusLimit,
      }),
    ]);
    const pending = [...queued, ...accepted].slice(0, limit);

    let reconciled = 0;
    let stillPending = 0;

    await Promise.all(
      pending.map(async (command) => {
        const outcome = await this.reconcileOneQuantityCommand(command);
        if (outcome === 'pending') {
          stillPending += 1;
        } else {
          reconciled += 1;
        }
      })
    );

    return { reconciled, stillPending };
  }

  /**
   * Checks one outstanding command's CURRENT status with a single, immediate
   * request — deliberately not the multi-attempt backoff
   * `pollQuantityCommandStatus` otherwise uses (`maxAttempts: 1,
   * initialDelayMs: 0`). This runs inside a periodic reconcile sweep whose
   * own cadence already supplies the wait; layering the write-path's
   * "wait-a-bit-right-after-submit" backoff on top would reintroduce, inside
   * the sweep, the exact per-write blocking cost #2621 removed from
   * `updateOfferQuantity`. A `null` (or still-non-terminal) result reports
   * `'pending'` and touches nothing — retried by the NEXT scheduled pass, so
   * a command Allegro is simply slow to process is never marked failed on a
   * fluke.
   *
   * `result.tasks` covers every offer named in the (possibly batched, #2622)
   * Allegro command sharing `command.commandId` — this row's own
   * `command.offerId` is looked up within it and persisted via
   * `updateOfferStatus(commandId, offerId, …)`, never the commandId-only
   * `updateStatus`, which would resolve an arbitrary row sharing that
   * commandId rather than the one this call is actually about.
   */
  private async reconcileOneQuantityCommand(
    command: AllegroQuantityCommand
  ): Promise<'succeeded' | 'failed' | 'pending'> {
    const result = await this.pollQuantityCommandStatus(command.commandId, {
      maxAttempts: 1,
      initialDelayMs: 0,
    });

    if (!result) {
      return 'pending';
    }

    const task = result.tasks?.find((t) => t.offerId === command.offerId);

    if (task?.status === 'FAIL') {
      const errorMessage = this.formatAllegroTaskErrors(task.errors) ?? task.message ?? 'unknown';

      try {
        await this.commandRepository?.updateOfferStatus(
          command.commandId,
          command.offerId,
          'failed',
          errorMessage
        );
      } catch (persistError) {
        this.logger.warn(
          `Failed to persist command failure status (commandId: ${command.commandId}, offerId: ${command.offerId}): ${(persistError as Error).message}`
        );
      }

      this.logger.warn(
        `Allegro quantity command ${command.commandId} failed for offer ${command.offerId} (connection: ${this.connectionId}): ${errorMessage}`
      );
      return 'failed';
    }

    if (task?.status !== 'SUCCESS') {
      // Not yet terminal for THIS offer (or the group's terminal response
      // never named it) — retried by the next scheduled reconcile pass.
      return 'pending';
    }

    try {
      await this.commandRepository?.updateOfferStatus(
        command.commandId,
        command.offerId,
        'succeeded'
      );
    } catch (persistError) {
      this.logger.warn(
        `Failed to persist command success status (commandId: ${command.commandId}, offerId: ${command.offerId}): ${(persistError as Error).message}`
      );
    }

    this.logger.debug(
      `Allegro quantity command ${command.commandId} confirmed SUCCESS during reconcile (connection: ${this.connectionId}, offerId: ${command.offerId})`
    );
    return 'succeeded';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
