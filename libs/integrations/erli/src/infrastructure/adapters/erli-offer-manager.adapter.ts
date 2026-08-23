/**
 * Erli Offer Manager Adapter
 *
 * Implements `OfferManagerPort` + `OfferCreator` + `OfferFieldUpdater` against
 * Erli's single seller-keyed product resource (#984):
 *   - createOffer        → POST  /products/{externalId}
 *   - updateOfferFields  → PATCH /products/{externalId} (sparse)
 *   - updateOfferQuantity→ PATCH /products/{externalId} (sparse, stock only)
 *
 * Async write model (ADR-025): Erli returns HTTP 202 (validated + stored,
 * ~20-min cache lag — no read-after-write). A 202/2xx create maps to
 * `CreateOfferResult.status = 'draft'` (submitted, not confirmed — it does NOT
 * schedule the Allegro-tuned creation poll, whose 404-is-terminal + ~9.5-min
 * budget collide with Erli's ~20-min lag; review #1063). Publication is instead
 * reconciled by the steady-state `erli-offer-status-sync` scheduler task, which
 * reads the real Erli status back via this adapter's `OfferStatusReader.getOfferStatus`
 * (#989) into `offer_status_snapshots` — never trusting the 202 as confirmation.
 *
 * Category/parameter reuse (#985): the create body carries `externalCategories`
 * + `externalAttributes` tagged `source:"allegro"`, built from the already-
 * resolved Allegro ids riding on the command (`overrides.categoryId` + the
 * neutral section-tagged `cmd.parameters`, #1071). Erli processes only the ids
 * (ADR-025 §3); no Erli-native taxonomy authoring. Applies to the create path
 * only — `buildPatchFromFields` is untouched.
 *
 * Frozen-field ownership (#988, ADR-025 §4b): Erli marks seller-panel manual
 * edits `frozen`; OL must not overwrite them. `updateOfferFields` reads the
 * current product (`fetchErliProduct`) and DROPS any supplied field whose Erli
 * frozen-name reads `frozen[<erliName>] === true` before issuing the PATCH
 * (per-nested-field granularity); an all-frozen update issues no PATCH.
 *
 * Frozen-`stock` on the hot path (#1066, ADR-025 §4b): `updateOfferQuantity`
 * runs on every inventory tick and deliberately does NOT pre-fetch — a per-tick
 * GET would double the tick's API calls. Frozen-`stock` is instead honored via a
 * per-offer cache flag populated by the steady-state `erli-offer-status-sync`
 * reconciliation (#989), which already GETs each mapped offer and sees
 * `frozen`. `getOfferStatus` (and opportunistically `updateOfferFields`)
 * writes that flag; `updateOfferQuantity` reads it and skips the stock PATCH when
 * set. A cache miss fails OPEN (push), preserving the pre-#1066 behaviour when the
 * flag is unknown. The honoring holds from the first reconciliation pass onward;
 * a freeze landing between ticks is overwritten once until the next pass — the
 * reconciliation-first / eventual-consistency posture of ADR-025 §1 (window
 * bounded by the cron cadence, not the cache TTL).
 *
 * The PRIMARY cache writer, the `erli-offer-status-sync` reconciliation, runs by
 * DEFAULT since #2230 (it was opt-in / default-OFF under review #1063, which left
 * frozen-stock effectively unhonored out of the box because `updateOfferFields`
 * was then the only active writer). A deployment that sets
 * `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=false` re-enters that state: most
 * offers never get a cached flag and `updateOfferQuantity` fails open (pushes).
 *
 * Stock-restore-on-cancel (#997 Half B / ADR-025 §4a, wired by #1146): the
 * MECHANISM lands here as `restoreStockOnCancellation` (the #1146
 * `OfferStockRestorer` capability) — Erli auto-decrements stock on purchase but
 * does NOT restore it on cancellation, so OL issues the compensating write. Core
 * resolves the ABSOLUTE target from OL master inventory and passes plain
 * `OfferStockRestoreTarget[]`; the adapter sets each via the absolute-set
 * `updateOfferQuantity` — it NEVER reads back Erli stock and increments (Erli's
 * ~20-min cache lag would double-count under retry).
 *
 * LIVE TRIGGER (#1146): the core `OrderIngestionService` cancellation-observe
 * hook enqueues a `marketplace.offer.stockRestore` job; its worker handler
 * narrows the connection's adapter to `OfferStockRestorer` and calls here.
 *
 * Variant grouping (#986 emit half, #1065 core populator): the create body
 * carries `externalVariantGroup` (the parent/base product id shared by sibling
 * variants) + per-variant `attributes` when the command carries the neutral,
 * core-populated `cmd.variantGroup` (`OfferBuilderService` stamps it for a
 * sibling of a multi-variant product — #1065). Single/simple products omit it
 * and list ungrouped. The adapter MAPS the neutral `variantGroup` to Erli's wire
 * shape (`groupId` → `externalVariantGroup.id`; `attributes` field-for-field) —
 * no erli-named key lives in core. `externalVariantGroup.id` is BODY-ONLY: it is
 * the parent product id (`ol_product_*`), a different shape from the variant id
 * the path pattern enforces, so it MUST never be routed through `productPath()`
 * or any path-building helper (#992 must not promote it to a path component).
 * Create-path only; `buildPatchFromFields` never emits grouping.
 *
 * Out of scope (own issues, marked seams): master-price → offer propagation (no
 * core trigger today), offer-status reconciliation #989.
 *
 * Allegro category-catalog browsing (#1383, ADR-031): a connection that
 * configured Allegro app credentials (`allegroClientId`/`allegroClientSecret`,
 * #1382) gets `fetchCategories`/`fetchCategoryParameters` wired as OPTIONAL
 * INSTANCE properties in the constructor, delegating to the shared
 * `AllegroCategoryCatalogClient`. This class deliberately does NOT declare
 * `CategoryBrowser`/`CategoryParametersReader` in its `implements` clause —
 * doing so would make every Erli connection advertise the capability
 * regardless of whether Allegro credentials are configured, which would both
 * misreport per-connection support and regress the #1367 bulk-wizard
 * capability gate (`connection.supportedCapabilities.includes('CategoryBrowser')`
 * for connections that never configured Allegro credentials). Runtime callers
 * narrow with `isCategoryBrowser`/`isCategoryParametersReader`
 * (`typeof adapter.fetchCategories === 'function'`), which correctly reflects
 * per-instance wiring instead of a static class capability. See ADR-031
 * "Alternatives considered" for why the static-implements approach was
 * rejected.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link OfferManagerPort}
 */
