/**
 * Price Change Apply Service (#3144, ADR-072; extracted per #3161 review
 * finding "BLOCKING — two cross-context `*RepositoryPort` imports")
 *
 * Owns the orchestration policy behind `pricing.propagateToMarketplaces` —
 * the terminal write for a single price change, whether it arrived via an
 * accepted/edited review-queue episode or directly from an `automatic`-mode
 * detection (#3143). Moved here from
 * `apps/worker/src/sync/handlers/price-change-apply.handler.ts`, which
 * previously did all of this inline and imported
 * `PriceChangeEpisodeRepositoryPort` / `PriceChangeAutoAppliedLogRepositoryPort`
 * directly — denied by `check-cross-context-imports.mjs` for any consumer
 * outside `libs/core` (`docs/architecture-overview.md § Cross-context
 * dependencies in core` — "Intra-context contract … Cross-context callers go
 * through `I*Service`"), and out of place per architecture-overview.md § 7
 * Sync Manager ("sync orchestration policies live in core application
 * services … not in worker handlers").
 *
 * Follows ADR-007's status/outcome split: a DETERMINISTIC, non-retryable
 * condition resolves normally with `outcome: 'business_failure'` on the SAME
 * attempt rather than throwing — a currency-mismatch block, a missing
 * episode, or a destination with neither `OfferManager` nor `ProductPublisher`
 * enabled/supported cannot be fixed by retrying the identical call. A
 * transient failure (network error, an unclassified marketplace/shop
 * rejection) propagates and is left to `SyncJobRunner`'s ordinary
 * retry/backoff + per-plugin `RetryClassifierPort` machinery — the runner
 * already unwraps `SyncJobExecutionError.cause` and consults every
 * registered classifier, so a deterministic 4xx an adapter raises as its own
 * typed exception (e.g. Allegro's `AllegroApiException`) is *already*
 * dead-lettered on the first attempt without this service needing to know
 * about it, provided the cause is preserved (which it is, below).
 *
 * @module libs/core/src/listings/application/services
 * @implements {IPriceChangeApplyService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CONNECTION_PORT_TOKEN,
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type ConnectionPort,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  IInventoryQueryService,
  INVENTORY_QUERY_SERVICE_TOKEN,
  OFFER_QUANTITY_WRITE_LOCK_TTL_MS,
  isWritableQuantityObservation,
  offerQuantityObservationCursorKey,
  offerQuantityWriteLockKey,
} from '@openlinker/core/inventory';
import {
  ISyncCursorsService,
  SYNC_CURSORS_SERVICE_TOKEN,
  SYNC_LOCK_TOKEN,
  SyncLockPort,
  ContendedWriteError,
} from '@openlinker/core/sync';
import { minorUnitExponentFor } from '@openlinker/core/sales-documents';
// `OfferManagerPort` / `OfferFieldUpdater` / `isOfferFieldUpdater` /
// `UpdateOfferFieldsReport` are this SAME context's own published contract
// (#3161 re-review, SUGGESTION) — a same-context cross-layer relative import
// (`../..`) rather than a value-import of the main barrel, which is the exact
// runtime-cycle shape #337/#359 split `@openlinker/core/listings/services`
// off the main barrel to prevent (see that subpath's own docblock).
import type { OfferManagerPort } from '../../domain/ports/offer-manager.port';
import {
  isOfferFieldUpdater,
  type OfferFieldUpdater,
} from '../../domain/ports/capabilities/offer-field-updater.capability';
import type { UpdateOfferFieldsReport } from '../../domain/types/offer-fields-update.types';
import { AvailabilityUnknownError } from '../../domain/exceptions/availability-unknown.error';
import type { PriceChangeEpisode } from '../../domain/entities/price-change-episode.entity';
// Not `import type` (#3161 review / eslint `consistent-type-imports`): each of
// these is used as a constructor parameter type on `@Injectable()`, so
// TypeScript's decorator-metadata emission needs the binding to survive — the
// same reason `price-change-detection.service.ts` imports `ConnectionPort`
// the identical way.
import { PriceChangeEpisodeRepositoryPort } from '../../domain/ports/price-change-episode-repository.port';
import { PriceChangeAutoAppliedLogRepositoryPort } from '../../domain/ports/price-change-auto-applied-log-repository.port';
import { ListingCreationRecordRepositoryPort } from '../../domain/ports/listing-creation-record-repository.port';
import {
  PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN,
  PRICE_CHANGE_AUTO_APPLIED_LOG_REPOSITORY_TOKEN,
  OFFER_MAPPINGS_SERVICE_TOKEN,
  PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN,
  BULK_LISTING_PROGRESS_SERVICE_TOKEN,
  LISTING_CREATION_RECORD_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import { IOfferMappingsService } from './offer-mappings.service.interface';
import { IProductPublishExecutionService } from '../interfaces/product-publish-execution.service.interface';
import { IBulkListingProgressService } from './bulk-listing-progress.service.interface';
import type {
  PriceChangeApplyInput,
  PriceChangeApplyResult,
} from '../../domain/types/price-change-apply.types';
import type { ShopPublishRequestSnapshot } from '../../domain/types/listing-creation-record.types';
import type { IPriceChangeApplyService } from './price-change-apply.service.interface';

/**
 * A DETERMINISTIC, non-retryable condition raised while resolving *which*
 * capability to publish through, or while resolving the marketplace offer
 * mapping. Caught by `applyPriceChange` and converted to `business_failure`
 * — never left to propagate, since every one of these is a config/data state
 * that a retry of the identical call cannot change.
 */
