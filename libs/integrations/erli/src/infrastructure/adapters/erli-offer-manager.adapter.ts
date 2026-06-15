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
 * frozen-name is in `frozenFields` before issuing the PATCH (per-nested-field
 * granularity); an all-frozen update issues no PATCH.
 *
 * Frozen-`stock` on the hot path (#1066, ADR-025 §4b): `updateOfferQuantity`
 * runs on every inventory tick and deliberately does NOT pre-fetch — a per-tick
 * GET would double the tick's API calls. Frozen-`stock` is instead honored via a
 * per-offer cache flag populated by the steady-state `erli-offer-status-sync`
 * reconciliation (#989), which already GETs each mapped offer and sees
 * `frozenFields`. `getOfferStatus` (and opportunistically `updateOfferFields`)
 * writes that flag; `updateOfferQuantity` reads it and skips the stock PATCH when
 * set. A cache miss fails OPEN (push), preserving the pre-#1066 behaviour when the
 * flag is unknown. The honoring holds from the first reconciliation pass onward;
 * a freeze landing between ticks is overwritten once until the next pass — the
 * reconciliation-first / eventual-consistency posture of ADR-025 §1 (window
 * bounded by the cron cadence, not the cache TTL).
 *
 * Stock-restore-on-cancel (#988 / ADR-025 §4a) is DEFERRED to the orders half:
 * it needs an Erli order-cancel signal (OrderSource / inbox poll, #993) that
 * does not exist yet — no trigger is wired here (YAGNI). The restore mechanism
 * already exists (`updateOfferQuantity`); #993 only needs to observe the
 * `cancelled` event and call it.
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
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link OfferManagerPort}
 */
import {
  OfferCreateRejectedException,
  OfferNotFoundOnMarketplaceException,
  type CreateOfferCommand,
  type CreateOfferResult,
  type CreateOfferValidationError,
  type OfferCreator,
  type OfferDescriptionUpdate,
  type OfferFieldUpdate,
  type OfferFieldUpdater,
  type OfferManagerPort,
  type OfferStatusReadResult,
  type OfferStatusReader,
  type UpdateOfferFieldsCommand,
  type UpdateOfferQuantityCommand,
} from '@openlinker/core/listings';
import type { CachePort } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';
import { ErliApiException } from '../../domain/exceptions/erli-api.exception';
import { ErliConfigException } from '../../domain/exceptions/erli-config.exception';
import type { ErliDispatchTime } from '../../domain/types/erli-connection.types';
import type { IErliHttpClient } from '../http/erli-http-client.interface';
import type {
  ErliExternalAttribute,
  ErliExternalCategory,
  ErliProductCreateBody,
  ErliProductImage,
  ErliProductPatchBody,
  ErliProductResource,
} from './erli-product.types';

/**
 * Seller-keyed product-id allowlist. The id is interpolated into the request
 * path, so it MUST exclude `/`, `?`, `#`, and `..` (path-traversal / injection)
 * regardless of any future #992 charset change; `encodeURIComponent` is the
 * backstop. Today the id is the OL internal variant id — if #992 switches the
 * seller-key format, this pattern AND {@link ErliOfferManagerAdapter.resolveErliProductId}
 * must change in lockstep (a mismatch fails closed: updates throw, never send).
 */
const ERLI_PRODUCT_ID_PATTERN = /^ol_variant_[a-f0-9]{32}$/;

/**
 * Maps OL patch-body keys to the Erli field name carried in
 * {@link ErliProductResource.frozenFields} (#988, ADR-025 §4b). Only the keys a
 * field-update can supply are listed; an unmapped key is never treated as frozen.
 * PROVISIONAL alongside the wire shape in `erli-product.types.ts` (#992): if the
 * confirmed frozen-name set differs, this is the single change point.
 */
// OL patch-key → Erli frozen-marker wire name. Provisional #992 wire vocabulary,
// coupled to `ErliProductResource.frozenFields` (erli-product.types.ts) — reconcile
// both against the sandbox together. `stock` is intentionally absent from THIS map:
// it drives `dropFrozenFields` on the field-update path, which reads live
// `frozenFields` per call — the quantity path doesn't read live frozen state. Frozen
// `stock` IS now honored (#1066, ADR-025 §4b), but via the separate cache-flag check
// in `updateOfferQuantity` (see {@link ERLI_FROZEN_STOCK_FIELD}), not this map.
const PATCH_KEY_TO_ERLI_FROZEN_NAME: Partial<Record<keyof ErliProductPatchBody, string>> = {
  price: 'price',
  name: 'name',
  description: 'description',
};

/**
 * Erli `frozenFields` wire-name for stock (#1066, ADR-025 §4b). Looked for during
 * reconciliation to populate the per-offer frozen-stock cache flag the hot
 * `updateOfferQuantity` path reads. Colocated with {@link PATCH_KEY_TO_ERLI_FROZEN_NAME}
 * (the same provisional #992 wire vocabulary): if the sandbox spike confirms a
 * different name, this is the single change point alongside that map.
 */
const ERLI_FROZEN_STOCK_FIELD = 'stock';

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

export class ErliOfferManagerAdapter
  implements OfferManagerPort, OfferCreator, OfferFieldUpdater, OfferStatusReader
{
  private readonly logger = new Logger(ErliOfferManagerAdapter.name);

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
  ) {}

  async createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult> {
    const externalOfferId = this.resolveErliProductId(cmd);
    const body = this.buildCreateBody(cmd);
    try {
      // POST is non-idempotent by default in the client; the deterministic
      // seller-keyed id makes this an upsert, so opt into retry-safety (D3).
      // `cmd.idempotencyKey` is intentionally not forwarded — the resource id
      // (a POST to /products/{id} upserts) IS the dedup key, so a separate key
      // would add nothing on this transport.
      await this.httpClient.post(this.productPath(externalOfferId), body, { idempotent: true });
    } catch (error) {
      if (error instanceof ErliApiException) {
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
        current = {} as ErliProductResource;
      } else {
        throw error;
      }
    }
    // #1066: opportunistically refresh the frozen-stock cache flag — `frozenFields`
    // is already in hand from the read above. On the 404 fail-open branch `current`
    // is `{}` so `frozenFields` is undefined and the helper no-ops.
    await this.writeFrozenStockFlag(cmd.externalOfferId, current.frozenFields);
    const filtered = this.dropFrozenFields(body, current.frozenFields);
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
    await this.writeFrozenStockFlag(externalOfferId, product.frozenFields);
    return mapErliStatusToReadResult(product);
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
    // proceeds rather than throwing on `current.frozenFields` (review #1061).
    return res.data ?? ({} as ErliProductResource);
  }

  /**
   * Return a copy of the patch body with every key the seller has frozen removed
   * (per-nested-field granularity, ADR-025 §4b). Each OL patch key maps to its
   * Erli frozen-name via {@link PATCH_KEY_TO_ERLI_FROZEN_NAME}; a key with no
   * mapping is never considered frozen. Dropped keys are debug-logged (no PII).
   */
  private dropFrozenFields(
    body: ErliProductPatchBody,
    frozenFields: string[] | undefined,
  ): ErliProductPatchBody {
    if (!frozenFields || frozenFields.length === 0) {
      return body;
    }
    const frozen = new Set(frozenFields);
    // Shallow-copy then delete frozen keys — avoids a per-key index-write cast
    // while preserving each value's own type.
    const result: ErliProductPatchBody = { ...body };
    for (const key of Object.keys(result) as (keyof ErliProductPatchBody)[]) {
      const erliName = PATCH_KEY_TO_ERLI_FROZEN_NAME[key];
      if (erliName !== undefined && frozen.has(erliName)) {
        this.logger.debug(
          `Skipping frozen Erli field "${erliName}" on field-update [connectionId=${this.connectionId}]`,
        );
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
   * bodyless 2xx leaves `frozenFields` `undefined` (GET carried no frozen info):
   * leave the cache untouched so a previously-cached `true` is not clobbered.
   * Cache errors are swallowed at debug — a cache write must never break
   * reconciliation.
   */
  private async writeFrozenStockFlag(
    externalOfferId: string,
    frozenFields: string[] | undefined,
  ): Promise<void> {
    if (!this.cache || frozenFields === undefined) {
      return;
    }
    const key = this.frozenStockCacheKey(externalOfferId);
    if (key === null) {
      return;
    }
    try {
      if (frozenFields.includes(ERLI_FROZEN_STOCK_FIELD)) {
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
    return `products/${encodeURIComponent(rawId)}`;
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
    if (cmd.overrides?.description != null) {
      body.description = flattenDescription(cmd.overrides.description);
    }
    if (cmd.variantBarcode != null) {
      body.ean = cmd.variantBarcode;
    }
    // #985: reuse OL's already-resolved Allegro ids (source:"allegro").
    const externalCategories = buildExternalCategories(cmd);
    if (externalCategories.length > 0) {
      body.externalCategories = externalCategories;
    } else {
      // ADR-025 §3: OL builds no Erli-native taxonomy in v1 — a product without
      // resolved Allegro taxonomy cannot list on Erli. Fail closed with a clear,
      // terminal rejection (OfferCreationExecutionService derives business_failure
      // from OfferCreateRejectedException) rather than silently listing it
      // untaxonomised (spec #978 §6).
      throw new OfferCreateRejectedException(this.adapterKey, 422, [
        {
          field: 'category',
          code: 'NO_ALLEGRO_TAXONOMY',
          message:
            'No Allegro category resolved for this product; Erli v1 requires Allegro-ID taxonomy reuse (ADR-025 §3).',
        },
      ]);
    }
    const externalAttributes = buildExternalAttributes(cmd);
    if (externalAttributes.length > 0) {
      body.externalAttributes = externalAttributes;
    }
    // #986/#1065: explicit multi-variant grouping. Present only when core
    // populated the neutral `cmd.variantGroup` (OfferBuilderService); single/
    // simple products omit it and list ungrouped. `groupId` is BODY-ONLY —
    // never path-validated (it is the parent product id, not a variant id).
    const g = cmd.variantGroup;
    if (g && g.groupId.length > 0) {
      body.externalVariantGroup = { id: g.groupId };
      if (g.attributes.length > 0) {
        // Neutral OfferVariantAttribute and wire ErliVariantAttribute are
        // structurally identical (`{ name, value }`) — assign directly.
        body.attributes = g.attributes;
      }
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
 * Map Erli's native product status onto the neutral closed `OfferPublicationStatus`
 * union (#989). Erli has no `'rejected'` member in OL's union, so a rejection is
 * surfaced as `'inactive'` carrying the reason in `validationErrors` (no core enum
 * change — additive-only per offer-status-read.types ADR-009 note). `'accepted'`
 * (stored but still propagating through Erli's ~20-min cache) → `'activating'`.
 * Unknown/absent → `'inactive'` (conservative; never claims live).
 */
function mapErliStatusToReadResult(product: ErliProductResource): OfferStatusReadResult {
  switch (product.status) {
    case 'active':
      return { publicationStatus: 'active', validationErrors: [] };
    case 'accepted':
      return { publicationStatus: 'activating', validationErrors: [] };
    case 'rejected':
      return {
        publicationStatus: 'inactive',
        validationErrors: [
          { code: 'ERLI_REJECTED', message: product.statusReason ?? 'Erli rejected the offer.' },
        ],
      };
    case 'inactive':
    default:
      return { publicationStatus: 'inactive', validationErrors: [] };
  }
}

/**
 * Map the OL-resolved Allegro category id (`overrides.categoryId`) into the
 * single-element `source:"allegro"` category list. Empty when absent (#985).
 */
function buildExternalCategories(cmd: CreateOfferCommand): ErliExternalCategory[] {
  const categoryId = cmd.overrides?.categoryId;
  if (typeof categoryId === 'string' && categoryId.length > 0) {
    return [{ source: 'allegro', id: categoryId }];
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
function buildExternalAttributes(cmd: CreateOfferCommand): ErliExternalAttribute[] {
  const attributes: ErliExternalAttribute[] = [];
  for (const param of cmd.parameters ?? []) {
    if (param.id.length === 0) {
      continue;
    }
    if (param.valuesIds !== undefined && param.valuesIds.length > 0) {
      attributes.push({ source: 'allegro', id: param.id, type: 'dictionary', values: param.valuesIds });
    } else if (param.values !== undefined && param.values.length > 0) {
      attributes.push({ source: 'allegro', id: param.id, type: 'string', values: param.values });
    }
    // range-only / empty → dropped in v1 (#985 risk R3).
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