import {
  type DescriptionFormat,
  OfferCreateRejectedException,
  OfferNotFoundOnMarketplaceException,
  type CategoryParameter,
  type CreateOfferCommand,
  type CreateOfferResult,
  type CreateOfferValidationError,
  type DeliveryPriceList,
  type DeliveryPriceListReader,
  type MarketplaceOffer,
  type OfferCategory,
  type OfferCommercialObservation,
  type OfferCondition,
  type OfferCreator,
  type OfferDescriptionUpdate,
  type OfferFieldUpdate,
  type OfferFieldUpdater,
  type OfferManagerPort,
  type OfferReader,
  type OfferStatusReadResult,
  type OfferStatusReader,
  type OfferStockRestorer,
  type OfferStockRestoreTarget,
  type ResponsibleProducerEntry,
  type ResponsibleProducerReader,
  type TaxonomyBorrower,
  type TaxonomyOwner,
  type UpdateOfferFieldsCommand,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import { supportedErliTaxRates, toErliTaxRate } from './erli-tax-rate.mapper';
import { isTaxRateStrictEnabled } from '@openlinker/core/sales-documents';

import { ERLI_DESCRIPTION_FORMAT } from './erli-description-format';
import type { CachePort } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';
import { ErliApiException } from '../../domain/exceptions/erli-api.exception';
import { ErliConfigException } from '../../domain/exceptions/erli-config.exception';
import { ERLI_PRODUCT_ID_PATTERN, erliProductPath } from '../../erli.constants';
import type {
  AllegroCatalogEnvironment,
  ErliDispatchTime,
} from '../../domain/types/erli-connection.types';
import type { AllegroCategoryCatalogClient } from '../http/allegro-category-catalog-client';
import type { IErliHttpClient } from '../http/erli-http-client.interface';
import type {
  ErliDeliveryPriceListItem,
  ErliExternalAttribute,
  ErliExternalCategory,
  ErliProductCreateBody,
  ErliProductImage,
  ErliProductPatchBody,
  ErliProductResource,
  ErliResponsibleProducerItem,
} from './erli-product.types';

/** Erli prices are PLN-only integers in minor units (grosze) — no currency field on the wire. */
const ERLI_CURRENCY = 'PLN';

/**
 * Maps OL patch-body keys to the Erli field name keyed in
 * {@link ErliProductResource.frozen} (#988, ADR-025 §4b). Only the keys a
 * field-update can supply are listed; an unmapped key is never treated as frozen.
 * The verified wire shape (#1737) is a `frozen` object — a field is frozen iff
 * `frozen[<erliName>] === true`. This map is the single change point for the
 * OL-key → Erli-name mapping.
 */
// OL patch-key → Erli frozen-object key name (#1737 verified shape). `stock` is
// intentionally absent from THIS map: it drives `dropFrozenFields` on the
// field-update path, which reads live `frozen` per call — the quantity path
// doesn't read live frozen state. Frozen `stock` IS honored (#1066, ADR-025 §4b),
// but via the separate cache-flag check in `updateOfferQuantity` (see
// {@link ERLI_FROZEN_STOCK_FIELD}), not this map.
const PATCH_KEY_TO_ERLI_FROZEN_NAME: Partial<Record<keyof ErliProductPatchBody, string>> = {
  price: 'price',
  name: 'name',
  description: 'description',
  // #2249: Erli sets `frozen.taxRate` the moment the seller edits the field in
  // their panel. That is the signal a PERSON chose the value, so OL skips the
  // write - and `force` stays deliberately unused, because overriding a
  // deliberate human tax decision is the one write worth getting wrong least.
  taxRate: 'taxRate',
};

/**
 * Erli `frozen`-object key name for stock (#1066, ADR-025 §4b). Read during
 * reconciliation (`frozen.stock === true`) to populate the per-offer frozen-stock
 * cache flag the hot `updateOfferQuantity` path reads. Colocated with
 * {@link PATCH_KEY_TO_ERLI_FROZEN_NAME} (the same #1737-verified wire vocabulary):
 * if the wire name changes, this is the single change point alongside that map.
 */
const ERLI_FROZEN_STOCK_FIELD = 'stock';

/**
 * Erli condition ("Stan") parameter id and its dictionary value ids (#1500).
 * Erli borrows Allegro's taxonomy (ADR-025 §3), so condition rides as the Allegro
 * "Stan" parameter (`11323`) with the same dictionary value id (`11323_1` = new,
 * `11323_2` = used), emitted `source:"allegro"`. The adapter owns this neutral →
 * wire mapping; core carries only the neutral `CreateOfferCommand.condition`.
 */
const ERLI_CONDITION_PARAMETER_ID = '11323';
const ERLI_CONDITION_VALUE_IDS: Record<OfferCondition, string> = {
  new: '11323_1',
  used: '11323_2',
};

/**
 * Frozen-stock cache TTL (#1066). Sized for the WORST-case reconciliation cadence
 * (an operator who loosens the reconciliation cron `ERLI_OFFER_STATUS_SYNC_CRON` in
 * erli-scheduler-tasks.ts from hourly to daily) — so it must exceed 24h. The
 * eventual-consistency window is bounded by the cron cadence (the flag is re-asserted
 * every reconciliation tick), not this TTL; the TTL only governs self-healing once
 * reconciliation STOPS. If that cron default changes, re-evaluate this constant in
 * lockstep.
 */
export const ERLI_FROZEN_STOCK_CACHE_TTL_SEC = 26 * 60 * 60;

/**
 * Responsible-producer cache TTL (#1531). The wizard reads this on each
 * offer-create load; a short TTL keeps repeated loads off the Erli API without
 * letting a newly-added producer stay hidden for long. Mirrors the ~10-min
 * freshness the seller-policies read uses.
 */
export const ERLI_RESPONSIBLE_PRODUCERS_CACHE_TTL_SEC = 10 * 60;

/**
 * Delivery-price-list cache TTL (#1530). The wizard reads this on each offer-create
 * load; a short TTL keeps repeated loads off the Erli API without letting a
 * newly-added price list stay hidden for long. Mirrors the ~10-min freshness the
 * seller-policies read uses.
 */
export const ERLI_DELIVERY_PRICE_LISTS_CACHE_TTL_SEC = 10 * 60;

export class ErliOfferManagerAdapter
  implements
    OfferManagerPort,
    OfferCreator,
    OfferFieldUpdater,
    OfferReader,
    OfferStatusReader,
    OfferStockRestorer,
    TaxonomyBorrower,
    ResponsibleProducerReader,
    DeliveryPriceListReader
{
  /**
   * Connections already told that their Erli tax rate is seller-frozen (#2249).
   * A module-level `Set` on the instance rather than a per-call log, so one
   * deliberate seller decision is reported once instead of on every propagation.
   */
  private readonly frozenTaxRateReported = new Set<string>();

  private readonly logger = new Logger(ErliOfferManagerAdapter.name);

  /**
   * Erli accepts nine tags, PUBLISHED in its own API doc
   * (`erli.pl/svc/shop-api/doc/`, sections "Opisy" and "Opisy HTML"):
   * "W elemencie tekstowym można wykorzystywać wyłącznie określone znaczniki
   * HTML". Attributes forbidden, headings unformatted. Differences from
   * Allegro: `h3` is allowed, and `<br/>` is allowed but MUST be
   * self-closing - a bare `<br>` is not. The doc states no length limit; the
   * swagger says 80 000 characters, declared here as bytes with that caveat.
   *
   * Why declare a format at all when Erli never rejects: the same doc
   * describes a second path - "HTML przesłany w polu description jako tekst
   * nie ma żadnych ograniczeń wobec przesyłanych znaczników i obrazków. Po
   * przesłaniu zostanie skonwertowany do opisanej powyżej struktury" - warning
   * that the result "będzie wyglądał inaczej" and that images end up alone,
   * each in a new paragraph. We send a flat string, so we are on that path:
   * without this declaration the cost is silent fidelity loss the operator is
   * never told about, not a 4xx (ADR-046).
   */
  getDescriptionFormat(): DescriptionFormat {
    return ERLI_DESCRIPTION_FORMAT;
  }


  /**
   * Erli borrows Allegro's taxonomy (ADR-025 §3): it accepts Allegro
   * category/parameter ids verbatim via `source:"allegro"` and ships no
   * `CategoryBrowser` / `CategoryParametersReader` of its own. Declaring this
   * lets core reuse an operator's existing PrestaShop→Allegro category/attribute
   * mappings for an Erli destination with zero re-authoring (#1045).
   *
   * The value is ENVIRONMENT-QUALIFIED (#2210), because Allegro publishes a
   * different tree per environment and an Allegro connection declares itself
   * accordingly (`'allegro:sandbox'` for a sandbox connection, #2063). Returning
   * a bare `'allegro'` from a connection that borrows the SANDBOX catalogue
   * would name an owner no sandbox connection answers to, so every borrowed
   * lookup would silently find nothing.
   *
   * The environment is resolved by `resolveErliAllegroTaxonomyEnvironment`, the
   * same helper the factory uses to build the catalogue client, so the owner
   * declared here always names the tree this connection actually reads. It is
   * NOT derived from Erli's own `config.environment`: that selects the Erli Shop
   * API host, a different axis, and an Erli sandbox connection borrowing the
   * real Allegro catalogue is the ordinary test topology - the one that broke
   * when the two values were derived independently.
   */
  getBorrowedTaxonomy(): TaxonomyOwner {
    return this.allegroEnvironment === 'sandbox' ? 'allegro:sandbox' : 'allegro';
  }

  /**
   * `TaxonomyBorrower.allowsBorrowedCatalogueLookup` - whether core may resolve
   * this destination's EAN lookups through a PEER connection that owns the
   * borrowed taxonomy (#2210).
   *
   * `false` is the operator's ADR-031 "Allegro category access" opt-out
   * (#1934/F10). Borrowing is a different mechanism from this connection's own
   * category browsing - it spends the peer's OAuth credentials and the peer's
   * rate-limit budget, not this connection's Allegro keys - so it slips that
   * toggle unless it is answered here. It is still the effect the operator
   * switched off: up to one Allegro catalogue call per variant, caused by this
   * connection.
   */
  allowsBorrowedCatalogueLookup(): boolean {
    return this.allegroCatalogueAccessAllowed;
  }

  /**
   * `CategoryBrowser.fetchCategories` (#1383, ADR-031) — assigned in the
   * constructor ONLY when `allegroCategoryCatalog` is provided. Declared as an
   * optional instance property (not a class method / `implements` member) so
   * `isCategoryBrowser` (`typeof adapter.fetchCategories === 'function'`)
   * reflects per-connection Allegro-credential configuration rather than a
   * static, connection-independent capability.
   */
  fetchCategories?: (parentId?: string) => Promise<OfferCategory[]>;

  /**
   * `CategoryParametersReader.fetchCategoryParameters` (#1383, ADR-031). Same
   * per-instance wiring as {@link fetchCategories} — delegates to the shared
   * `AllegroCategoryCatalogClient`, adapting its plain-`categoryId` signature
   * to the port's `{ categoryId }` input shape.
   */
  fetchCategoryParameters?: (input: { categoryId: string }) => Promise<CategoryParameter[]>;

  constructor(
    private readonly connectionId: string,
    private readonly adapterKey: string,
    private readonly httpClient: IErliHttpClient,
    /**
     * Shop-wide default dispatch time from `connection.config`. Used on offer
     * create when the per-offer override (`overrides.platformParams.dispatchTime`)
     * is absent; create fails closed if neither is present (Erli requires it).
     */
    private readonly defaultDispatchTime?: ErliDispatchTime,
    /**
     * Distributed cache for the per-offer frozen-stock flag (#1066). Optional:
     * unit-test hosts and `CacheModule`-less bootstraps leave it `undefined`, in
     * which case every consult fails open (push stock = pre-#1066 behaviour).
     */
    private readonly cache?: CachePort,
    /**
     * Shared Allegro category-catalog client (#1382/#1383, ADR-031). Provided
     * by `ErliAdapterFactory` only when the connection's resolved credentials
     * carry BOTH `allegroClientId` and `allegroClientSecret`. When present,
     * wires {@link fetchCategories}/{@link fetchCategoryParameters}; when
     * absent, both stay `undefined` and this instance offers no category
     * browsing at all — exactly the "adapter doesn't implement this
     * capability" case callers already handle.
     */
    allegroCategoryCatalog?: AllegroCategoryCatalogClient,
    /**
     * Buyer-facing web host (origin, e.g. `https://sandbox.erli.dev` /
     * `https://erli.pl` — NOT the `/svc/shop-api` API base). Used to build the
     * public offer URL in {@link toMarketplaceOffer}. Optional: when absent (unit
     * tests, legacy callers) the offer URL is simply omitted, preserving the
     * pre-fix behaviour.
     */
    private readonly webBaseUrl?: string,
    /**
     * Which Allegro environment this connection borrows its taxonomy from
     * (`config.allegroEnvironment`, ADR-031). Read by
     * {@link getBorrowedTaxonomy} so the declared owner matches the identity the
     * corresponding Allegro connection reports (#2210). Optional: absent means
     * production, the pre-#2210 behaviour.
     */
    private readonly allegroEnvironment?: AllegroCatalogEnvironment,
    /**
     * Whether the operator left ADR-031 Allegro category access enabled for this
     * connection (#1934/F10). Read by
     * {@link allowsBorrowedCatalogueLookup} so the opt-out also covers the
     * borrowed EAN lookup core performs through a peer Allegro connection
     * (#2210). Defaults to `true`: absent means "not opted out", which is what
     * every caller predating the flag means.
     */
    private readonly allegroCatalogueAccessAllowed: boolean = true,
  ) {
    if (allegroCategoryCatalog) {
      this.fetchCategories = (parentId?: string): Promise<OfferCategory[]> =>
        allegroCategoryCatalog.fetchCategories(parentId);
      this.fetchCategoryParameters = (input: { categoryId: string }): Promise<CategoryParameter[]> =>
        allegroCategoryCatalog.fetchCategoryParameters(input.categoryId);
    }
  }

  async createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult> {
    const externalOfferId = this.resolveErliProductId(cmd);
    // Body assembly fails closed on incomplete offer data (no safe https image,
    // blank title, unusable dispatch time, non-finite price). Those are terminal
    // BUSINESS rejections, not transport faults, so they must surface as the
    // neutral `OfferCreateRejectedException` (#1934/F6). Left as a bare
    // `ErliConfigException` they are classified by nothing in
    // `OfferCreationExecutionService`, get rethrown, and the record stays
    // `pending` forever - `advanceBatchStatus` is never reached, so the BATCH
    // never terminates either and the operator reads "Queued" indefinitely,
    // with the only trace in `sync_jobs.lastError`.
    let body: ErliProductCreateBody;
    try {
      body = this.buildCreateBody(cmd);
    } catch (error) {
      if (error instanceof ErliConfigException) {
        throw this.toCreateRejectedFromConfig(error);
      }
      throw error;
    }
    try {
      // `POST /products/{id}` is create-only and seller-keyed by the resource id
      // (the OL variant id). It is NOT a silent upsert — a duplicate id 409s
      // ("unique key duplication", verified against the Shop API). The id IS the
      // dedup key, so `cmd.idempotencyKey` is intentionally not forwarded; opt
      // into client retry-safety, and treat the 409 below as idempotent success.
      await this.httpClient.post(this.productPath(externalOfferId), body, { idempotent: true });
    } catch (error) {
      if (error instanceof ErliApiException) {
        // 409 = the seller-keyed product already exists (a retry, a client
        // transport-retry after a server-side success, or a re-submitted batch).
        // The offer IS created, so this is an idempotent success, not a failure.
        if (error.statusCode === 409) {
          this.logger.debug(
            `Erli offer already exists (409); treating as idempotent success ` +
              `[connectionId=${this.connectionId}, externalOfferId=${externalOfferId}]`,
          );
          return { externalOfferId, status: 'draft', alreadyExisted: true };
        }
        throw this.toCreateRejected(error);
      }
      // Auth / network / rate-limit propagate to the runner + classifiers.
      throw error;
    }
    // 202/2xx = submitted, not confirmed (ADR-025). Stay 'draft' (outcome 'ok',
    // no creation poll): the Allegro-tuned OfferStatusPollService treats a GET
    // 404 as terminal OFFER_NOT_FOUND on the first iteration and its ~9.5-min
    // budget is shorter than Erli's documented ~20-min cache lag — flipping to
    // 'validating' would falsely fail valid offers (review #1063). Publication is
    // reconciled by the steady-state erli-offer-status-sync task instead, which
    // tolerates the lag; that path still exercises getOfferStatus (#989).
    return { externalOfferId, status: 'draft' };
  }

  async updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<void> {
    const body = this.buildPatchFromFields(cmd.fields);
    // #988 / ADR-025 §4b: never overwrite a field the seller froze in the panel.
    // Read the live product, drop frozen keys per-field; an empty body is a no-op.
    let current: ErliProductResource;
    try {
      current = await this.fetchErliProduct(cmd.externalOfferId);
    } catch (error) {
      // ADR-025 is reconciliation-first: within Erli's ~20-min read-after-write
      // cache lag a just-created offer GET-404s. Fail open — PATCH the full body
      // (frozen state unknown, and a just-created offer has no manual freezes yet)
      // rather than blocking the update. Re-throw anything that isn't a 404 (#1061).
      if (error instanceof ErliApiException && error.statusCode === 404) {
        current = {};
      } else {
        throw error;
      }
    }
    // #1066: opportunistically refresh the frozen-stock cache flag — `frozen`
    // is already in hand from the read above. On the 404 fail-open branch `current`
    // is `{}` so `frozen` is undefined and the helper no-ops.
    await this.writeFrozenStockFlag(cmd.externalOfferId, current.frozen);
    const filtered = this.dropFrozenFields(body, current.frozen);
    if (Object.keys(filtered).length === 0) {
      this.logger.debug(
        `Erli field-update is a no-op — all supplied fields are frozen [connectionId=${this.connectionId}]`,
      );
      return;
    }
    await this.httpClient.patch(this.productPath(cmd.externalOfferId), filtered);
  }

  /**
   * OfferStatusReader (#989). Reads the real Erli-side status (despite the
   * async-202 cache lag) and maps it to the neutral `OfferPublicationStatus`.
   * Reuses {@link fetchErliProduct}. A 404 (offer not on Erli) becomes
   * `OfferNotFoundOnMarketplaceException`; other transport errors propagate so
   * the runner's transient-retry path absorbs the blip (capability contract).
   */
  async getOfferStatus(externalOfferId: string): Promise<OfferStatusReadResult> {
    let product: ErliProductResource;
    try {
      product = await this.fetchErliProduct(externalOfferId);
    } catch (error) {
      if (error instanceof ErliApiException && error.statusCode === 404) {
        throw new OfferNotFoundOnMarketplaceException(externalOfferId, this.connectionId);
      }
      throw error;
    }
    // #1066: this is the primary writer of the frozen-stock cache flag — the
    // reconciliation sweep GETs every mapped offer here, so the hot quantity path
    // gets the flag without its own GET. Written before mapping/returning; a 404
    // (handled above → OfferNotFoundOnMarketplaceException) never reaches here.
    await this.writeFrozenStockFlag(externalOfferId, product.frozen);
    return mapErliStatusToReadResult(product);
  }

  /**
   * OfferReader (#464). Fetches the live Erli-side offer detail (title, image,
   * price, qty, status, category, description) the listing-detail page surfaces
   * above the raw mapping fields. Reuses {@link fetchErliProduct} — Erli
   * represents an offer AS a product, so the same seller-keyed
   * `GET /products/{externalId}` read backs it.
   *
   * A 404 (offer not yet visible on Erli — the ADR-025 §1 ~20-min read-after-write
   * cache lag, or a deleted offer) becomes `OfferNotFoundOnMarketplaceException`,
   * which the HTTP layer maps to the soft "live data unavailable" fallback rather
   * than a hard error. Other transport errors propagate so the FE surfaces the
   * retryable error state.
   */
  async getOffer(input: { externalId: string }): Promise<MarketplaceOffer> {
    let product: ErliProductResource;
    try {
      product = await this.fetchErliProduct(input.externalId);
    } catch (error) {
      if (error instanceof ErliApiException && error.statusCode === 404) {
        throw new OfferNotFoundOnMarketplaceException(input.externalId, this.connectionId);
      }
      throw error;
    }
    return this.toMarketplaceOffer(input.externalId, product);
  }

  /**
   * Map a read-side Erli product resource onto the neutral {@link MarketplaceOffer}.
   * Price is Erli's grosze integer → decimal string in PLN (Erli is PLN-only).
   * Description prefers the flat `externalDescription` HTML over the structured
   * `description.sections` tree. Category is the leaf of the first breadcrumb path.
   * `marketplaceUrl` is the public `{webBaseUrl}/produkt/{slug},{marketplaceId}`
   * when the read carries both a `slug` and a numeric `marketplaceId` (and a web
   * host is wired); otherwise it is omitted — Erli exposes no stable buyer-facing
   * URL for such reads. `endsAt` is always omitted (Erli has no fixed offer end date).
   */
  private toMarketplaceOffer(externalId: string, product: ErliProductResource): MarketplaceOffer {
    const leafCategory = product.categories?.[0]?.at(-1);
    const marketplaceUrl =
      this.webBaseUrl && product.slug && product.marketplaceId !== undefined
        ? `${this.webBaseUrl}/produkt/${product.slug},${product.marketplaceId}`
        : undefined;
    return {
      externalId: product.externalId ?? externalId,
      title: product.name ?? '',
      description: product.externalDescription,
      imageUrl: product.images?.[0]?.url,
      price: {
        amount: ((product.price ?? 0) / 100).toFixed(2),
        currency: ERLI_CURRENCY,
      },
      availableQuantity: product.stock ?? 0,
      status: product.status ?? 'unknown',
      category: leafCategory
        ? { id: String(leafCategory.id), name: leafCategory.name }
        : undefined,
      marketplaceUrl,
    };
  }

  /**
   * ResponsibleProducerReader (#1531). Lists the seller's EU GPSR
   * responsible-producer registry ("producent") from
   * `GET /dictionaries/responsibleProducers` so the offer-creation wizard can
   * render a picker; the operator's choice rides back on
   * `overrides.platformParams.producer` and is stamped onto the create body so
   * the created product is not blocked for a missing producer. Erli's dictionary
   * carries no GPSR classification, so every entry maps to `'PRODUCER'`. Results
   * are cached per connection for a short TTL to keep repeated wizard loads off
   * the Erli API; a missing/failing cache simply falls through to a live read
   * (fail-open).
   */
  async fetchResponsibleProducers(): Promise<ResponsibleProducerEntry[]> {
    const cacheKey = `erli:responsible-producers:${this.connectionId}`;
    if (this.cache) {
      try {
        const cached = await this.cache.get<ResponsibleProducerEntry[]>(cacheKey);
        if (cached) {
          return cached;
        }
      } catch (error) {
        this.logger.debug(
          `Responsible-producer cache read failed (live fetch) [connectionId=${this.connectionId}]: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const res = await this.httpClient.get<ErliResponsibleProducerItem[]>(
      'dictionaries/responsibleProducers',
    );
    const items: ResponsibleProducerEntry[] = (res.data ?? [])
      .filter((item) => typeof item?.name === 'string' && item.name.length > 0)
      .map((item) => ({ id: String(item.id), name: item.name, kind: 'PRODUCER' as const }));
    if (this.cache) {
      try {
        await this.cache.set(cacheKey, items, ERLI_RESPONSIBLE_PRODUCERS_CACHE_TTL_SEC);
      } catch (error) {
        this.logger.debug(
          `Responsible-producer cache write failed (ignored) [connectionId=${this.connectionId}]: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return items;
  }

  /**
   * DeliveryPriceListReader (#1530). Lists the seller's delivery price lists
   * ("cennik dostawy") from `GET /delivery/priceLists` so the offer-creation
   * wizard can render a picker; the operator's choice rides back on
   * `overrides.platformParams.deliveryPriceList` and is stamped onto the create
   * body so the offer is buyable. Results are cached per connection for a short
   * TTL to keep repeated wizard loads off the Erli API; a missing/failing cache
   * simply falls through to a live read (fail-open).
   */
  async listDeliveryPriceLists(): Promise<DeliveryPriceList[]> {
    const cacheKey = `erli:delivery-price-lists:${this.connectionId}`;
    if (this.cache) {
      try {
        const cached = await this.cache.get<DeliveryPriceList[]>(cacheKey);
        if (cached) {
          return cached;
        }
      } catch (error) {
        this.logger.debug(
          `Delivery-price-list cache read failed (live fetch) [connectionId=${this.connectionId}]: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const res = await this.httpClient.get<ErliDeliveryPriceListItem[]>('delivery/priceLists');
    const items = (res.data ?? [])
      .filter((item) => typeof item?.name === 'string' && item.name.length > 0)
      .map((item) => ({ id: String(item.id), name: item.name }));
    if (this.cache) {
      try {
        await this.cache.set(cacheKey, items, ERLI_DELIVERY_PRICE_LISTS_CACHE_TTL_SEC);
      } catch (error) {
        this.logger.debug(
          `Delivery-price-list cache write failed (ignored) [connectionId=${this.connectionId}]: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return items;
  }

  /**
   * Read the current Erli product (#988). Reuses {@link productPath}
   * (validate+encode) so a hostile id fails closed exactly as the write paths
   * do. #989 reuses this read path for offer-status reconciliation.
   */
  private async fetchErliProduct(externalId: string): Promise<ErliProductResource> {
    const res = await this.httpClient.get<ErliProductResource>(this.productPath(externalId));
    // The client returns `data: undefined` for a 204 / empty-body 2xx. Treat a
    // bodyless read as "no frozen info known" (empty resource) so the PATCH still
    // proceeds rather than throwing on `current.frozen` (review #1061).
    return res.data ?? {};
  }

  /**
   * Return a copy of the patch body with every key the seller has frozen removed
   * (per-nested-field granularity, ADR-025 §4b). Each OL patch key maps to its
   * Erli frozen-name via {@link PATCH_KEY_TO_ERLI_FROZEN_NAME}; a key with no
   * mapping is never considered frozen. Dropped keys are debug-logged (no PII).
   */
  private dropFrozenFields(
    body: ErliProductPatchBody,
    frozen: Record<string, boolean> | undefined,
  ): ErliProductPatchBody {
    if (!frozen) {
      return body;
    }
    // Shallow-copy then delete frozen keys — avoids a per-key index-write cast
    // while preserving each value's own type.
    const result: ErliProductPatchBody = { ...body };
    for (const key of Object.keys(result) as (keyof ErliProductPatchBody)[]) {
      const erliName = PATCH_KEY_TO_ERLI_FROZEN_NAME[key];
      if (erliName !== undefined && frozen[erliName] === true) {
        if (key === 'taxRate') {
          // #2249: a frozen tax rate is INFORMATION, not an error - the seller
          // set it in their panel deliberately, and that is exactly the signal
          // that makes a later shop-versus-channel disagreement attributable to
          // a person. Logged once per connection so a nightly propagation pass
          // does not turn one deliberate decision into a recurring complaint,
          // and `force` is never sent.
          if (!this.frozenTaxRateReported.has(this.connectionId)) {
            this.frozenTaxRateReported.add(this.connectionId);
            this.logger.log(
              `Erli tax rate is seller-frozen on this connection; OpenLinker will not overwrite it ` +
                `[connectionId=${this.connectionId}]`,
            );
          }
        } else {
          this.logger.debug(
            `Skipping frozen Erli field "${erliName}" on field-update [connectionId=${this.connectionId}]`,
          );
        }
        delete result[key];
      }
    }
    return result;
  }

  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    // #1066 / ADR-025 §4b: honor a seller-frozen stock WITHOUT a per-tick GET.
    // The flag is cached during erli-offer-status-sync reconciliation (which
    // already GETs each offer); a cache miss fails OPEN (push), preserving the
    // pre-#1066 behaviour when the flag is unknown. The key builder applies the
    // same validate-or-null + encode hygiene as `productPath`, so a hostile id
    // reads as a miss here and still throws on the push branch below.
    if (await this.isStockFrozenCached(cmd.offerId)) {
      // warn (not debug): a frozen offer means OL stops propagating stock — INCLUDING
      // a drop to 0 — so a sold-out variant can oversell on Erli until the seller
      // unfreezes. Surface the skipped quantity so operators can spot oversell-risk
      // freezes (PR1067-TECH-02).
      this.logger.warn(
        `Skipping stock push for seller-frozen Erli offer (stock=${cmd.quantity} not propagated) [connectionId=${this.connectionId}, offerId=${cmd.offerId}]`,
      );
      return;
    }
    const body: ErliProductPatchBody = { stock: cmd.quantity };
    await this.httpClient.patch(this.productPath(cmd.offerId), body);
  }

  /**
   * Stock-restore-on-cancellation MECHANISM (#997 Half B / ADR-025 §4a, wired by
   * the #1146 `OfferStockRestorer` capability).
   *
   * Erli auto-decrements stock on purchase but does NOT restore it on cancel, so
   * OL issues the compensating write. Core (`OfferStockRestoreService`) resolves
   * the ABSOLUTE master-inventory target per offer and passes plain
   * `OfferStockRestoreTarget[]`; this adapter just sets each via the absolute-set
   * {@link updateOfferQuantity}. It NEVER reads back Erli stock and increments:
   * `updateOfferQuantity` is absolute-set, Erli's ~20-min cache lag makes a
   * read-back stale, and a stale read repeated across retries double-counts. The
   * adapter holds no inventory port — keeping the plugin contract free of any
   * core inventory service.
   *
   * WIRED (#1146): the core `OrderIngestionService` cancellation-observe hook
   * enqueues a `marketplace.offer.stockRestore` job whose worker handler narrows
   * the connection's adapter to this capability and calls here.
   *
   * Frozen-stock interaction: the restore routes through `updateOfferQuantity`,
   * which consults `isStockFrozenCached` — so if a variant's stock is cached as
   * frozen, the compensating restore PATCH is SKIPPED (arguably correct: a seller
   * who froze stock owns it).
   *
   * Empty `targets` → no-op (an order with no Erli offer mapping yields no
   * targets to restore). Log hygiene: never logs an order id or waybill.
   */
  async restoreStockOnCancellation(targets: readonly OfferStockRestoreTarget[]): Promise<void> {
    if (targets.length === 0) {
      return;
    }
    for (const target of targets) {
      await this.updateOfferQuantity({ offerId: target.externalOfferId, quantity: target.quantity });
    }
  }

  /**
   * Build the connection-scoped frozen-stock cache key (#1066). Both writer
   * (`writeFrozenStockFlag`) and reader (`isStockFrozenCached`) go through this
   * single builder so they cannot drift to disjoint keys. Validates the id with
   * the same {@link ERLI_PRODUCT_ID_PATTERN} as {@link productPath} and returns
   * `null` on a non-match (never builds a key from an unvalidated string);
   * `encodeURIComponent` is the backstop so a stray `:` can't blur the
   * namespace separator across connections. Uses the trusted constructor-injected
   * `this.connectionId`, never a value off the command.
   */
  private frozenStockCacheKey(externalOfferId: string): string | null {
    if (!ERLI_PRODUCT_ID_PATTERN.test(externalOfferId)) {
      return null;
    }
    return `erli:frozen-stock:${this.connectionId}:${encodeURIComponent(externalOfferId)}`;
  }

  /**
   * Persist the per-offer frozen-stock flag from a reconciliation read (#1066).
   * Write-on-frozen-only: stock frozen → `set(true)`; stock NOT frozen →
   * `delete` (unfreeze transition) — "known not-frozen" and "unknown" both read
   * as fail-open, so storing `false` buys nothing but write amplification. A
   * bodyless 2xx leaves `frozen` `undefined` (GET carried no frozen info):
   * leave the cache untouched so a previously-cached `true` is not clobbered.
   * Cache errors are swallowed at debug — a cache write must never break
   * reconciliation.
   */
  private async writeFrozenStockFlag(
    externalOfferId: string,
    frozen: Record<string, boolean> | undefined,
  ): Promise<void> {
    if (!this.cache || frozen === undefined) {
      return;
    }
    const key = this.frozenStockCacheKey(externalOfferId);
    if (key === null) {
      return;
    }
    try {
      if (frozen[ERLI_FROZEN_STOCK_FIELD] === true) {
        await this.cache.set(key, true, ERLI_FROZEN_STOCK_CACHE_TTL_SEC);
      } else {
        await this.cache.delete(key);
      }
    } catch (error) {
      this.logger.debug(
        `Frozen-stock cache write failed (ignored) [connectionId=${this.connectionId}, offerId=${externalOfferId}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Read the cached frozen-stock flag for the hot quantity path (#1066). Returns
   * `false` (fail-open ⇒ push) when the id is invalid/hostile (null key), no
   * cache is wired, the key is absent, or the cache read errors — so the only
   * behaviour change vs. pre-#1066 is the positive case (cached `true` ⇒ skip).
   */
  private async isStockFrozenCached(externalOfferId: string): Promise<boolean> {
    if (!this.cache) {
      return false;
    }
    const key = this.frozenStockCacheKey(externalOfferId);
    if (key === null) {
      return false;
    }
    try {
      return (await this.cache.get<boolean>(key)) === true;
    } catch (error) {
      this.logger.debug(
        `Frozen-stock cache read failed (failing open) [connectionId=${this.connectionId}, offerId=${externalOfferId}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Derive the Erli seller-keyed external id from the command. Identity today
   * (the OL variant id is the seller key); the #992 spike may switch to a
   * SKU/barcode, in which case only this helper changes — and the security
   * invariant in {@link productPath} still holds.
   */
  private resolveErliProductId(cmd: CreateOfferCommand): string {
    return cmd.internalVariantId;
  }

  /** Validate (fail-closed) + encode the id before interpolating into the path. */
  private productPath(rawId: string): string {
    if (!ERLI_PRODUCT_ID_PATTERN.test(rawId)) {
      throw new ErliConfigException(
        // Report only the shape, never the raw (attacker-influenceable) id, so a
        // malformed value can't ride into logs/upstream verbatim (PR1058-SEC-05).
        `Erli product id failed validation (expected ol_variant_<32 hex>, got ${rawId.length} chars)`,
        this.connectionId,
      );
    }
    return erliProductPath(rawId);
  }

  /**
   * The Erli enum value for the command's neutral rate (#2249), or `undefined`
   * when there is no rate and strict enforcement is off.
   *
   * Refuses rather than omitting, in both failure directions, because an
   * omitted rate is the worse outcome on this platform: Erli publishes the
   * product and then marks it not-buyable with `missingTaxRate`, which nobody
   * sees until an operator wonders why the listing gets no orders.
   *
   * The no-rate refusal is gated on `OL_TAX_RATE_STRICT_ENABLED` (#2245
   * review). Catalogue coverage is zero on deploy, so refusing every rate-less
   * publish on day one fails every child of every bulk batch, and unlike
   * issuance there is no badge or counter to read that from. With the switch
   * off the field is omitted exactly as it was before this epic, and Erli's own
   * `missingTaxRate` remains the signal. The not-expressible refusal is NOT
   * gated: there the shop DID name a rate Erli cannot carry, which is a real
   * conflict at any coverage level.
   */
  private resolveErliTaxRate(cmd: CreateOfferCommand): string | undefined {
    if (!cmd.taxRate) {
      if (!isTaxRateStrictEnabled()) {
        this.logger.warn(
          `Publishing an Erli product with no tax rate because ` +
            `OL_TAX_RATE_STRICT_ENABLED is off. Erli will mark it not-buyable ` +
            `("missingTaxRate") until the rate is added in the shop's catalogue and the ` +
            `product is re-synced.`,
        );
        return undefined;
      }
      throw new OfferCreateRejectedException(this.adapterKey, 0, [
        {
          field: 'taxRate',
          code: 'TAX_RATE_MISSING',
          message:
            `No tax rate is known for this product, and Erli blocks a product without one ` +
            `("missingTaxRate"). Add the rate in the shop's catalogue and re-sync the product; ` +
            `OpenLinker does not substitute one.`,
        },
      ]);
    }
    const erliTaxRate = toErliTaxRate(cmd.taxRate);
    if (erliTaxRate === null) {
      throw new OfferCreateRejectedException(this.adapterKey, 0, [
        {
          field: 'taxRate',
          code: 'TAX_RATE_NOT_EXPRESSIBLE',
          message:
            `Erli has no tax value for "${cmd.taxRate}". Supported: ` +
            `${supportedErliTaxRates().join(', ')}. Set one of those on the product in the shop, ` +
            `or list it on a channel that supports the code.`,
        },
      ]);
    }
    return erliTaxRate;
  }

  private buildCreateBody(cmd: CreateOfferCommand): ErliProductCreateBody {
    // Erli requires name, images, price, stock, dispatchTime on create. Fail
    // CLOSED locally on every required field (same posture as dispatchTime) so a
    // command missing one is rejected up front instead of burning a round-trip on
    // a guaranteed Erli 4xx — and `ErliProductCreateBody` never serialises an
    // invalid (partial) create body (PR1058-TECH-04).
    const name = this.resolveName(cmd.overrides?.title);
    const images = this.resolveImages(cmd.overrides?.imageUrls);
    const body: ErliProductCreateBody = {
      name,
      price: toErliMinorUnits(cmd.price.amount),
      stock: cmd.stock,
      images,
      dispatchTime: this.resolveDispatchTime(cmd.overrides?.platformParams),
    };
    // #1530 — operator-selected delivery price list ("cennik dostawy"). Erli
    // keys it by unique name; absent ⇒ omit (offer stays not-buyable until the
    // operator picks one, mirroring the dispatchTime opt-in posture).
    const deliveryPriceList = readDeliveryPriceListParam(cmd.overrides?.platformParams);
    if (deliveryPriceList !== undefined) {
      body.deliveryPriceList = deliveryPriceList;
    }
    if (cmd.overrides?.description != null) {
      body.description = flattenDescription(cmd.overrides.description);
    }
    // #1531 — operator-selected responsible producer ("producent"). Erli keys it
    // by the numeric dictionary id (`producerId`); absent ⇒ omit (the product
    // stays blocked for a missing producer until the operator picks one,
    // mirroring the dispatchTime/deliveryPriceList opt-in posture).
    const producerId = readProducerParam(cmd.overrides?.platformParams);
    if (producerId !== undefined) {
      body.producerId = producerId;
    }
    if (cmd.variantBarcode != null) {
      body.ean = cmd.variantBarcode;
    }
    // #2249 (ADR-052) — the shop's rate, propagated onto the Erli product.
    // Refused rather than omitted: Erli's own `buyableProblems.missingTaxRate`
    // blocks a rate-less product server-side, so omitting it trades an
    // actionable error here for a silently not-buyable listing an operator has
    // to go and discover. `oo` has no Erli equivalent and is refused for the
    // same reason - a nearest-looking token would be a real sale taxed wrongly.
    const erliTaxRate = this.resolveErliTaxRate(cmd);
    if (erliTaxRate !== undefined) {
      body.taxRate = erliTaxRate;
    }
    // Taxonomy (#985 / #1096): prefer the resolved Allegro id, else the master
    // shop's own categories (`source:"shop"`), else omit — Erli's API makes
    // category optional, so an uncategorised offer is valid rather than a hard
    // rejection (ADR-025 §3 relaxed; the offer can be categorised later in Erli).
    const externalCategories = buildExternalCategories(cmd);
    if (externalCategories.length > 0) {
      body.externalCategories = externalCategories;
    }
    // Parameter reuse (#985) — Allegro-id params, source:"allegro". Returns the
    // attribute array plus the ids dropped in v1 (range-only/empty) for logging.
    const { attributes: paramAttributes, droppedParamIds } = buildExternalAttributes(cmd);
    if (droppedParamIds.length > 0) {
      this.logger.debug(
        `Dropped ${droppedParamIds.length} unsupported Erli parameter(s) (range-only/empty, #985 R3) [connectionId=${this.connectionId}]: ${droppedParamIds.join(', ')}`,
      );
    }

    // #1500 — default marketplace-required condition ("Stan"). Erli borrows
    // Allegro's taxonomy, so condition rides as a source:"allegro" dictionary
    // attribute. Appended to the Allegro-param attributes BEFORE the variant-group
    // index calc below so the group's index refs (which point at the axes that
    // come after) stay valid. Skipped when the operator already supplied a Stan
    // parameter in cmd.parameters (operator intent wins, never double-set).
    const conditionAttribute = buildConditionAttribute(cmd);
    if (conditionAttribute) {
      paramAttributes.push(conditionAttribute);
    }

    // #986/#1065: explicit multi-variant grouping. A sibling's distinguishing
    // axes become shop-source `externalAttributes` entries, and the group
    // references them by **index** — Erli's verified wire shape. There is NO
    // top-level `attributes` field (the API rejects one) and the group's own
    // `attributes` (required, minItems 1) must be index integers, not name/value
    // pairs. `groupId` is BODY-ONLY (it is the parent product id, never
    // path-validated). A sibling with no distinguishing axes lists ungrouped.
    const g = cmd.variantGroup;
    const grouped = g !== undefined && g.groupId.length > 0 && g.attributes.length > 0;
    const groupAttributes: ErliExternalAttribute[] = grouped
      ? g.attributes.map((axis, j) => ({
          source: 'shop' as const,
          id: axis.name,
          name: axis.name,
          type: 'string' as const,
          values: [axis.value],
          index: paramAttributes.length + j,
        }))
      : [];

    // #1096 F2: master-shop product features → shop-source `externalAttributes`.
    // MERGE ORDER (critical): features are APPENDED after the variant-group axes,
    // so the group's index refs (which point at the axes that come before) stay
    // valid. Each feature's `index` = its absolute position in the final array.
    const featureAttributes: ErliExternalAttribute[] = buildShopAttributes(
      cmd,
      paramAttributes.length + groupAttributes.length
    );

    const externalAttributes = [...paramAttributes, ...groupAttributes, ...featureAttributes];
    if (externalAttributes.length > 0) {
      body.externalAttributes = externalAttributes;
    }
    if (grouped) {
      body.externalVariantGroup = {
        id: g.groupId,
        source: 'integration',
        // Group references ONLY the variant-group axes (NOT the appended
        // features) — their indexes are unchanged by appending features.
        attributes: groupAttributes.map((a) => a.index as number),
      };
    }
    return body;
  }

  /** Required offer name (Erli product name). Fail closed on absent/blank. */
  private resolveName(title: string | undefined): string {
    if (title === undefined || title.trim().length === 0) {
      throw new ErliConfigException(
        'Erli offer create requires a non-empty title (maps to the product name).',
        this.connectionId,
      );
    }
    return title;
  }

  /**
   * Required offer images. Fail closed when no safe https image survives — Erli
   * rejects an imageless product, and #992 confirmed `images` is mandatory on
   * create, so an empty array must not reach the wire.
   */
  private resolveImages(urls: string[] | null | undefined): ErliProductImage[] {
    const images = this.sanitizeImageUrls(urls).map(toErliImage);
    if (images.length === 0) {
      throw new ErliConfigException(
        'Erli offer create requires at least one valid public https image URL.',
        this.connectionId,
      );
    }
    return images;
  }

  private buildPatchFromFields(fields: OfferFieldUpdate): ErliProductPatchBody {
    const body: ErliProductPatchBody = {};
    if (fields.price !== undefined) {
      body.price = toErliMinorUnits(fields.price.amount);
    }
    if (fields.title !== undefined) {
      body.name = fields.title;
    }
    if (fields.description !== undefined) {
      body.description = flattenDescription(fields.description);
    }
    // #2249: propagate a rate change onto the live product. An unmappable code
    // is DROPPED rather than throwing, unlike on the create path: a create that
    // cannot state its tax must not happen at all, while an update that cannot
    // is a partial update of an offer that already exists and already sells.
    // Throwing here would take a title or price fix down with it.
    if (fields.taxRate !== undefined) {
      const erliTaxRate = toErliTaxRate(fields.taxRate);
      if (erliTaxRate === null) {
        this.logger.warn(
          `Erli has no tax value for "${fields.taxRate}"; leaving the offer's rate unchanged ` +
            `[connectionId=${this.connectionId}]`,
        );
      } else {
        body.taxRate = erliTaxRate;
      }
    }
    return body;
  }

  /**
   * Map a deterministic Erli 4xx to the neutral create-rejection. `responseBody`
   * is diagnostics-only (may echo submitted data) — it stays in a debug log and
   * NEVER reaches the operator-facing `errors[].message`. #992 may parse a
   * structured Erli error body into per-field errors here.
   */
  private toCreateRejected(error: ErliApiException): OfferCreateRejectedException {
    this.logger.debug(
      `Erli rejected offer creation (status=${error.statusCode ?? 'unknown'}) body=${
        error.responseBody ?? '<none>'
      }`,
    );
    const errors: CreateOfferValidationError[] = [
      {
        code: 'ERLI_REJECTED',
        message: `Erli rejected the offer (HTTP ${error.statusCode ?? 'unknown'}).`,
      },
    ];
    return new OfferCreateRejectedException(this.adapterKey, error.statusCode ?? 0, errors);
  }

  /**
   * Map a fail-closed body-assembly error to the neutral create-rejection
   * (#1934/F6).
   *
   * `ErliConfigException` means the offer data cannot produce a valid Erli
   * product (no safe public-https image, blank title, unusable dispatch time,
   * non-finite price). That is deterministic and terminal - retrying the same
   * command cannot succeed - so it belongs on the record as a business failure
   * with a readable reason, not as an unclassified throw that strands the
   * record and its batch. Status `0`: nothing was ever sent to Erli.
   */
  private toCreateRejectedFromConfig(error: ErliConfigException): OfferCreateRejectedException {
    const errors: CreateOfferValidationError[] = [
      {
        code: 'ERLI_OFFER_DATA_INCOMPLETE',
        message: error.message,
      },
    ];
    return new OfferCreateRejectedException(this.adapterKey, 0, errors);
  }

  /**
   * Resolve the offer's dispatch time: per-offer override
   * (`overrides.platformParams.dispatchTime`) wins over the connection-level
   * default. Fail closed if neither is present — Erli requires `dispatchTime`
   * on create, so we never send an invalid body.
   */
  private resolveDispatchTime(
    platformParams: Record<string, unknown> | undefined,
  ): ErliDispatchTime {
    const resolved = readDispatchTimeParam(platformParams) ?? this.defaultDispatchTime;
    if (!resolved) {
      throw new ErliConfigException(
        'Erli offer create requires a dispatch time: set defaultDispatchTime on the ' +
          'connection config or pass overrides.platformParams.dispatchTime.',
        this.connectionId,
      );
    }
    return resolved;
  }

  /** Best-effort hygiene: forward only https absolute URLs to non-internal hosts. */
  private sanitizeImageUrls(urls: string[] | null | undefined): string[] {
    if (!urls) {
      return [];
    }
    return urls.filter((url) => {
      if (isSafePublicHttpsUrl(url)) {
        return true;
      }
      this.logger.warn(`Dropping unsafe Erli offer image URL [connectionId=${this.connectionId}]`);
      return false;
    });
  }
}

function toErliMinorUnits(amount: number | string): number {
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  // Fail closed rather than serialize NaN into the price body: a non-numeric
  // string amount is a caller/config error, not a value Erli should ever see.
  if (!Number.isFinite(numeric)) {
    throw new ErliConfigException(`Erli price amount is not a finite number: ${String(amount)}`);
  }
  // Erli prices are integer minor units (grosze); PLN-only, no currency field.
  return Math.round(numeric * 100);
}

/** Map a sanitized image URL to Erli's image-object wire shape. */
function toErliImage(url: string): ErliProductImage {
  return { url };
}

const ERLI_DISPATCH_TIME_UNITS = new Set<ErliDispatchTime['unit']>(['hour', 'day', 'month']);

/**
 * Read + validate a per-offer `dispatchTime` override off the un-modeled
 * `overrides.platformParams`. Returns `undefined` when no override key is
 * present (caller falls back to the connection default). Throws if an override
 * IS present but malformed — an explicit operator value must not be silently
 * dropped (fail closed).
 */
function readDispatchTimeParam(
  platformParams: Record<string, unknown> | undefined,
): ErliDispatchTime | undefined {
  const raw = platformParams?.dispatchTime;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'object') {
    throw new ErliConfigException('overrides.platformParams.dispatchTime must be an object');
  }
  const candidate = raw as { period?: unknown; unit?: unknown };
  const period = candidate.period;
  if (typeof period !== 'number' || !Number.isInteger(period) || period < 0) {
    throw new ErliConfigException(
      'overrides.platformParams.dispatchTime.period must be a non-negative integer',
    );
  }
  if (candidate.unit !== undefined && !ERLI_DISPATCH_TIME_UNITS.has(candidate.unit as never)) {
    throw new ErliConfigException(
      "overrides.platformParams.dispatchTime.unit must be 'hour', 'day', or 'month'",
    );
  }
  return candidate.unit === undefined
    ? { period }
    : { period, unit: candidate.unit as ErliDispatchTime['unit'] };
}

/**
 * Read a per-offer `producer` selection off the un-modeled
 * `overrides.platformParams` (#1531). The wizard carries the numeric Erli
 * responsible-producer dictionary id as a string; this returns it as a positive
 * integer for `body.producerId`, or `undefined` when absent/blank (no selection
 * ⇒ the create body omits the field). A non-numeric value is ignored rather than
 * thrown — the picker only ever emits a dictionary id, and a product with no
 * producer is a valid (if blocked-until-set) create.
 */
function readProducerParam(
  platformParams: Record<string, unknown> | undefined,
): number | undefined {
  const raw = platformParams?.producer;
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : undefined;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Read a per-offer `deliveryPriceList` selection off the un-modeled
 * `overrides.platformParams` (#1530). Returns the trimmed price-list name when a
 * non-empty string is present, else `undefined` (no selection ⇒ the create body
 * omits the field). A non-string value is ignored rather than thrown — the
 * picker only ever emits a string, and an offer with no delivery price list is a
 * valid (if not-yet-buyable) create.
 */
function readDeliveryPriceListParam(
  platformParams: Record<string, unknown> | undefined,
): string | undefined {
  const raw = platformParams?.deliveryPriceList;
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Map Erli's native product status onto the neutral closed `OfferPublicationStatus`
 * union (#989). Erli has no `'rejected'` member in OL's union, so a rejection is
 * surfaced as `'inactive'` carrying the reason in `validationErrors` (no core enum
 * change — additive-only per offer-status-read.types ADR-009 note). `'accepted'`
 * (stored but still propagating through Erli's ~20-min cache) → `'activating'`.
 * Unknown/absent → `'inactive'` (conservative; never claims live).
 *
 * `commercial` (#2024) is read off this SAME already-fetched `product` resource
 * (the identical `price`/`stock` fields `toMarketplaceOffer` maps for `getOffer`)
 * — no second `GET /products/{externalId}` call.
 */
function mapErliStatusToReadResult(product: ErliProductResource): OfferStatusReadResult {
  const commercial = toErliCommercialObservation(product);
  switch (product.status) {
    case 'active':
      return { publicationStatus: 'active', validationErrors: [], commercial };
    case 'accepted':
      return { publicationStatus: 'activating', validationErrors: [], commercial };
    case 'rejected':
      return {
        publicationStatus: 'inactive',
        validationErrors: [
          { code: 'ERLI_REJECTED', message: product.statusReason ?? 'Erli rejected the offer.' },
        ],
        commercial,
      };
    case 'inactive':
    default:
      return { publicationStatus: 'inactive', validationErrors: [], commercial };
  }
}

/**
 * Read-only projection of price + available quantity off an already-fetched
 * `ErliProductResource` (#2024). Each axis reports `null` independently when
 * the read does not carry a usable number - never fabricated as zero, since a
 * persisted `0.00` / `0` is indistinguishable from a free item or a genuine
 * sell-out. The guards are `typeof` + `Number.isFinite` rather than
 * `!== undefined` because the values come off untyped wire JSON: a JSON `null`
 * would divide to `"0.00"`, and a non-numeric would yield `"NaN"`, which
 * Postgres `numeric` accepts and stores silently. Money conversion mirrors
 * `toMarketplaceOffer` (grosze integer → decimal string, PLN-only).
 */
function toErliCommercialObservation(product: ErliProductResource): OfferCommercialObservation {
  const { price, stock } = product;
  return {
    price:
      typeof price === 'number' && Number.isFinite(price)
        ? { amount: (price / 100).toFixed(2), currency: ERLI_CURRENCY }
        : null,
    availableQuantity: typeof stock === 'number' && Number.isFinite(stock) ? stock : null,
  };
}

/**
 * Build Erli's `externalCategories` from the command's taxonomy, preferring the
 * OL-resolved Allegro id (#985) and falling back to the master shop's own
 * categories (#1096 / ADR-025 §3 — Erli accepts `source:"shop"`, so a product
 * with no Allegro taxonomy still lists, categorised by the shop's tree). Empty
 * when neither is present, in which case the offer lists uncategorised.
 */
function buildExternalCategories(cmd: CreateOfferCommand): ErliExternalCategory[] {
  const allegroId = cmd.overrides?.categoryId;
  if (typeof allegroId === 'string' && allegroId.length > 0) {
    return [{ source: 'allegro', breadcrumb: [{ id: allegroId }] }];
  }
  const shop = (cmd.sourceCategories ?? []).filter((c) => c.id.length > 0);
  if (shop.length > 0) {
    return [
      {
        source: 'shop',
        breadcrumb: shop.map((c) => (c.name ? { id: c.id, name: c.name } : { id: c.id })),
      },
    ];
  }
  return [];
}

/**
 * Flatten the neutral, section-tagged `cmd.parameters` (#1071) into one
 * `source:"allegro"` attribute array — Erli has a single flat list, so the
 * Allegro offer/product section split collapses away. Dictionary value-ids win
 * over free-text scalars; range-only and empty entries are dropped in v1
 * (#985 risk R3).
 *
 * Reads `cmd.parameters` — where `OfferBuilderService` puts the resolved
 * parameters — NOT `overrides.platformParams`, which no longer carries category
 * parameters post-#1071 (reading it produced an empty list and silently shipped
 * offers without their Allegro attribute reuse).
 */
function buildExternalAttributes(cmd: CreateOfferCommand): {
  attributes: ErliExternalAttribute[];
  droppedParamIds: string[];
} {
  const attributes: ErliExternalAttribute[] = [];
  const droppedParamIds: string[] = [];
  for (const param of cmd.parameters ?? []) {
    if (param.id.length === 0) {
      continue;
    }
    if (param.valuesIds !== undefined && param.valuesIds.length > 0) {
      // Erli's `dictionary` type requires `values` as `{ id }` objects, not
      // bare ids — a bare string/id array is rejected wire-side with
      // `values[N] must be of type object` (confirmed live, #1384 follow-up).
      attributes.push({
        source: 'allegro',
        id: param.id,
        type: 'dictionary',
        values: param.valuesIds.map((id) => ({ id })),
      });
    } else if (param.values !== undefined && param.values.length > 0) {
      attributes.push({ source: 'allegro', id: param.id, type: 'string', values: param.values });
    } else {
      // range-only / empty → dropped in v1 (#985 risk R3). Recorded so the
      // caller can debug-log it (an operator-supplied parameter that never
      // reaches Erli is otherwise undiagnosable).
      droppedParamIds.push(param.id);
    }
  }
  return { attributes, droppedParamIds };
}

/**
 * Build the Erli condition ("Stan") attribute from the neutral `cmd.condition`
 * (#1500). Erli borrows Allegro's taxonomy (ADR-025 §3), so condition is emitted
 * as a `source:"allegro"` dictionary attribute (parameter id `11323`, value id
 * `11323_1`/`11323_2`). Returns `undefined` when no condition is set OR when the
 * operator already supplied a Stan parameter in `cmd.parameters` — operator
 * intent wins and condition is never double-set.
 */
function buildConditionAttribute(cmd: CreateOfferCommand): ErliExternalAttribute | undefined {
  const condition = cmd.condition;
  if (!condition) {
    return undefined;
  }
  if ((cmd.parameters ?? []).some((p) => p.id === ERLI_CONDITION_PARAMETER_ID)) {
    return undefined;
  }
  return {
    source: 'allegro',
    id: ERLI_CONDITION_PARAMETER_ID,
    type: 'dictionary',
    values: [{ id: ERLI_CONDITION_VALUE_IDS[condition] }],
  };
}

/**
 * Build shop-source `externalAttributes` from the command's master-derived
 * product features (#1096 F2 / ADR-025 §3). Each feature becomes a
 * `{ source:'shop', id, name, type:'string', values:[value], index }` entry.
 * `id` falls back to the feature `name` when the core slug is absent (an entry
 * with neither name nor value is skipped). `index` is the entry's ABSOLUTE
 * position in the final `externalAttributes` array — the caller passes
 * `startIndex` (the count of all entries that precede the feature block) so the
 * variant-group index refs that point at the earlier blocks stay valid. The
 * value is coerced to a single-element `string[]` per the verified wire shape.
 */
function buildShopAttributes(
  cmd: CreateOfferCommand,
  startIndex: number
): ErliExternalAttribute[] {
  const attributes: ErliExternalAttribute[] = [];
  let i = 0;
  for (const feature of cmd.sourceAttributes ?? []) {
    if (feature.name.length === 0 || feature.value.length === 0) {
      continue;
    }
    const id = feature.id && feature.id.length > 0 ? feature.id : feature.name;
    const entry: ErliExternalAttribute = {
      source: 'shop',
      id,
      name: feature.name,
      type: 'string',
      values: [feature.value],
      index: startIndex + i,
    };
    if (feature.unit !== undefined && feature.unit.length > 0) {
      entry.unit = feature.unit;
    }
    attributes.push(entry);
    i += 1;
  }
  return attributes;
}

function flattenDescription(input: string | OfferDescriptionUpdate): string {
  if (typeof input === 'string') {
    return input;
  }
  return input.sections
    .flatMap((section) => section.items)
    .map((item) => item.content)
    .join('\n\n');
}

/**
 * Best-effort SSRF-conduit hygiene (NOT full egress control — the actual
 * fetcher is Erli, and DNS-rebinding / public-resolves-internal are out of
 * scope; that's network-layer). Reject non-https + obviously-internal hosts,
 * across both IPv4 (loopback/RFC1918/unspecified/cloud-metadata) and IPv6
 * (loopback/unspecified, ULA fc00::/7, link-local fe80::/10) literals.
 */
function isSafePublicHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.internal') || host === '169.254.169.254') {
    return false;
  }
  // IPv6 literals retain their surrounding brackets in URL.hostname.
  if (host === '[::1]' || host === '[::]' || /^\[f[cd]/.test(host) || /^\[fe[89ab]/.test(host)) {
    return false;
  }
  if (
    host === '0.0.0.0' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host)
  ) {
    return false;
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return false;
  }
  return true;
}