class PriceChangeApplyPermanentError extends Error {}

@Injectable()
export class PriceChangeApplyService implements IPriceChangeApplyService {
  private readonly logger = new Logger(PriceChangeApplyService.name);

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(OFFER_MAPPINGS_SERVICE_TOKEN)
    private readonly offerMappings: IOfferMappingsService,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQuery: IInventoryQueryService,
    @Inject(PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN)
    private readonly productPublishExecution: IProductPublishExecutionService,
    @Inject(PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN)
    private readonly episodes: PriceChangeEpisodeRepositoryPort,
    @Inject(PRICE_CHANGE_AUTO_APPLIED_LOG_REPOSITORY_TOKEN)
    private readonly autoAppliedLog: PriceChangeAutoAppliedLogRepositoryPort,
    @Inject(BULK_LISTING_PROGRESS_SERVICE_TOKEN)
    private readonly bulkProgress: IBulkListingProgressService,
    @Inject(LISTING_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly listingRecords: ListingCreationRecordRepositoryPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly syncCursors: ISyncCursorsService
  ) {}

  async applyPriceChange(input: PriceChangeApplyInput): Promise<PriceChangeApplyResult> {
    let episode: PriceChangeEpisode | null = null;
    if (input.episodeId) {
      episode = await this.episodes.findById(input.episodeId);
      if (!episode) {
        return this.terminal(
          input,
          `Price-change episode not found: ${input.episodeId}`
        );
      }
      // Defensive re-check (ADR-072 decision 8): a currency-mismatch block
      // must never retry 10x before dead-lettering — it can never succeed.
      // The detection service never enqueues a blocked pair, and #3145's
      // accept endpoint must refuse to enqueue one either, but this stays as
      // a belt-and-braces check against either drifting.
      if (episode.blockReason) {
        return this.terminal(
          input,
          `episode ${input.episodeId} carries blockReason=${episode.blockReason}`
        );
      }
    }

    try {
      await this.publishPrice(input);
    } catch (error) {
      if (error instanceof PriceChangeApplyPermanentError) {
        return this.terminal(input, error.message);
      }
      // Transient / unclassified: propagate with `.cause` preserved so the
      // runner's registered `RetryClassifierPort`s (which unwrap
      // `SyncJobExecutionError.cause`) can still recognise a deterministic
      // adapter-native rejection — the caller (the worker handler) wraps
      // this in `SyncJobExecutionError` with `cause: error`.
      throw error;
    }

    const appliedAt = new Date();

    if (input.episodeId && episode) {
      const resolved = await this.episodes.resolve(
        input.episodeId,
        input.manualPriceOverride ? 'accepted-custom' : 'accepted',
        input.resolvedByUserId ?? null,
        input.manualPriceOverride ? input.amount : null,
        appliedAt
      );
      if (!resolved) {
        // Lost race (#3161 review, "at minimum stop discarding the
        // boolean"): another caller already resolved this episode — a
        // manual accept racing this job's own automatic-apply, or a crashed
        // prior attempt's retry landing after a peer's resolve. The price
        // was still published successfully above; there is nothing more to
        // reconcile here, so this is a warning, not a failure.
        this.logger.warn(
          `[price-change-apply] episode ${input.episodeId} was already resolved by the time this ` +
            `apply completed (concurrent resolution) — the price was published; leaving the ` +
            `existing resolution in place`
        );
      }
    }

    // The auto-applied log is a distinct, always-additive feed of "published
    // WITHOUT review" changes (#3144, ADR-072 decision 3) — orthogonal to
    // episode resolution. Discriminated on `input.automatic`, never on
    // `input.episodeId`: since #3159 the detection service unconditionally
    // opens/refreshes an episode before deciding whether to ALSO enqueue an
    // automatic apply, so `episodeId` is populated on every current apply
    // and can no longer distinguish "automatic" from "operator accepted via
    // the review queue" (#3145's future accept/edit endpoints resolve an
    // episode too, but must never write here).
    if (input.automatic) {
      await this.autoAppliedLog.record({
        productVariantId: input.productVariantId,
        destinationConnectionId: input.destinationConnectionId,
        sourceConnectionId: input.sourceConnectionId,
        // The REAL prior baseline, read off the episode this same detection
        // pass opened/refreshed — never fabricated as equal to `newAmount`
        // (#3161 review). `null` when the episode itself carries no
        // baseline (a brand-new mapping's first-ever detection, #3159) or
        // when — defensively — no episode exists at all for this apply.
        oldAmount: episode?.computedOldAmount ?? null,
        newAmount: input.amount,
        currency: input.currency,
        appliedAt,
      });
    }

    await this.advanceBulkProgress(input, 'succeeded');

    return { outcome: 'ok' };
  }

