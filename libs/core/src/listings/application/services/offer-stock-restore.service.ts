/**
 * Offer Stock Restore Service
 *
 * The order-cancellation sequence (#1146 / ADR-028, repointed onto the
 * reservation ledger by #2348). The `OrderIngestionService` observe hook
 * enqueues one `marketplace.offer.stockRestore` job per `→ cancelled`
 * transition — for EVERY marketplace, not just restorer-capable ones — and the
 * worker handler delegates here.
 *
 * ORDERING IS THE POINT, and it is enforced three ways:
 *
 *   1. `releaseHolds()` runs FIRST and UNCONDITIONALLY — before the
 *      `OfferStockRestorer` lookup, not after. Most connections expose no
 *      restorer (Allegro restores its own stock), so a release placed behind
 *      that short-circuit would leak a hold on every Allegro cancellation.
 *   2. `publishRestoredAtp()` takes the release's own `CloseForOrderResult` as
 *      its first parameter, so the ordering is expressed in the SIGNATURE
 *      rather than in a comment. Note the honest limit of that (#2628 review):
 *      it is a structural type, so an object literal of the same shape
 *      type-checks — this makes the dependency obvious and hard to reorder by
 *      accident, but it does NOT make reordering a compile error.
 *   3. **The shared-recorder spec is what actually pins the order.** It asserts
 *      the two effects in sequence, so a refactor that preserved the types but
 *      inverted the effects — exactly what (2) cannot catch — still fails.
 *
 * Why it matters: the ATP read filters `status = 'held'`, so releasing is what
 * makes the units reappear. Restoring first publishes a quantity still net of
 * the hold being cancelled — short by exactly the cancelled amount, on a live
 * offer, silently and forever.
 *
 * CRASH-KILL, not merely throw. This sequence deliberately has NO claim marker
 * of its own. The release's terminal status IS its record, and it is the same
 * fact the ATP read consults; the restore is an ABSOLUTE set, never a delta. So
 * a kill anywhere leaves the job un-succeeded, the retry re-runs the whole
 * sequence, the release closes nothing (guarded on `held`) and the restore
 * republishes the same number. The only state a kill can leave is a MISSING
 * restore — the safe direction (under-published, never over-published).
 *
 * The restore is an ABSOLUTE set from available-to-promise — re-runnable by
 * construction, so a job retry never double-counts. The adapter never reads
 * inventory; core resolves it here and passes plain targets, keeping the plugin
 * contract free of any core inventory service.
 *
 * Log hygiene (no PII): never logs buyer data, and never logs an order id at
 * `log`/info — this fires on every cancellation platform-wide. The internal
 * `ol_order_*` id appears at `debug`, and at `error`, where it is the only thing
 * that makes the failure actionable. (The rule is stated in both directions on
 * purpose: this docblock previously claimed "only at debug" while `releaseHolds`
 * logged the id at `error`, which is the same defect class this wave keeps
 * closing — a comment that was true when written and lies once the code moves.)
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferStockRestoreService}
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  CapabilityNotSupportedException,
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  IInventoryQueryService,
  INVENTORY_QUERY_SERVICE_TOKEN,
  IReservationService,
  RESERVATION_SERVICE_TOKEN,
  type CloseForOrderResult,
} from '@openlinker/core/inventory';
import {
  IShipmentQueryService,
  SHIPMENT_QUERY_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { IOrderRecordService, ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import type {
  OfferManagerPort,
  OfferStockRestorer,
  OfferStockRestoreTarget,
} from '@openlinker/core/listings';
import { isOfferStockRestorer, OfferMappingRepositoryPort } from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import { OFFER_MAPPING_REPOSITORY_TOKEN } from '../../listings.tokens';
import type { IOfferStockRestoreService } from '../interfaces/offer-stock-restore.service.interface';
import type { OfferStockRestoreResult } from '../types/offer-stock-restore.types';
import { OfferStockRestoreReleaseIncompleteError } from '../../domain/exceptions/offer-stock-restore-release-incomplete.error';

/**
 * Offer-mapping lookups are scoped per-variant (`internalId` filter), so a
 * variant maps to at most a handful of offer rows; a small page suffices.
 */
const OFFER_MAPPING_PAGE_LIMIT = 10;

@Injectable()
export class OfferStockRestoreService implements IOfferStockRestoreService {
  private readonly logger = new Logger(OfferStockRestoreService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappings: OfferMappingRepositoryPort,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQuery: IInventoryQueryService,
    @Inject(RESERVATION_SERVICE_TOKEN)
    private readonly reservations: IReservationService,
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly shipments: IShipmentQueryService,
  ) {}