  private async terminal(
    input: PriceChangeApplyInput,
    reason: string
  ): Promise<PriceChangeApplyResult> {
    this.logger.warn(`[price-change-apply] refusing as a terminal business failure: ${reason}`);
    await this.advanceBulkProgress(input, 'failed');
    return { outcome: 'business_failure', reason };
  }

  /**
   * Publishes the amount via whichever capability the destination actually
   * has enabled — `OfferFieldUpdater.updateOfferFields` for a marketplace, or
   * a `ProductPublisher` re-publish for a shop.
   *
   * **Never resolves the branch by catching an exception (#3161 review,
   * BLOCKING).** `getCapabilityAdapter`'s failure modes are a superclass/
   * subclass pair — `CapabilityNotEnabledException extends
   * CapabilityNotSupportedException`, explicitly so a generic catch of the
   * super-type cannot tell "the adapter doesn't support this at all" apart
   * from "the operator simply hasn't enabled it on this connection" (see
   * that exception's own docblock). On WooCommerce's default configuration
   * `OfferManager` defaults OFF whenever `InventoryMaster` is also enabled,
   * so a caught-and-swallowed `CapabilityNotEnabledException` there was
   * silently misread as "this is a shop connection" — which happened to
   * work by accident, but the same swallow also hid a genuine
   * misconfiguration on a MARKETPLACE connection where the operator forgot
   * to enable `OfferManager`, and the marketplace/shop decision must not
   * depend on which one throws first.
   *
   * Instead: resolve `resolveAdapterMetadata` (metadata-only — constructs no
   * adapter, so it works even on a disabled connection, the #2353
   * `AuthorityStatusService` precedent) and cross it with the connection's
   * OWN `enabledCapabilities`, exactly mirroring what `getCapabilityAdapter`
   * checks internally — so by the time either branch calls
   * `getCapabilityAdapter`, both capability-support AND capability-enabled
   * are already known to hold.
   */
  private async publishPrice(input: PriceChangeApplyInput): Promise<void> {
    const connection = await this.connections.get(input.destinationConnectionId);
    const metadata = await this.integrationsService.resolveAdapterMetadata({
      platformType: connection.platformType,
      adapterKey: connection.adapterKey,
    });

    const hasOfferManager =
      metadata.supportedCapabilities.includes('OfferManager') &&
      connection.enabledCapabilities.includes('OfferManager');
    const hasProductPublisher =
      metadata.supportedCapabilities.includes('ProductPublisher') &&
      connection.enabledCapabilities.includes('ProductPublisher');

    if (hasOfferManager) {
      const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
        input.destinationConnectionId,
        'OfferManager'
      );
      // The adapter supporting/enabling `OfferManager` does not by itself
      // guarantee it implements the `OfferFieldUpdater` sub-capability
      // (WooCommerce's `OfferManager` adapter implements ONLY
      // `updateOfferQuantity`, no field updates at all) — a structural,
      // permanent mismatch, never retryable.
      if (!isOfferFieldUpdater(adapter)) {
        throw new PriceChangeApplyPermanentError(
          `Adapter for connection ${input.destinationConnectionId} supports OfferManager but ` +
            `not the OfferFieldUpdater sub-capability (no updateOfferFields)`
        );
      }
      await this.publishToMarketplace(adapter, input);
      return;
    }

    if (hasProductPublisher) {
      await this.publishToShop(input);
      return;
    }

    throw new PriceChangeApplyPermanentError(
      `Connection ${input.destinationConnectionId} has neither OfferManager nor ProductPublisher ` +
        `enabled (supported: ${metadata.supportedCapabilities.join(', ') || '<none>'}; ` +
        `enabled: ${connection.enabledCapabilities.join(', ') || '<none>'})`
    );
  }

  private async publishToMarketplace(
    adapter: OfferManagerPort & OfferFieldUpdater,
    input: PriceChangeApplyInput
  ): Promise<void> {
    const page = await this.offerMappings.findForVariant(
      input.destinationConnectionId,
      input.productVariantId
    );
    if (page.items.length === 0) {
      throw new PriceChangeApplyPermanentError(
        `No offer mapping found for variant=${input.productVariantId} on connection=${input.destinationConnectionId}`
      );
    }

    // #3161 re-review, IMPORTANT — `toFixed(2)` hardcoded two minor units.
    // False for every zero-decimal currency (JPY, KRW, ...) and every
    // three/four-decimal one — the same defect `splitShippingAcrossRates`
    // (ADR-063 §5) exists to avoid, so this reads the identical shared table
    // rather than a second hardcoded assumption.
    const minorUnitExponent = minorUnitExponentFor(input.currency);
    const priceAmount = input.amount.toFixed(minorUnitExponent);

    const externalOfferIds = new Set(page.items.map((item) => item.externalId));
    const frozenOffers: string[] = [];
    const succeededOffers: string[] = [];
    for (const externalOfferId of externalOfferIds) {
      // #3161 re-review, SUGGESTION — the key must be stable across a RETRY
      // of the same apply (so adapter-side dedup can fire) and DISTINCT from
      // any earlier or later apply for the same offer. `episodeId` is that
      // identity for the overwhelming majority of applies (present on every
      // automatic-mode apply since #3159, and on every review-queue
      // accept/edit); the `amount:currency` fallback exists only for the
      // type's residual `episodeId?:` case and still varies with the actual
      // price rather than with wall-clock time. Namespaced `pricing:apply:`
      // — distinct from `PriceChangeDetectionService`'s own
      // `pricing:episode:{id}:auto` SYNC-JOB dedup key (a different layer,
      // but kept textually unambiguous rather than merely non-colliding).
      const applyKeyPart = input.episodeId
        ? `episode:${input.episodeId}`
        : `amount:${input.amount}:${input.currency}`;
      const report = await adapter.updateOfferFields({
        externalOfferId,
        fields: { price: { amount: priceAmount, currency: input.currency } },
        idempotencyKey: `pricing:apply:${input.productVariantId}:${input.destinationConnectionId}:${externalOfferId}:${applyKeyPart}`,
      });
      // #3161 review, IMPORTANT — a destination that DROPS the field it was
      // asked to change (a seller-frozen price, #988 / ADR-025 §4b) reports
      // it in `UpdateOfferFieldsReport.frozenFields` precisely so a caller
      // can tell "written" from "silently dropped" (the offer-field-updater
      // capability's own docblock). Ignoring the report and resolving the
      // episode/logging the apply as successful would record a write that
      // never happened.
      if (this.findFrozenPriceField(report)) {
        frozenOffers.push(externalOfferId);
      } else {
        succeededOffers.push(externalOfferId);
      }
    }

    if (frozenOffers.length === 0) {
      return;
    }

    if (succeededOffers.length === 0) {
      // Every mapped offer refused the write — nothing changed on the
      // channel, so this is a genuine total failure exactly as before.
      throw new PriceChangeApplyPermanentError(
        `Price frozen by the seller on the destination for offer(s) ` +
          `${frozenOffers.join(', ')} on connection=${input.destinationConnectionId} — the ` +
          `destination reported the price field as frozen and did not apply it`
      );
    }

    // #3161 re-review, IMPORTANT — a PARTIAL write is not a total failure
    // (the #2593 "a failed product does not fail the page" rule, applied one
    // grain down): at least one mapped offer's price genuinely changed on
    // the channel, so resolving the whole episode as `business_failure`
    // would discard that real progress and send an operator to retry a
    // write that already partly landed — sequentially retrying an already-
    // applied idempotency key is a no-op, but the frozen offer(s) would fail
    // identically every time, so the episode would never resolve at all.
    // There is no per-offer slot on the episode or the auto-applied-log to
    // persist the frozen subset against today (out of scope for this pass);
    // a warning is the honest limit of what this call can report.
    this.logger.warn(
      `[price-change-apply] partial price write for variant=${input.productVariantId} on ` +
        `connection=${input.destinationConnectionId}: applied on ${succeededOffers.join(', ')}; ` +
        `seller-frozen (not applied) on ${frozenOffers.join(', ')}`
    );
  }

  private findFrozenPriceField(report: UpdateOfferFieldsReport | void): boolean {
    if (!report) {
      return false;
    }
    return (report.frozenFields ?? []).some((entry) => entry.field === 'price');
  }

  private async publishToShop(input: PriceChangeApplyInput): Promise<void> {
    // #3161 review: passing only `{stock, status, price}` would leave
    // `destinationCategoryIds` / `parameters` / `content` all re-DERIVED by
    // the builder on every price-only change — re-provisioning the shop's
    // category tree, re-projecting attribute parameters, and overwriting
    // channel-specific content with the master description. Reuse whatever
    // the last successful publish for this (variant, connection) actually
    // sent, so a price-only apply stays a price-only write in practice.
    // `ShopProductManagerPort` has no partial-field-update primitive, so
    // "send everything, but send the SAME everything" is the closest this
    // capability can get without a port change (out of scope here).
    const previous = await this.listingRecords.findLatestByVariantAndConnection(
      input.productVariantId,
      input.destinationConnectionId
    );
    const snapshot = previous?.request;

    // #3161 re-review, IMPORTANT — this call carries an ABSOLUTE stock
    // quantity on a PRICE-only apply, and `executePublish` -> `publishProduct`
    // does not go through `InventorySyncService.updateOfferQuantities`, where
    // ADR-067/#2617's per-(connection, offer) lock and
    // `inventory.offerQuantity.observedAt` freshness mark live — so an
    // unguarded read-here/write-there race against a CONCURRENT
    // `inventory.propagateToMarketplaces` quantity write-back for the SAME
    // ShopProduct target could land an older quantity last (the exact
    // oversell ADR-067 exists to prevent). `ShopProductManagerPort` has no
    // partial-update primitive that would let this write carry price WITHOUT
    // also carrying stock (`ExecutePublishProductInput.stock` is required) —
    // that remains a genuine port-level gap, tracked separately rather than
    // invented around here.
    //
    // What IS reachable without a port change: `InventorySyncService`'s shop
    // write-back branch keys its lock/cursor by the `ShopProduct` EXTERNAL
    // id under this same connection (its own docblock: "`offerId` also
    // carries a `ShopProduct` external id on the shop write-back branch").
    // Resolving that same external id here and taking the SAME lock +
    // cursor around a fresh read-then-write correctly serialises this
    // write against THAT specific writer — the concrete race this finding
    // names — even though it cannot (and does not claim to) guard against
    // every other `executePublish` caller (`shop.product.publish`, bulk
    // shop-publish), none of which touch this cursor either; that remains
    // the documented, wider, out-of-scope gap.
    const externalOfferId = await this.resolveShopProductExternalId(input);
    if (externalOfferId === null) {
      // No prior mapping to key a lock on — nothing has written this target
      // via the guarded path either, so there is nothing to race against
      // yet. Publish unguarded rather than block on a lock that protects
      // nothing.
      await this.executeShopPublish(input, snapshot, await this.resolveShopStock(input));
      return;
    }

    await this.publishToShopGuarded(input, snapshot, externalOfferId);
  }

  private async publishToShopGuarded(
    input: PriceChangeApplyInput,
    snapshot: ShopPublishRequestSnapshot | null | undefined,
    externalOfferId: string
  ): Promise<void> {
    const lockKey = offerQuantityWriteLockKey(input.destinationConnectionId, externalOfferId);
    const token = await this.syncLock.acquire(lockKey, OFFER_QUANTITY_WRITE_LOCK_TTL_MS);
    if (token === null) {
      // A peer (the ordinary inventory quantity write-back, or a concurrent
      // apply of this same episode) holds the lock. Report contention —
      // never silently proceed unguarded, which is exactly the race this
      // guard exists to close — and let the runner defer this job
      // penalty-free (#2617 review): contention is the guard working, not
      // this job failing.
      throw new ContendedWriteError(
        `Another stock write for ShopProduct ${externalOfferId} on connection=` +
          `${input.destinationConnectionId} is in flight`,
        lockKey
      );
    }

    try {
      const stock = await this.resolveShopStock(input);
      const cursorKey = offerQuantityObservationCursorKey(externalOfferId);
      const observedAt = stock.observedAt;

      if (observedAt !== null) {
        const lastWritten = await this.syncCursors.getCursor(
          input.destinationConnectionId,
          cursorKey
        );
        if (!isWritableQuantityObservation(observedAt, lastWritten)) {
          // Reachable only under clock skew or an unparseable mark — this
          // read happened INSIDE the lock, so under the ordinary case it is
          // already at least as fresh as anything the guard could compare it
          // against. Logged rather than acted on: refusing here would drop
          // the PRICE change too, and there is no partial-field write to
          // fall back to.
          this.logger.warn(
            `[price-change-apply] stock observation for ShopProduct ${externalOfferId} on ` +
              `connection=${input.destinationConnectionId} is not newer than the last mark ` +
              `(observed=${observedAt} lastWritten=${lastWritten ?? 'none'}); publishing anyway`
          );
        }
      }

      await this.executeShopPublish(input, snapshot, stock);

      if (observedAt !== null) {
        const advanced = await this.syncCursors.advanceCursorIfNewer(
          input.destinationConnectionId,
          cursorKey,
          observedAt
        );
        if (!advanced) {
          this.logger.warn(
            `[price-change-apply] stock mark for ShopProduct ${externalOfferId} on connection=` +
              `${input.destinationConnectionId} was not moved (observed=${observedAt}): a newer ` +
              `observation is already marked`
          );
        }
      }
    } finally {
      await this.syncLock.release(lockKey, token);
    }
  }

  /**
   * `availableToPromise` — NEVER `totalAvailable` — and never defaulted to
   * `0` on `null` (#3161 review, BLOCKING). `totalAvailable` is not net of
   * OL's own published reservations (over-publishes); a `null` ATP means
   * "OpenLinker does not know", which must suppress the write, never stand
   * in for a real zero — writing `0` as an ABSOLUTE quantity is the #1689
   * pause primitive and would silently deactivate a live listing.
   * `AvailabilityUnknownError` is the exact exception both shipped
   * publishing consumers (`ProductPublishBuilderService`,
   * `OfferBuilderService`) throw for this state — it is explicitly
   * RETRYABLE (its own docblock), so it propagates uncaught here and the
   * runner retries once availability resolves.
   */
  private async resolveShopStock(
    input: PriceChangeApplyInput
  ): Promise<{ quantity: number; observedAt: string | null }> {
    const [availability] = await this.inventoryQuery.getAvailabilityByVariantIds([
      input.productVariantId,
    ]);
    if (!availability || availability.availableToPromise === null) {
      throw new AvailabilityUnknownError(input.destinationConnectionId, input.productVariantId);
    }
    return {
      quantity: availability.availableToPromise,
      observedAt: availability.stockUpdatedAt ? availability.stockUpdatedAt.toISOString() : null,
    };
  }

  private async resolveShopProductExternalId(input: PriceChangeApplyInput): Promise<string | null> {
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.ShopProduct,
      input.productVariantId
    );
    const forConnection = mappings.find((m) => m.connectionId === input.destinationConnectionId);
    return forConnection?.externalId ?? null;
  }

  private async executeShopPublish(
    input: PriceChangeApplyInput,
    snapshot: ShopPublishRequestSnapshot | null | undefined,
    stock: { quantity: number; observedAt: string | null }
  ): Promise<void> {
    // A price-change episode/automatic-apply only ever exists for an
    // ALREADY-mapped, already-live listing (the detection service walks
    // existing ShopProduct mappings) — so `status: 'published'` is the
    // correct re-publish target, not a guess.
    const result = await this.productPublishExecution.executePublish({
      internalVariantId: input.productVariantId,
      connectionId: input.destinationConnectionId,
      stock: stock.quantity,
      status: 'published',
      price: { amount: input.amount, currency: input.currency },
      destinationCategoryIds: snapshot?.destinationCategoryIds,
      content: snapshot?.content,
      commerce: snapshot?.commerce,
      parameters: snapshot?.parameters,
    });

    // `executePublish` already converts a terminal shop-side rejection
    // (builder validation, master-catalog misconfig, a `ProductPublishRejectedException`)
    // into a persisted `failed` `ListingCreationRecord` and resolves
    // NORMALLY rather than throwing (its own docblock) — so a
    // `business_failure` outcome here must be surfaced the same way,
    // through the SAME `PriceChangeApplyPermanentError` -> terminal path
    // every other structural condition in this service uses, rather than a
    // second, differently-shaped exit.
    if (result.outcome === 'business_failure') {
      const messages = (result.listingCreationRecord.errors ?? [])
        .map((e) => e.message)
        .join('; ');
      throw new PriceChangeApplyPermanentError(
        `Shop publish rejected for variant=${input.productVariantId} on connection=` +
          `${input.destinationConnectionId}: ${messages || 'no error detail reported'}`
      );
    }
  }

  private async advanceBulkProgress(
    input: PriceChangeApplyInput,
    outcome: 'succeeded' | 'failed'
  ): Promise<void> {
    if (!input.batchId) {
      return;
    }
    // The advancement gate keys on `(bulkBatchId, childId)` and enforces no
    // FK — reusing it for a price-change child (rather than a real
    // `OfferCreationRecord`) is exactly the "SAME mechanism" #3144 asks for.
    const childId =
      input.episodeId ?? `automatic:${input.productVariantId}:${input.destinationConnectionId}`;
    await this.bulkProgress.advanceBatchStatus(input.batchId, childId, outcome);
  }
}