  async restoreStockForCancelledOrder(
    connectionId: string,
    internalOrderId: string,
  ): Promise<OfferStockRestoreResult> {
    // STEP 1 — RELEASE, first and unconditionally. Deliberately ABOVE the
    // `OfferStockRestorer` short-circuit: most connections have no restorer, and
    // a release behind that guard would leak this order's hold forever on every
    // one of them.
    const release = await this.releaseHolds(internalOrderId);

    // STEP 2 — the goods already left the building. `Shipment.reservationConsumedAt`
    // is a DURABLE claim, never an inference from reservation status; #2348's
    // stated assumption is that the cancelled-after-dispatch contradiction is
    // displayed (story L6), not reconciled by republishing here. Logged at
    // `log`, not `debug` — rare, and an operator reading "why did my offer not
    // go back up" must be able to find it.
    if (await this.shipments.hasConsumedReservations(internalOrderId)) {
      // Two lines by design: the info-level one is the searchable signal an
      // operator asking "why did my offer not go back up" will find, and the
      // debug one carries the id that identifies WHICH order — which may not sit
      // at info (see the log-hygiene note in the file header).
      this.logger.log(
        `Stock-restore skipped: the order's goods already shipped (reservations consumed) ` +
          `[connectionId=${connectionId}]`,
      );
      this.logger.debug(
        `Stock-restore skipped (already shipped) [connectionId=${connectionId}, orderId=${internalOrderId}]`,
      );
      return this.skipped(release, 'skipped-consumed');
    }

    return this.publishRestoredAtp(release, connectionId, internalOrderId);
  }

  /**
   * Close every hold this cancelled order still carries, `held → released`.
   *
   * A non-zero `failed` THROWS rather than degrading. `closeForOrder` tolerates
   * per-row failure by counting it — correctly, one bad row must not abort the
   * rest of the order — but that tolerance belongs inside the ledger close, not
   * at this seam: "some holds are still live" is exactly the state that must not
   * be recorded as done. Publishing an ATP still net of those holds would
   * under-restore a live offer, and returning normally would end the job for
   * good (`SyncJobRunner` retries only a job that FAILED, and there is no
   * `stockRestoreSweep` reconcile task to heal it the way #1689's pause has
   * one). The whole sequence is idempotent, so the retry ladder is safe.
   */
  private async releaseHolds(internalOrderId: string): Promise<CloseForOrderResult> {
    const release = await this.reservations.closeForOrder({
      orderRecordId: internalOrderId,
      terminalStatus: 'released',
    });

    if (release.failed > 0) {
      this.logger.error(
        `cancellation_release_incomplete order=${internalOrderId} ` +
          `released=${String(release.closed)} failed=${String(release.failed)} — ` +
          `refusing to publish a restore while holds are still live; failing the job so the ` +
          `ordinary retry ladder re-runs the whole sequence`,
      );
      throw new OfferStockRestoreReleaseIncompleteError(internalOrderId, release.failed);
    }

    return release;
  }

  /**
   * Publish the recomputed available-to-promise to the marketplace.
   *
   * `release` is threaded in as the FIRST PARAMETER and is not optional: it is
   * obtainable only from {@link releaseHolds}, so this step cannot be reached
   * before the release has returned. That is the structural half of the ordering
   * guarantee — a reordering fails to compile, not merely a test.
   */
  private async publishRestoredAtp(
    release: CloseForOrderResult,
    connectionId: string,
    internalOrderId: string,
  ): Promise<OfferStockRestoreResult> {
    // Resolve the destination restorer before the per-variant reads below: the
    // ingestion hook enqueues this job on every `→ cancelled` transition
    // regardless of marketplace, so most invocations are for connections that
    // restore their own stock (Allegro) or expose no `OfferStockRestorer` at
    // all. A capability that is unsupported / disabled on the connection is a
    // routine no-op — not a job failure that should dead-letter.
    const restorer = await this.resolveStockRestorer(connectionId, internalOrderId);
    if (!restorer) {
      return this.skipped(release, 'skipped-no-restorer');
    }

    const record = await this.orderRecordService.getOrderRecord(internalOrderId);
    if (!record) {
      this.logger.debug(
        `Stock-restore skipped: no order record found [connectionId=${connectionId}, orderId=${internalOrderId}]`,
      );
      return this.skipped(release, 'skipped-no-targets');
    }

    const variantIds = this.collectVariantIds(record.orderSnapshot);
    if (variantIds.length === 0) {
      this.logger.debug(
        `Stock-restore skipped: order has no resolved variants [connectionId=${connectionId}, orderId=${internalOrderId}]`,
      );
      return this.skipped(release, 'skipped-no-targets');
    }

    // Resolve distinct external offer ids for these variants on the source
    // connection. One variant maps to at most one offer per connection here;
    // dedupe defensively so a variant with multiple mappings restores once.
    const externalOfferIdByVariant = await this.resolveExternalOfferIds(connectionId, variantIds);
    if (externalOfferIdByVariant.size === 0) {
      this.logger.debug(
        `Stock-restore skipped: no offer mapping for the order's variants [connectionId=${connectionId}, orderId=${internalOrderId}]`,
      );
      return this.skipped(release, 'skipped-no-targets');
    }

    const mappedVariantIds = [...externalOfferIdByVariant.keys()];
    const availability = await this.inventoryQuery.getAvailabilityByVariantIds(mappedVariantIds);
    // #2323 — restore to available-to-promise, not raw master stock: this writes
    // a live marketplace quantity, so it must be net of OL's own outstanding
    // holds. #2348 — and this read happens strictly AFTER `releaseHolds`, which
    // is why the cancelled order's own hold is no longer among them. On an empty
    // ledger the two numbers are identical, so no restore changes today.
    const targetByVariant = new Map(
      availability
        .filter((row): row is typeof row & { availableToPromise: number } =>
          row.availableToPromise !== null,
        )
        .map((row) => [row.productVariantId, row.availableToPromise]),
    );

    const targets: OfferStockRestoreTarget[] = [];
    for (const [variantId, externalOfferId] of externalOfferIdByVariant) {
      const quantity = targetByVariant.get(variantId);
      // OMITTED, not zeroed, when availability is unknown. `getAvailability
      // ByVariantIds` zero-fills every id it can answer for, so an absent entry
      // means OL does not know — and writing 0 there would DEACTIVATE a live
      // offer (#1689 uses exactly that primitive to pause one) on the strength
      // of a failed read.
      if (quantity === undefined) continue;
      targets.push({ externalOfferId, quantity });
    }

    if (targets.length === 0) {
      this.logger.debug(
        `Stock-restore skipped: availability unknown for every mapped variant [connectionId=${connectionId}, orderId=${internalOrderId}]`,
      );
      return this.skipped(release, 'skipped-no-targets');
    }

    this.logger.debug(
      `Restoring marketplace stock for ${targets.length} offer(s) [connectionId=${connectionId}, orderId=${internalOrderId}]`,
    );
    await restorer.restoreStockOnCancellation(targets);

    return {
      released: release.closed,
      alreadyTerminal: release.alreadyTerminal,
      offersRestored: targets.length,
      outcome: 'restored',
    };
  }

  /** A non-restoring exit that still reports what the release did. */
  private skipped(
    release: CloseForOrderResult,
    outcome: Exclude<OfferStockRestoreResult['outcome'], 'restored'>,
  ): OfferStockRestoreResult {
    return {
      released: release.closed,
      alreadyTerminal: release.alreadyTerminal,
      offersRestored: 0,
      outcome,
    };
  }

  /**
   * Resolve the connection's `OfferManager` adapter and narrow it to an
   * `OfferStockRestorer`, or return `null` when the source marketplace does not
   * participate in core-driven stock restore. All three "doesn't participate"
   * paths are routine no-ops, logged at debug — never `warn` (this fires on
   * every cancellation platform-wide) and never thrown (a thrown capability
   * error would fail the job and dead-letter it):
   *   - `OfferManager` not supported by the adapter, or not enabled on the
   *     connection → `CapabilityNotSupportedException` (and its
   *     `CapabilityNotEnabledException` subclass);
   *   - adapter present but does not implement `OfferStockRestorer` (e.g.
   *     Allegro, which restores its own stock on cancellation).
   */
  private async resolveStockRestorer(
    connectionId: string,
    internalOrderId: string,
  ): Promise<(OfferManagerPort & OfferStockRestorer) | null> {
    let adapter: OfferManagerPort;
    try {
      adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
        connectionId,
        'OfferManager',
      );
    } catch (error) {
      if (error instanceof CapabilityNotSupportedException) {
        this.logger.debug(
          `Stock-restore skipped: connection does not support/enable OfferManager [connectionId=${connectionId}, orderId=${internalOrderId}]`,
        );
        return null;
      }
      throw error;
    }

    if (!isOfferStockRestorer(adapter)) {
      this.logger.debug(
        `Stock-restore skipped: adapter does not implement OfferStockRestorer (marketplace restores its own stock) [connectionId=${connectionId}, orderId=${internalOrderId}]`,
      );
      return null;
    }

    return adapter;
  }

  /**
   * Pull the resolved internal variant ids from the persisted order snapshot.
   * `recordStatus='ready'` snapshots store the unified `Order` whose items carry
   * `variantId`; an `awaiting_mapping` snapshot (raw IncomingOrder) carries no
   * variant ids and yields an empty list (no-op). Reads defensively without
   * binding to the snapshot's full JSON layout. Deduped, order-preserving.
   */
  private collectVariantIds(snapshot: Record<string, unknown>): string[] {
    const items = snapshot.items;
    if (!Array.isArray(items)) {
      return [];
    }
    const seen = new Set<string>();
    for (const item of items) {
      if (item && typeof item === 'object') {
        const variantId = (item as { variantId?: unknown }).variantId;
        if (typeof variantId === 'string' && variantId.length > 0) {
          seen.add(variantId);
        }
      }
    }
    return [...seen];
  }

  /**
   * Map each variant id to its distinct external offer id on the connection.
   * Queries the `Offer` mappings per variant (`internalId` filter;
   * `externalId`=offer id, `internalId`=variant id). Variants with no offer
   * mapping are omitted; the first mapping wins when a variant has several.
   */
  private async resolveExternalOfferIds(
    connectionId: string,
    variantIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const variantId of variantIds) {
      const page = await this.offerMappings.findMappingPage(
        { connectionId, internalId: variantId },
        { limit: OFFER_MAPPING_PAGE_LIMIT, offset: 0 },
      );
      const mapping = page.items[0];
      if (mapping) {
        result.set(variantId, mapping.externalId);
      }
    }
    return result;
  }
}
