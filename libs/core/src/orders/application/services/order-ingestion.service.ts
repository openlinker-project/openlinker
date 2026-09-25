/**
 * Order Ingestion Service
 *
 * Core-owned marketplace order ingestion + routing orchestration.
 *
 * Responsibilities:
 * - Single-flight ingestion per connection (lock)
 * - Cursor read/commit safety
 * - Deterministic dedupe keys for downstream jobs
 * - Hydration of full order via OrderSourcePort and routing via OrderSyncService
 *
 * @module libs/core/src/orders/application/services
 * @see {@link ISyncCursorsService} for the cross-context cursor seam (#718)
 */

import { Injectable, Inject } from '@nestjs/common';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OrderSourcePort } from '@openlinker/core/orders';
import {
  ISyncCursorsService,
  SYNC_CURSORS_SERVICE_TOKEN,
  SyncJobQueuePort,
  SYNC_JOB_QUEUE_TOKEN,
  SyncLockPort,
  SYNC_LOCK_TOKEN,
} from '@openlinker/core/sync';
import { IIdentifierMappingService, IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE, CONNECTION_PORT_TOKEN, type Connection, type ConnectionPort } from '@openlinker/core/identifier-mapping';
import {
  IAutoIssueTriggerService,
  AUTO_ISSUE_TRIGGER_SERVICE_TOKEN,
} from '@openlinker/core/invoicing';
import {
  ICustomerIdentityResolverService,
  CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN,
  IOrderCustomerProjectionUpdaterService,
  ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN,
} from '@openlinker/core/customers';
import { IOrderSyncService } from '../interfaces/order-sync.service.interface';
import type {
  IOrderIngestionService,
  OrderIngestionOptions,
  OrderIngestionResult,
} from '../interfaces/order-ingestion.service.interface';
import {
  ORDER_SYNC_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN,
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
} from '../../orders.tokens';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { IOrderItemRefResolverService } from '../interfaces/order-item-ref-resolver.service.interface';
import { IOrderLifecycleRelayService } from '../interfaces/order-lifecycle-relay.service.interface';
import type { IncomingOrder, IncomingOrderItem } from '../../domain/types/incoming-order.types';
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
  TAX_RATE_JOURNAL_SERVICE_TOKEN,
  taxRateState,
  type ITaxRateJournalService,
  type StoredTaxRate,
  type TaxRateSource,
} from '@openlinker/core/products';
import {
  RESERVATION_SERVICE_TOKEN,
  type IReservationService,
  type ReserveOrderLineInput,
  AmbiguousReservationPositionError,
} from '@openlinker/core/inventory';
import {
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  type IFulfillmentRoutingService,
  FULFILLMENT_PROCESSOR_KIND,
  type FulfillmentRoutingResolution,
} from '@openlinker/core/mappings';
import {
  FULFILLMENT_ROUTER_RESOLVER_TOKEN,
  ROUTING_COMMIT_SERVICE_TOKEN,
  buildRoutingShipTo,
  deriveFulfillmentDispatchEnqueueIntents,
  deriveRoutingHoldOutcome,
  deriveSaleDecrementEnqueueIntents,
  findUndispatchableWorkIds,
  type FulfillmentBlock,
  type FulfillmentRouterPort,
  type FulfillmentRouterResolverPort,
  type IRoutingCommitService,
  type RoutingCommitOutcome,
  type RoutingInputLine,
  type RoutingShipTo,
} from '@openlinker/core/fulfillment';
import {
  isFulfillmentRouterUnroutable,
  selectPrimaryFulfillmentRouter,
  type AuthorityAttentionOutcome,
  type AuthorityClaimantInput,
} from '@openlinker/core/fulfillment-authority';
import type { ReservationAtpEffect } from '@openlinker/core/inventory';
import type { Order } from '../../domain/types/order.types';
import type { OrderFeedEventType } from '../../domain/types/order-feed.types';
import { compareOrderCursors } from '../../domain/types/order-cursor.types';
import { withheldOnHoldError } from '../../domain/types/order-hold.types';
import {
  isOrderFromOwnProductMaster,
  isOrderMirroredBeforeRouting,
  isOrderShippedElsewhere,
  type FulfillmentRoutingSkipReason,
} from '../../domain/types/fulfillment-routing-eligibility.types';
import type { OrderRecord } from '../../domain/entities/order-record.entity';
import type { SalesDocumentBlockOutcome } from '@openlinker/core/sales-documents';
import type { OrderRecordStatus } from '../../domain/types/order-record.types';
import type { ItemResolutionFailureKind } from './order-item-ref-resolver.types';
import { getEnvBoolean } from '@openlinker/shared/config';
import { Logger } from '@openlinker/shared/logging';
import { diffOrderAmendment } from '../../domain/order-amendment-diff';
import { MissingOrderItemMappingError } from '../../domain/exceptions/missing-order-item-mapping.error';

/**
 * What the #2396 intercept decided for one order.
 *
 * `held` and `block` are independent: a `routed` order is held with NO block
 * (the work object explains it), and an `ambiguous` one is not held and also
 * carries no block (#2352's A2-A row already reports it). Collapsing them into
 * one nullable field would make those two states indistinguishable.
 */
interface FulfillmentInterceptOutcome {
  readonly held: boolean;
  readonly block: FulfillmentBlock | null;
  /**
   * Whether the intercept deliberately did not route the order (#3455; also
   * #3487 / #3488). Independent of `held` and `block`: a skipped order is not
   * held and carries no block. `indeterminate` - the fail-open catch - leaves a
   * previously persisted reason untouched, the #2100 rule: clearing it on a
   * transient error would trade a true answer for silence.
   */
  readonly skip: FulfillmentRoutingSkipOutcome;
  /**
   * The order's `routing` producer entry — UF-L, `line-unfulfillable` (#3485).
   * Written by `persistFulfillmentOutcome`; `indeterminate` writes nothing, which
   * is what every arm OUTSIDE an OMS routing attempt reports, so an install that
   * routes nothing pays no extra statement.
   */
  readonly lineAttention: AuthorityAttentionOutcome<'routing'>;
}

const LINE_ATTENTION_UNTOUCHED: AuthorityAttentionOutcome<'routing'> = { kind: 'indeterminate' };

type FulfillmentRoutingSkipOutcome =
  | { readonly kind: 'skipped'; readonly reason: FulfillmentRoutingSkipReason }
  | { readonly kind: 'none' }
  | { readonly kind: 'indeterminate' };

const ROUTING_NOT_SKIPPED: FulfillmentRoutingSkipOutcome = { kind: 'none' };

/**
 * What this order's fulfilment routing will do, resolved ONCE (#3480).
 *
 * Resolved before the advisory hold is recorded, so the hold's immutable
 * `atpEffect` and the intercept that routes the order are decided from the same
 * answer and cannot disagree — which is also why #3487 / #3455 / #3488's skip
 * rules are decided here rather than in the intercept: checked later, the hold
 * of an order that is never routed would be stamped `published`.
 *
 * - `route` — exactly one router holds A2 and is wired.
 * - `skip` — OpenLinker deliberately leaves the order on today's path; the
 *   reason is persisted (#3455).
 * - `pass` — nobody claims A2, the claim is ambiguous, or the claimant has no
 *   router wired. Nothing to explain, so any persisted skip reason is cleared.
 * - `indeterminate` — the resolution failed. Today's path, and a previously
 *   persisted skip reason is left untouched (the #2100 rule).
 */
type RoutingTarget =
  | {
      readonly kind: 'route';
      readonly holder: string;
      readonly router: FulfillmentRouterPort;
    }
  | { readonly kind: 'skip'; readonly reason: FulfillmentRoutingSkipReason }
  | { readonly kind: 'pass' }
  | { readonly kind: 'indeterminate' };

/** The ADR-062 allowlist projection handed to a router. */
interface RoutingProjection {
  readonly lines: RoutingInputLine[];
  readonly shipTo: RoutingShipTo;
  readonly requestedDeliveryMethod: string | null;
}

@Injectable()
export class OrderIngestionService implements IOrderIngestionService {
  private readonly logger = new Logger(OrderIngestionService.name);

  // Keep comfortably above worst-case poll+enqueue duration; we currently do not refresh TTL.
  private readonly LOCK_TTL_MS = 5 * 60_000;

  // A cursor shape core cannot order is reported once per (connection, cursorKey).
  // It is a standing property of that adapter's cursor, not a per-poll event, so
  // logging it every tick would bury the regressions this guard exists to surface.
  private readonly reportedUnrecognisedCursors = new Set<string>();

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly syncCursors: ISyncCursorsService,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(ORDER_ITEM_REF_RESOLVER_SERVICE_TOKEN)
    private readonly orderItemRefResolver: IOrderItemRefResolverService,
    @Inject(ORDER_SYNC_SERVICE_TOKEN)
    private readonly orderSyncService: IOrderSyncService,
    @Inject(CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN)
    private readonly customerIdentityResolver: ICustomerIdentityResolverService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
    @Inject(ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN)
    private readonly customerProjectionUpdater: IOrderCustomerProjectionUpdaterService,
    @Inject(ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN)
    private readonly orderLifecycleRelay: IOrderLifecycleRelayService,
    // OL #1120: core policy composer that turns this transition into per-connection
    // issuance jobs. One-way edge (F3) — this service is consumed via the token,
    // never the reverse.
    @Inject(AUTO_ISSUE_TRIGGER_SERVICE_TOKEN)
    private readonly autoIssueTrigger: IAutoIssueTriggerService,
    // #2054: the catalogue projection the per-line tax rate is settled from.
    // A read of OL's own store, never a live shop call - issuance must not
    // depend on the shop being reachable.
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    // #2250: an inbound order line is the one place a CHANNEL states a rate in
    // its own voice, so it is where the `channel` half of the provenance
    // journal is fed. Token/interface edge into `products`, like the read above.
    @Inject(TAX_RATE_JOURNAL_SERVICE_TOKEN)
    private readonly taxRateJournal: ITaxRateJournalService,
    // #2344: OL's own advisory reservation ledger. Appended last, like every
    // dependency added since. One-way edge — `inventory` never imports `orders`.
    @Inject(RESERVATION_SERVICE_TOKEN)
    private readonly reservationService: IReservationService,
    // #2344: the routing outcome the reservation's `atpEffect` is stamped from.
    // Read HERE rather than inside the reservation service, because resolving it
    // there would create the `inventory -> fulfillment` read ADR-061 decision 1
    // exists to eliminate.
    @Inject(FULFILLMENT_ROUTING_SERVICE_TOKEN)
    private readonly fulfillmentRouting: IFulfillmentRoutingService,
    // #2396: the fulfilment routing commit. One-way edge — `fulfillment` is a
    // zero-sibling-edge leaf and injects no `orders` service; it REPORTS the
    // outcome and this service, which owns the order record, WRITES it.
    @Inject(ROUTING_COMMIT_SERVICE_TOKEN)
    private readonly routingCommit: IRoutingCommitService,
    // #2396: A2 claimants are resolved from connection config, so the intercept
    // needs the connection list. `selectPrimaryFulfillmentRouter` is pure and
    // does the deciding.
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    // #2408: the ONE seam answering "is there a router for this connection?".
    // REQUIRED, never `@Optional()` — an optional token defaulting to `null`
    // would make a host that FORGOT the binding indistinguishable from one
    // deliberately running router-less, and that misconfiguration is otherwise
    // invisible (the router-less path is a silent, fully-specified pass-through).
    @Inject(FULFILLMENT_ROUTER_RESOLVER_TOKEN)
    private readonly routerResolver: FulfillmentRouterResolverPort
  ) {}

  async ingestOrders(
    connectionId: string,
    options: OrderIngestionOptions
  ): Promise<OrderIngestionResult> {
    const lockKey = `marketplace:orders:poll:${connectionId}`;
    const token = await this.lock.acquire(lockKey, this.LOCK_TTL_MS);
    if (!token) {
      this.logger.debug(`Skipping ingestion: lock not acquired (${lockKey})`);
      return {
        fetched: 0,
        enqueued: 0,
        nextCursor: null,
        committed: false,
        skippedDueToLock: true,
      };
    }

    try {
      const { cursorKey, limit, eventTypes } = options;
      const fromCursor = await this.syncCursors.getCursor(connectionId, cursorKey);

      const orderSource = await this.integrationsService.getCapabilityAdapter<OrderSourcePort>(
        connectionId,
        'OrderSource'
      );

      const feed = await orderSource.listOrderFeed({
        fromCursor,
        limit,
        eventTypes,
      });

      const requests = feed.items.map((item) => ({
        type: 'marketplace.order.sync' as const,
        connectionId,
        payload: {
          schemaVersion: 1 as const,
          externalOrderId: item.externalOrderId,
          sourceEventId: item.eventKey,
          eventType: item.eventType,
          occurredAt: item.occurredAt,
          eventKey: item.eventKey,
        },
        options: {
          dedupeKey: `marketplace:${connectionId}:order:${item.eventKey}`,
        },
      }));

      // Enqueue first; if enqueue fails, do not commit cursor.
      await this.jobQueue.enqueueBulk(requests);

      let committed = false;
      const nextCursor = feed.nextCursor;
      // Cursor monotonicity guard (best-effort): do not commit a cursor that goes
      // backwards. Enforced only for cursor shapes core can order - see
      // `compareOrderCursors`.
      if (nextCursor && nextCursor.trim() !== '') {
        if (fromCursor && this.isCursorRegression(connectionId, cursorKey, fromCursor, nextCursor)) {
          this.logger.warn(
            `Cursor regression detected; not committing cursor. cursorKey=${cursorKey}, fromCursor=${fromCursor}, nextCursor=${nextCursor} (connection: ${connectionId})`
          );
          return {
            fetched: feed.items.length,
            enqueued: requests.length,
            nextCursor,
            committed: false,
            skippedDueToLock: false,
          };
        }
        await this.syncCursors.advanceCursor(connectionId, cursorKey, nextCursor);
        committed = true;
      }

      return {
        fetched: feed.items.length,
        enqueued: requests.length,
        nextCursor,
        committed,
        skippedDueToLock: false,
      };
    } finally {
      await this.lock.release(lockKey, token);
    }
  }

  /**
   * A cursor is an opaque adapter-defined string, so core only blocks the commit
   * for a shape it genuinely knows how to order. An unrecognised shape is NOT a
   * regression: blocking on a guess halts ingestion for that connection until an
   * operator intervenes, whereas letting an unverified cursor through costs at
   * most one repeated read of an idempotent path.
   */
  private isCursorRegression(
    connectionId: string,
    cursorKey: string,
    previous: string,
    next: string
  ): boolean {
    const order = compareOrderCursors(previous, next);

    if (order === 'unrecognised') {
      const scope = `${connectionId}:${cursorKey}`;
      if (!this.reportedUnrecognisedCursors.has(scope)) {
        this.reportedUnrecognisedCursors.add(scope);
        this.logger.warn(
          `Cursor shape not recognised by core; monotonicity is unchecked for this source. cursorKey=${cursorKey}, fromCursor=${previous}, nextCursor=${next} (connection: ${connectionId})`
        );
      }
      return false;
    }

    return order === 'regressed';
  }

  async syncOrderFromSource(
    connectionId: string,
    externalOrderId: string,
    sourceEventId?: string,
    eventType?: OrderFeedEventType
  ): Promise<ReturnType<IOrderSyncService['syncOrder']> extends Promise<infer T> ? T : never> {
    // Inbound cancellation (#1158): a source `cancelled` event must NOT re-run the
    // create/update path (which would re-create the order — the #1132 bug). Route
    // it through the lifecycle relay, which propagates the cancel to the order's
    // destination(s) via OrderStatusWriteback. OL owns no canonical status here —
    // it forwards the source's fact to the participants it already synced to.
    if (eventType === 'cancelled') {
      return this.handleSourceCancellation(connectionId, externalOrderId);
    }

    const orderSource = await this.integrationsService.getCapabilityAdapter<OrderSourcePort>(
      connectionId,
      'OrderSource'
    );

    const incoming = await orderSource.getOrder({ externalOrderId });

    // Step 1: resolve order + customer IDs (no item mapping yet)
    const internalOrderId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Order,
      incoming.externalOrderId,
      connectionId
    );

    // Destination-echo guard (#940 / ADR-017): if an internal order already
    // exists for this external id and it originated from a DIFFERENT connection,
    // this is a re-read of an order OpenLinker itself created here as a sync
    // destination (e.g. the PrestaShop reconciliation poll re-reading an
    // Allegro-origin order it pushed in). Re-ingesting would overwrite the
    // order's true source, source event id and snapshot, and reset its sync
    // history — so skip. The real source stays authoritative; destination-side
    // fulfillment flows through the dedicated *.statusSync jobs (which key on
    // destinationConnectionId, not the source) and is unaffected.
    //
    // Since #2282 the write path enforces the attribution half of this itself
    // (`sourceConnectionId` is insert-only in the upsert statement), so this
    // guard is defence in depth. It is still load-bearing: only skipping here
    // also spares the SNAPSHOT, which the write path does still overwrite.
    const existing = await this.orderRecordService.getOrderRecord(internalOrderId);
    if (existing && existing.sourceConnectionId !== connectionId) {
      // `debug` not `log`: this is an expected, per-order steady-state skip that
      // fires for every cross-origin order on each poll within the watermark
      // window — emitting it at info level would be production noise.
      this.logger.debug(
        `Skipping destination-echo re-ingestion of order ${internalOrderId}: ` +
          `external id ${incoming.externalOrderId} on connection ${connectionId} ` +
          `maps to an order originating from ${existing.sourceConnectionId}`
      );
      return [];
    }

    // Cancellation-observe hook (#1146): capture the prior business status from
    // the PRE-persist `existing` snapshot, before persistOrder overwrites it.
    // Defensive string read — mirrors the `OrderRecord.paymentStatus` getter
    // idiom; an absent/garbled prior status reads as non-cancelled (allowed to
    // fire once on a first-seen already-cancelled order — the restore is a
    // harmless absolute-set).
    const priorStatus = this.readSnapshotStatus(existing);

    // Source-amendment diff (#2283) — taken HERE, against the already-loaded
    // prior record, and deliberately BEFORE `persistIncomingSnapshot` below.
    // Two properties depend on the placement:
    //   - `persistIncomingSnapshot` overwrites `orderSnapshot`, so after it the
    //     prior state this diff needs no longer exists anywhere;
    //   - Step 4 throws `MissingOrderItemMappingError` before `persistOrder` is
    //     ever reached, so writing the fact later would lose it permanently on
    //     exactly the orders most likely to have been amended (a line the source
    //     changed is a line whose mapping may well have gone with it).
    // The fact is an observation about the SOURCE and is true whether or not
    // item resolution subsequently succeeds. The destination-echo early return
    // above is untouched: an echo is not an amendment.
    await this.recordSourceAmendment(existing, incoming, internalOrderId, connectionId);

    const internalCustomerId = await this.resolveCustomerId(
      incoming,
      connectionId,
      internalOrderId
    );

    // Step 2: persist raw snapshot immediately — operator can see the order even if item resolution fails
    const snapshotRecord = await this.orderRecordService.persistIncomingSnapshot(
      incoming,
      internalOrderId,
      internalCustomerId ?? null,
      connectionId,
      sourceEventId ?? null
    );

    // #2069: `persistIncomingSnapshot` may have consumed an early-cancellation
    // signal recorded before this order was ever ingested — the exact race this
    // fix exists to close is one where the source's order RESOURCE still
    // reports the pre-cancel status here (the event journal that produced the
    // signal leads the resource read), so `incoming.status` alone is not a
    // reliable "is this order cancelled" answer once a signal exists. Every
    // downstream gate that used to test `incoming.status`/`order.status` alone
    // must also honour this, or OL reserves inventory and skips the stock
    // restore for an order it already knows is dead (#2628's shape: a
    // permanent ATP subtraction naming a cancelled order). `cancelledAt`, once
    // written, is never cleared on this path, so capturing it here is valid
    // for every gate below.
    //
    // `snapshotRecord.cancelledAt` alone is NOT enough: `persistIncomingSnapshot`
    // only returns a freshly-`findById`'d record when IT wrote the cancellation
    // on THIS call (`cancellationWrote`); on every other invocation it returns
    // `upsert()`'s own return value, whose `fromRawRow(row, writeSet)` resets
    // every column outside the write set — and `cancelledAt` is deliberately
    // outside it (#2100) — so `cancelledAt` reads back as `null` there even
    // though the row itself is cancelled. Without the `existing` fallback, the
    // very NEXT poll after the one that consumed the signal (source still
    // lagging, signal already deleted) would silently regress to the original
    // defect: advisory holds reserved, no stock-restore enqueued, for an order
    // OL already recorded as cancelled.
    const cancelledFromEarlySignal =
      snapshotRecord.cancelledAt != null || existing?.cancelledAt != null;

    // Early-fire cancellation hook (#1146): enqueue the stock-restore job
    // immediately after the raw snapshot is persisted and BEFORE item resolution
    // so the signal is never lost when MissingOrderItemMappingError is thrown at
    // Step 4 (which would preempt the post-persistOrder hook below). The
    // dedupeKey is identical to the Step-5 hook's, so a successful item
    // resolution that also reaches the hook below produces a harmless no-op
    // re-enqueue. The worker processes this job asynchronously — by the time it
    // runs, persistOrder will have completed (if items resolved) and the snapshot
    // will carry variantIds; if items never resolve, OfferStockRestoreService
    // will no-op (no variantIds in the raw snapshot) and the job stays visible
    // in the dead-letter queue for operator inspection.
    if ((incoming.status === 'cancelled' || cancelledFromEarlySignal) && priorStatus !== 'cancelled') {
      try {
        await this.jobQueue.enqueue({
          type: 'marketplace.offer.stockRestore',
          connectionId,
          payload: {
            schemaVersion: 1,
            internalOrderId,
          },
          options: {
            dedupeKey: `marketplace:${connectionId}:stockRestore:${internalOrderId}`,
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to enqueue stock-restore job (early-fire) for cancelled order [connectionId=${connectionId}, orderId=${internalOrderId}]; marketplace stock will NOT be auto-restored`,
          (error as Error).stack,
        );
      }
    }

    // Step 3: attempt item resolution (non-throwing)
    const resolvedItems: Order['items'] = [];
    const unresolvedRefs: Array<{ itemId: string; reason: string; kind: ItemResolutionFailureKind }> =
      [];

    for (const item of incoming.items) {
      const result = await this.orderItemRefResolver.tryResolve(connectionId, item.productRef);
      if (result.resolved) {
        const tax = await this.resolveLineTaxRate(
          result.internalProductId,
          result.internalVariantId,
          item
        );
        // #2250 - journal what the CHANNEL said, separately from what the line
        // settled on. Deliberately keyed off `item.taxRate` and not off `tax`:
        // `tax` is OpenLinker's resolution, so recording it as a channel
        // observation would attribute our own fallback to the marketplace and
        // destroy the very attribution the journal exists for.
        await this.journalChannelTaxRate(
          connectionId,
          result.internalProductId,
          result.internalVariantId ?? null,
          item
        );
        resolvedItems.push({
          id: item.id,
          productId: result.internalProductId,
          variantId: result.internalVariantId,
          quantity: item.quantity,
          price: item.price,
          sku: item.sku,
          name: item.name,
          imageUrl: item.imageUrl,
          ...tax,
        });
      } else {
        unresolvedRefs.push({ itemId: item.id, reason: result.reason, kind: result.kind });
      }
    }

    // Step 4: if any unresolved, persist the honest record state (#1689) then
    // throw so the job runner retries with backoff. A `source_deleted` ref is
    // a permanently unresolvable state (deleted at the master, #1599) — distinct
    // from the ordinary, self-healing `awaiting_mapping` gap; the retry itself
    // is unchanged (review #11 — routing a stale line to a terminal outcome
    // and partial-order fulfilment — is out of scope for this issue).
    if (unresolvedRefs.length > 0) {
      const first = unresolvedRefs[0];
      const firstItem = incoming.items.find((i) => i.id === first.itemId);
      const firstStaleRef = unresolvedRefs.find((ref) => ref.kind === 'source_deleted');
      const recordStatus: OrderRecordStatus = firstStaleRef ? 'source_deleted' : 'awaiting_mapping';
      await this.orderRecordService.markItemResolutionFailure(internalOrderId, {
        status: recordStatus,
        reason: (firstStaleRef ?? first).reason,
      });
      throw new MissingOrderItemMappingError(
        connectionId,
        firstItem?.productRef ?? { type: 'offer', externalId: first.itemId },
        first.reason
      );
    }

    // Step 5: all items resolved — build unified order and upsert with recordStatus='ready'
    const order = this.buildUnifiedOrder(
      incoming,
      internalOrderId,
      internalCustomerId,
      resolvedItems
    );
    // The persisted record is captured for its `shippingAddressHash` (#2395),
    // which the #2396 routing projection needs and which the `order` object does
    // not carry. Hashing the snapshot instead would be wrong under hash-only
    // mode — see `projectOrderForRouting`.
    const persisted = await this.orderRecordService.persistOrder(
      order,
      connectionId,
      sourceEventId ?? null,
      incoming.externalUrl ?? null
    );

    // The order's ADR-012 fulfilment routing, resolved at most once and only if
    // asked for: the reservation's `atpEffect` (#2344) and the #3488 routing
    // skip both read it, and a second resolve could answer differently if a rule
    // were edited between the two.
    const fulfillmentRouting = this.memoizeFulfillmentRouting(order, connectionId);

    // #2344: record OL's own advisory holds. Placed after `persistOrder` so the
    // order row exists, and before destination provisioning. `cancelledFromEarlySignal`
    // (#2069) is threaded through so an order already known-cancelled via the
    // signal is never held, even while `order.status` still lags.
    // #3480: resolved BEFORE the hold, so an order OpenLinker is about to route
    // is held as `published` from the start. The hold must also stay before the
    // intercept: the intercept enqueues the sale decrement, and a hold created
    // after it could land after its own consume and then subtract for its whole
    // TTL.
    const routingTarget = await this.resolveRoutingTarget(
      order.id,
      connectionId,
      fulfillmentRouting,
      // #3455 — read from the PRE-persist `existing`: `persistOrder` never
      // writes `syncStatus` (#2140), so it is current, and no extra read is spent.
      isOrderMirroredBeforeRouting(existing?.syncStatus)
    );
    await this.reserveOrderInventory(
      order,
      connectionId,
      fulfillmentRouting,
      cancelledFromEarlySignal,
      // #3485: every OMS-routed order now stays in OpenLinker — including one
      // still waiting for an address — so its units are OpenLinker's to promise.
      routingTarget.kind === 'route'
    );

    // Cancellation-observe hook (#1146): on the `→ cancelled` transition, enqueue
    // a marketplace.offer.stockRestore job so the destination marketplace's
    // stock is restored (e.g. Erli auto-decrements on purchase but does not
    // restore on cancel — ADR-025 §4a). Transition-gated (priorStatus !==
    // 'cancelled') so a re-poll within the watermark window doesn't re-fire;
    // the dedupeKey makes any re-enqueue safe. Marketplace-agnostic — the worker
    // handler narrows the source connection's adapter to OfferStockRestorer and
    // no-ops if the capability is absent. `cancelledFromEarlySignal` (#2069)
    // covers the race where `order.status` still lags the signal.
    if ((order.status === 'cancelled' || cancelledFromEarlySignal) && priorStatus !== 'cancelled') {
      try {
        await this.jobQueue.enqueue({
          type: 'marketplace.offer.stockRestore',
          connectionId,
          payload: {
            schemaVersion: 1,
            internalOrderId,
          },
          options: {
            dedupeKey: `marketplace:${connectionId}:stockRestore:${internalOrderId}`,
          },
        });
      } catch (error) {
        // The order is already persisted as `cancelled`, so the transition gate
        // above won't re-fire on a re-poll — a swallowed enqueue failure would
        // silently lose the restore. We don't rethrow (that would fail the whole
        // order-sync and still couldn't re-fire the gate on retry), but we log at
        // error so the missed restore is loud and actionable.
        this.logger.error(
          `Failed to enqueue stock-restore job for cancelled order [connectionId=${connectionId}, orderId=${internalOrderId}]; marketplace stock will NOT be auto-restored`,
          (error as Error).stack,
        );
      }
    }

    // Step 6: best-effort customer-projection sync. Runs before destination dispatch so
    // a destination failure can't drop projection updates. Failure here is swallowed —
    // projections are non-authoritative and must never block order sync.
    if (internalCustomerId) {
      try {
        await this.customerProjectionUpdater.updateProjectionsForOrder(
          order,
          internalCustomerId,
          connectionId
        );
      } catch (error) {
        this.logger.warn(
          `Failed to update customer projections for order ${order.id} (customer: ${internalCustomerId}, connection: ${connectionId}): ${(error as Error).message}`,
          error
        );
      }
    }

    // #2396 — THE FULFILMENT INTERCEPT. Sits here, between `persistOrder` and
    // `syncOrder`, because a hold that still mirrors the order into the shop is
    // not a hold (DESIGN §5.5). Everything above has already run: the order row
    // exists, its advisory holds are recorded, and its projections are synced.
    //
    // On every installation today this resolves to the pass-through arm — no
    // connection claims A2, and the router resolver answers `null` for any
    // connection that is not an OMS one — so `syncOrder` below is reached with a byte-identical
    // request. That is ADR-054's specified degenerate behaviour, not a stub.
    const routing = await this.interceptFulfillmentRouting(
      order,
      connectionId,
      persisted?.shippingAddressHash ?? null,
      routingTarget
    );
    await this.persistFulfillmentOutcome(order.id, routing);

    let results: Awaited<ReturnType<IOrderSyncService['syncOrder']>> = [];

    if (routing.held) {
      // HELD: the order is being fulfilled through a routed work object, or its
      // routing is in a state where mirroring could double-ship it. No
      // destination fan-out, and therefore no `syncStatus` rows — writing
      // `pending` here would claim a destination is still owed this order,
      // which is exactly what routing decided is not true.
      this.logger.log(
        `Withholding destination mirror for order ${order.id}: fulfilment routing ` +
          `held it (${routing.block?.reason ?? 'routed'})`
      );
    } else {
      results = await this.orderSyncService.syncOrder({
        order,
        sourceConnectionId: connectionId,
        sourceEventId,
      });
    }

    // Update per-destination sync status; allSettled — one failure doesn't block others
    const settlements = await Promise.allSettled(
      results.map((result) => {
        if (result.status === 'success') {
          return this.orderRecordService.updateSyncStatus(
            order.id,
            result.destinationConnectionId,
            {
              destinationConnectionId: result.destinationConnectionId,
              status: 'synced',
              syncedAt: new Date(),
              externalOrderId: result.orderRef.orderId,
              externalOrderNumber: result.orderRef.orderNumber,
            }
          );
        } else if (result.status === 'skipped_held') {
          // #2339 — the order is on hold, so provisioning was withheld.
          //
          // **On a FIRST ingestion** the row is written as `pending`, which is
          // the literal truth: this destination is still owed an order, and the
          // hold is why it has not been created yet. Every alternative states
          // something false. `skipped_cancelled` claims the order is over.
          // `failed` claims something broke and puts the row in the
          // operator-retry affordance for a condition retrying cannot change.
          // Inventing a persisted `skipped_held` makes the row terminal and
          // defeats the guarantee that releasing un-blocks the next run. And
          // writing NOTHING is the worst of the four here, because `syncStatus`
          // starts empty — the order would render "No destinations" on
          // `/orders`, denying that the destinations exist at all.
          //
          // **On a RE-ingestion of a destination already `synced`, none of that
          // reasoning holds and the write is refused (#2588 review I-1).** A
          // hold cannot withhold what has already shipped, so `pending` would
          // be a false statement about that destination — and the write is
          // destructive, not merely wrong: `OrderRecordRepository.updateSyncStatus`
          // implements a per-destination upsert as DROP-then-append, so the
          // withheld row REPLACES the synced one and takes its `externalOrderId`
          // and `externalOrderNumber` with it. The routine poll re-drives
          // ingestion on a held order every few minutes, so the shop's own order
          // number would vanish from `/orders` for the whole life of the hold —
          // precisely when the operator needs it to act in the shop.
          //
          // `existing` is the pre-persist read from the top of this method;
          // `persistOrder` leaves `syncStatus` alone (#2140, sole writer
          // `updateSyncStatus`), so it is current for this purpose. A null
          // `existing` is a first ingestion.
          //
          // Only `synced` is tested, and that is a fact about gate ORDER rather
          // than a narrower rule: `OrderSyncService` evaluates its cancellation
          // predicate BEFORE the hold predicate and returns `skipped_cancelled`
          // for every destination when it fires, so a `skipped_held` result can
          // never coexist with a `skipped_cancelled` row — the other terminal
          // status a `pending` write would falsely reopen. Reorder those two
          // gates and this test must widen with them.
          const alreadyProvisioned = existing?.syncStatus?.some(
            (row) =>
              row.destinationConnectionId === result.destinationConnectionId &&
              row.status === 'synced'
          );
          if (alreadyProvisioned) {
            this.logger.debug(
              `Order ${order.id} is on hold (${result.holdReason}) but destination ` +
                `${result.destinationConnectionId} is already provisioned; leaving its ` +
                `synced row and destination order number intact`
            );
            return Promise.resolve();
          }
          // The reason rides in `error` (no new column — the #2284 precedent),
          // so the timeline narrates the withholding even before #2340's
          // projection column and #2342's badge land. The string is built by the
          // shared rule because the resume path matches on it (#2588 I-2).
          return this.orderRecordService.updateSyncStatus(
            order.id,
            result.destinationConnectionId,
            {
              destinationConnectionId: result.destinationConnectionId,
              status: 'pending',
              error: withheldOnHoldError(result.holdReason),
            }
          );
        } else if (result.status === 'skipped_cancelled') {
          // #2284 — terminal, and NOT a failure: the source cancelled before the
          // destination create ran, so provisioning was withheld. `error` carries
          // the human reason (no new column); the same string lands on the
          // append-only attempt entry so the timeline narrates the skip.
          return this.orderRecordService.updateSyncStatus(
            order.id,
            result.destinationConnectionId,
            {
              destinationConnectionId: result.destinationConnectionId,
              status: 'skipped_cancelled',
              error: 'Order cancelled at source before destination create',
            }
          );
        } else {
          return this.orderRecordService.updateSyncStatus(
            order.id,
            result.destinationConnectionId,
            {
              destinationConnectionId: result.destinationConnectionId,
              status: 'failed',
              error: result.error.message,
            }
          );
        }
      })
    );
    for (const settlement of settlements) {
      if (settlement.status === 'rejected') {
        this.logger.warn('Failed to update order record sync status', settlement.reason);
      }
    }

    // OL #1120 — auto-issue trigger (EV→SVC edge, ADR-026 §3). Fires STRICTLY at
    // the end of the authoritative source poll, AFTER per-destination status is
    // settled.
    //
    // #2396: this runs for a HELD order too, deliberately. Issuance is a
    // separate authority (A7 / ADR-041) from fulfilment sourcing (A2) — the
    // buyer has paid and the document is owed whether the parcel leaves from a
    // destination shop or from a routed holder. Skipping it under a hold would
    // silently stop invoicing for exactly the orders a router took over, which
    // is a fiscal regression disguised as a fulfilment change. `results` is
    // empty on that path, so the settlement loop above simply did nothing.
    //
    // The destination-echo early-return (`return []`) above is the
    // INTENDED gate: issuance fires only on the real source ingestion, never on a
    // destination re-read. Threads the in-scope `sourceEventId` as the trace token
    // (D10 — no `correlationId` exists). Wrapped so an enqueue/compose failure
    // never blocks order sync; the catch logs a PII-SAFE envelope only (F9/D11):
    // `error.name` + `connectionId` + `order.id` + `sourceEventId` — never the raw
    // error/message or any payload/buyer field.
    try {
      const outcome = await this.autoIssueTrigger.onOrderTransition(
        order,
        connectionId,
        sourceEventId,
        // #2245 review: the PRE-persist record is the right read. `persistOrder`
        // deliberately omits `taxRateEra` from its write set, so the marker the
        // migration stamped survives every re-ingestion - and a first-seen order
        // has no record and therefore no era, which is correct: it arrived after
        // the feature. Without this the marker was write-only and every
        // already-ingested uninvoiced order became un-issuable under strict
        // enforcement.
        existing?.taxRateEra ?? null,
        // #3187, ADR-073 decision 1: the OPPOSITE read from taxRateEra above -
        // `persisted`, not `existing`. `buyerTaxId` is computed fresh by
        // `persistOrder` from THIS transition's order, so a first-seen order
        // (`existing === null`) still carries its correct three-state value on
        // `persisted`; reading `existing` here would silently answer
        // "not asserted" for every order's first ingestion.
        persisted.buyerTaxId
      );
      // #2100 (ADR-041 §54/§105): a block is never log-only. The trigger REPORTS
      // the outcome and this service — which owns the order record — writes it,
      // which is what keeps the trigger's one-way edge (F3) intact.
      //
      // `none` is written through as `null`, and that is the point: the gate is
      // level-evaluated, so it is the ONLY thing that clears a reason persisted by
      // an earlier transition. `indeterminate` writes NOTHING — the gate could not
      // tell, so erasing a true reason is worse than leaving it (#2100 review).
      await this.persistSalesDocumentOutcome(order.id, outcome);
    } catch (error) {
      // F9/D11: issuance is best-effort relative to order sync. SWALLOW — never
      // re-throw — so an enqueue/compose failure can never block the order
      // pipeline. Log a PII-SAFE envelope only: error.name + connectionId +
      // order.id + sourceEventId — never the raw error/message or any payload.
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Auto-issue trigger failed (swallowed): error=${errorName} connectionId=${connectionId} orderId=${order.id} sourceEventId=${sourceEventId ?? 'n/a'}`
      );
    }

    return results;
  }

  /**
   * What this order's fulfilment routing will do (#2396, #3480).
   *
   * The selection half of the intercept, split out so it runs ONCE, before the
   * advisory hold is recorded: the hold's `atpEffect` is insert-only, so it has
   * to know at creation time whether OpenLinker is about to route the order.
   *
   * **The skip rules (#3487 / #3455 / #3488) live HERE, not in the intercept**,
   * for the same reason: checked only later, the hold of an order that is never
   * routed would be stamped `published` — a storefront order whose stock the shop
   * has already lowered, or an order another system ships, would then subtract
   * the same units twice (#3480).
   *
   * Order of the checks, and why:
   *  1. **No claimant** — the OMS is off, so there is nothing to explain and the
   *     skip reason is cleared. BEFORE the skip rules: without this gate every
   *     shop order on an OMS-off install would be recorded as "pack it in your
   *     shop" (#3455).
   *  2. **The skip rules** — before the ambiguity warning, so an A2 ambiguity is
   *     not reported for an order that would never be routed.
   *  3. **Ambiguity / no router wired** — the pass-through.
   *
   * **Never throws**, exactly as the intercept it was extracted from: a failure
   * answers `indeterminate`, which follows today's path, stamps the hold the way
   * it was stamped before #3480, and leaves a persisted skip reason untouched.
   */
  private async resolveRoutingTarget(
    orderId: string,
    orderSourceConnectionId: string,
    fulfillmentRouting: () => Promise<FulfillmentRoutingResolution | null>,
    alreadyMirrored: boolean
  ): Promise<RoutingTarget> {
    try {
      const connections = await this.connections.list();
      const selection = selectPrimaryFulfillmentRouter(this.toRoutingClaimants(connections));

      if (selection.holder === null && selection.reason === 'no-claimant') {
        // `no-claimant` is the pass-through and is not worth a log line per order.
        return { kind: 'pass' };
      }

      const skipReason = await this.resolveRoutingSkipReason(
        orderSourceConnectionId,
        connections,
        alreadyMirrored,
        fulfillmentRouting
      );
      if (skipReason !== null) {
        this.logger.debug(
          `Not routing order ${orderId}: ${skipReason}; following today's path.`
        );
        return { kind: 'skip', reason: skipReason };
      }

      if (selection.holder === null) {
        if (isFulfillmentRouterUnroutable(selection.reason)) {
          this.logger.warn(
            `Not routing order ${orderId}: reason=${selection.reason} ` +
              `candidates=[${selection.candidateConnectionIds.join(',')}]. ` +
              `Following today's path; the ambiguity is reported by the A2 ` +
              `authority read model (#2352), not persisted here.`
          );
        }
        return { kind: 'pass' };
      }

      const router = await this.routerResolver.resolve(selection.holder);
      if (router === null) {
        // The degenerate pass-through (ADR-054). Not an error, and not a block:
        // the order follows today's path unchanged, so there is nothing held to
        // explain.
        this.logger.log(
          `No fulfilment router is wired for connection ${selection.holder}; ` +
            `order ${orderId} follows today's path unchanged (#2408/#2409).`
        );
        return { kind: 'pass' };
      }

      return { kind: 'route', holder: selection.holder, router };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Fulfilment router selection failed (swallowed, following today's path): ` +
          `error=${errorName} orderId=${orderId}`
      );
      return { kind: 'indeterminate' };
    }
  }

  /**
   * Decide whether fulfilment routing HOLDS this order (#2396, DESIGN §5.5).
   *
   * Three arms, per the issue:
   *
   * - **`none`** — nobody claims A2. Today's path, byte-identical. This is every
   *   installation today.
   * - **`ambiguous`** — several routers legitimately contend, or the config is
   *   ambiguous. Today's path, and **nothing is persisted**: #2352's derived
   *   `'sourcing-ambiguous'` (A2-A) already reports this at order grain with
   *   `counted: true`, so a second copy would double-count
   *   `Needs attention (N)`. Warn-logged only.
   * - **`selected`** — exactly one router holds A2. `route()` decides, and the
   *   order is HELD whatever it decides (#3485): routed, refused, no shipping
   *   address, or an error. With the OMS as the router the order stays in
   *   OpenLinker (epic #3460); a non-routed outcome carries a named block and is
   *   re-routable, instead of being created in every product master.
   *
   * Silence-and-pick-one is forbidden on the ambiguous arm for the reason it is
   * forbidden in #2047: an unrouted order is recoverable by hand, two shipments
   * of one order are not.
   *
   * **Never throws.** A failure once the router is selected HOLDS the order
   * (`routing-failed`); a failure before that degrades to the pass-through,
   * because without a selected router OpenLinker cannot tell whether the claim is
   * on, and holding on an unknown would strand orders on an install with no
   * router at all.
   */
  private async interceptFulfillmentRouting(
    order: Order,
    connectionId: string,
    shippingAddressHash: string | null,
    target: RoutingTarget
  ): Promise<FulfillmentInterceptOutcome> {
    try {
      switch (target.kind) {
        case 'skip':
          return {
            held: false,
            block: null,
            skip: { kind: 'skipped', reason: target.reason },
            lineAttention: LINE_ATTENTION_UNTOUCHED,
          };
        case 'indeterminate':
          return {
            held: false,
            block: null,
            skip: { kind: 'indeterminate' },
            lineAttention: LINE_ATTENTION_UNTOUCHED,
          };
        case 'pass':
          // The pass-through — see `resolveRoutingTarget`, which logged why.
          return {
            held: false,
            block: null,
            skip: ROUTING_NOT_SKIPPED,
            lineAttention: LINE_ATTENTION_UNTOUCHED,
          };
        case 'route':
          break;
        default: {
          const unreachable: never = target;
          throw new Error(`Unrecognised routing target: ${JSON.stringify(unreachable)}`);
        }
      }
      const { holder, router } = target;

      const projection = this.projectOrderForRouting(order, shippingAddressHash);
      if (projection === null) {
        // #3485 — HELD, not mirrored: the OMS is this order's router, so sending
        // it to the product masters instead would put it in every one of them.
        // The re-ingestion that brings an address clears the block by itself.
        this.logger.warn(
          `Order ${order.id} carries no shipping address; holding it in OpenLinker ` +
            `until one arrives.`
        );
        return {
          held: true,
          block: { reason: 'routing-no-shipping-address', detail: null },
          skip: ROUTING_NOT_SKIPPED,
          lineAttention: { kind: 'none' },
        };
      }

      const outcome = await this.routingCommit.route({
        orderId: order.id,
        routerConnectionId: holder,
        lines: projection.lines,
        shipTo: projection.shipTo,
        requestedDeliveryMethod: projection.requestedDeliveryMethod,
        router,
        // `SyncLockPort` satisfies the locally-declared `RoutingLockPort`
        // STRUCTURALLY, which is what lets the leaf keep its zero value edges
        // while still getting the real distributed lock.
        lock: this.lock,
        // A CALLBACK, re-read inside the lock. A boolean resolved here would be
        // a value from a moment that has already passed (REVIEW C10).
        isCancelled: async () => {
          const record = await this.orderRecordService.getOrderRecord(order.id);
          return record?.isCancelled === true;
        },
      });

      // BEFORE the mapping, and inside a method that CANNOT throw — see
      // `enqueueRoutedDispatchJobs`. Ordering it here keeps `toInterceptOutcome`
      // a pure, synchronous, exhaustive switch.
      await this.enqueueRoutedDispatchJobs(order.id, outcome);
      // #3453 — a routed order is never created in the product master, so its
      // stock must be lowered there by OpenLinker. Same never-throws contract.
      await this.enqueueRoutedSaleDecrementJobs(order.id, connectionId, outcome);

      return { ...this.toInterceptOutcome(order.id, outcome), skip: ROUTING_NOT_SKIPPED };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';

      if (target.kind === 'route') {
        // #3485 — HELD, not fail-open. The OMS router was already selected, so
        // the claim is known to be on: following today's path here would create
        // the order in every product master. The error NAME only reaches the
        // detail — never the message, which can carry order data. The reroute
        // sweep retries it.
        this.logger.warn(
          `Fulfilment routing failed after the router was selected; holding the order: ` +
            `error=${errorName} orderId=${order.id} connectionId=${connectionId}`
        );
        return {
          held: true,
          block: { reason: 'routing-failed', detail: errorName },
          skip: ROUTING_NOT_SKIPPED,
          lineAttention: LINE_ATTENTION_UNTOUCHED,
        };
      }

      // Fail OPEN, and say so: without a selected router the claim state is
      // unknown, and holding on an unknown would withhold the destination mirror
      // on an install that has no router at all.
      this.logger.warn(
        `Fulfilment routing intercept failed (swallowed, following today's path): ` +
          `error=${errorName} orderId=${order.id} connectionId=${connectionId}`
      );
      return {
        held: false,
        block: null,
        skip: { kind: 'indeterminate' },
        lineAttention: LINE_ATTENTION_UNTOUCHED,
      };
    }
  }

  /**
   * Why this order should deliberately NOT be routed, or `null` (#3455).
   *
   * First match wins, cheapest first:
   *  1. `own-shop-order` (#3487) — the source connection is a product master;
   *     reads the connections already loaded.
   *  2. `mirrored-before-routing` (#3455) — the product master already has the
   *     order; a pre-read boolean.
   *  3. `shipped-by-other-system` (#3488) — an ADR-012 rule routes the delivery
   *     method to `omp_fulfilled`; the one arm needing the (memoized, shared)
   *     routing resolve, so it runs last.
   *
   * The order also fixes which sentence an operator reads when several apply:
   * "it is from your shop" is the most useful answer, so it wins.
   */
  private async resolveRoutingSkipReason(
    connectionId: string,
    connections: readonly Connection[],
    alreadyMirrored: boolean,
    fulfillmentRouting: () => Promise<FulfillmentRoutingResolution | null>
  ): Promise<FulfillmentRoutingSkipReason | null> {
    if (isOrderFromOwnProductMaster(connections, connectionId)) return 'own-shop-order';
    if (alreadyMirrored) return 'mirrored-before-routing';
    if (isOrderShippedElsewhere(await fulfillmentRouting())) return 'shipped-by-other-system';
    return null;
  }

  /**
   * Offer every routed work object to its holder (#2955).
   *
   * The FIRST producer of `fulfillment.work.dispatch`. Without it a routed
   * `FulfillmentWork` never leaves `unsubmitted`, so it never reaches `accepted`
   * and the pack bench — which filters on exactly that — stays permanently empty
   * on a routed install.
   *
   * ## This method MUST NOT throw, and that is the whole reason it exists
   *
   * It is called from inside `interceptFulfillmentRouting`'s `try`. Before
   * #3485 that catch returned `{ held: false }`, so an unguarded enqueue failure
   * would have mirrored to every destination an order whose `fulfillment_works`
   * rows are already committed — an order fulfilled twice. Since #3485 the catch
   * HOLDS the order as `routing-failed` instead, which is safe but still wrong:
   * it would report a successfully routed order as failed and send it to the
   * reroute sweep. The `try` therefore wraps the WHOLE body — not only the
   * enqueue — because a docblock stating an absolute has to be true rather than
   * nearly true; a spec asserts it by rejecting the enqueue.
   *
   * Swallowing is also the only useful treatment: a retry re-enters `route()`,
   * which answers `already-routed` and reaches no enqueue at all, so rethrowing
   * would buy a burnt retry ladder and no dispatch. The loud `error` log naming
   * the work ids is the signal.
   *
   * ## One enqueue per work, and the failure is reported PER WORK
   *
   * `enqueueBulk` disclaims atomicity in its own docblock and
   * `SyncJobQueueService` really is a sequential `for`, so a bulk call whose
   * second request throws leaves the first work DISPATCHED — and one error log
   * naming every work would then be a false statement about it, in the single
   * artefact an operator reads to decide what to re-drive. Looping costs nothing
   * in idempotency (each request carries its own dedupe key) and makes this host
   * report the same fidelity as `FulfillmentWorkRouteHandler`, which loops over
   * the same intents.
   *
   * The decision itself is the leaf's (ADR-053 report-don't-perform); only the
   * I/O is here, because `fulfillment` may not import `@openlinker/core/sync`.
   */
  private async enqueueRoutedDispatchJobs(
    orderId: string,
    outcome: RoutingCommitOutcome
  ): Promise<void> {
    try {
      if (outcome.status !== 'routed') return;

      const unassigned = findUndispatchableWorkIds(outcome.works);
      if (unassigned.length > 0) {
        // Never inferred from an absence: work with no holder cannot be dispatched
        // (`SyncJob.connectionId` is non-nullable and the handshake would throw a
        // retryable error), so it is skipped and named.
        this.logger.warn(
          `Not dispatching fulfilment work with no assigned holder: ` +
            `orderId=${orderId} work=[${unassigned.join(',')}]`
        );
      }

      for (const intent of deriveFulfillmentDispatchEnqueueIntents(outcome.works, orderId)) {
        try {
          await this.jobQueue.enqueue({
            type: 'fulfillment.work.dispatch',
            connectionId: intent.connectionId,
            payload: {
              workId: intent.workId,
              orderId: intent.orderId,
              // Always `null`, and REQUIRED to be: `claimDispatchAttempt` bumps
              // the counter itself, so any pre-claim value would make this
              // producer's own retry refuse to resume and send nothing.
              expectedAssignmentAttempt: null,
            },
            options: { dedupeKey: intent.dedupeKey },
          });
        } catch (error) {
          this.logger.error(
            `Failed to enqueue a fulfilment dispatch job; the work is routed but was ` +
              `NOT offered to its holder: orderId=${orderId} workId=${intent.workId}`,
            error instanceof Error ? error.stack : undefined
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to dispatch routed fulfilment work: orderId=${orderId}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Lower the sold stock in each routed line's product master (#3453).
   *
   * With the OMS on, a routed order is HELD — no `syncOrder`, so the product
   * master never receives it and its own order flow never lowers its stock. One
   * `inventory.saleDecrement` job per routed work closes that; the job owns the
   * per-line at-most-once claim, the owner resolution and the source-is-owner
   * skip.
   *
   * **MUST NOT throw**, for exactly the reason `enqueueRoutedDispatchJobs` must
   * not: it runs inside the intercept's `try`, whose catch would report a routed
   * order as `routing-failed` (#3485). A lost enqueue leaves the master's stock high; the
   * error log naming the work is the signal, because a retry re-enters
   * `route()`, answers `already-routed` and reaches no enqueue at all.
   *
   * Scoped to the order's SOURCE connection, not the holder: every OMS-packed
   * work shares one holder, and scoping by it would serialise every decrement in
   * the installation behind one per-scope cap (#2609).
   */
  private async enqueueRoutedSaleDecrementJobs(
    orderId: string,
    orderSourceConnectionId: string,
    outcome: RoutingCommitOutcome
  ): Promise<void> {
    try {
      if (outcome.status !== 'routed') return;

      for (const intent of deriveSaleDecrementEnqueueIntents(
        outcome.works,
        orderId,
        orderSourceConnectionId
      )) {
        try {
          await this.jobQueue.enqueue({
            type: 'inventory.saleDecrement',
            connectionId: intent.connectionId,
            payload: { schemaVersion: 1, workId: intent.workId, orderId: intent.orderId },
            options: { dedupeKey: intent.dedupeKey },
          });
        } catch (error) {
          this.logger.error(
            `Failed to enqueue a sale decrement job; the order is routed but the ` +
              `product master's stock was NOT lowered: orderId=${orderId} workId=${intent.workId}`,
            error instanceof Error ? error.stack : undefined
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to enqueue routed sale decrements: orderId=${orderId}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Map a routing commit outcome onto "is this order held, and why".
   *
   * The mapping is `deriveRoutingHoldOutcome` (#3485), shared with the
   * `fulfillment.work.route` handler so the two routing sites cannot disagree;
   * this method only adds the operator-facing log lines. The shared rule throws
   * on an outcome this build does not recognise, and the intercept's catch then
   * HOLDS the order (`routing-failed`) rather than mirroring one the router may
   * already have committed.
   */
  private toInterceptOutcome(
    orderId: string,
    outcome: RoutingCommitOutcome
  ): Omit<FulfillmentInterceptOutcome, 'skip'> {
    const hold = deriveRoutingHoldOutcome(outcome);

    if (outcome.status === 'routed') {
      this.logger.log(
        `Routed order ${orderId}: decisionId=${outcome.decisionId} ` +
          `work=[${outcome.works.map((work) => work.workId).join(',')}]`
      );
    } else if (outcome.status === 'refused') {
      this.logger.warn(
        `Routing plan refused for order ${orderId}: reason=${outcome.reason} ` +
          `decisionId=${outcome.decisionId}; holding it in OpenLinker for re-routing.`
      );
    }

    return hold;
  }

  /**
   * Every connection, whatever its status.
   *
   * `isActive` is REPORTED, never filtered upstream — the `analytics-trust` trap.
   * `supportedCapabilities` is left empty deliberately: A2 is `config-only`, so
   * `declaresCapability` short-circuits without reading it, and resolving adapter
   * metadata per connection would be work whose result is discarded.
   *
   * **This is a real per-order cost, and ADR-054's "byte-identical" is a claim
   * about BEHAVIOUR, not about query count.** The intercept adds two statements
   * to every ingestion on every install: this unfiltered read, and the
   * level-triggered `updateFulfillmentBlock`. Both are required — selection is
   * not decidable without every claimant, and skipping the write would make the
   * reason sticky, which is the #2100 lesson. Both are cheap: `connections` is a
   * handful of rows, and the write's `IS DISTINCT FROM` guard means the
   * overwhelmingly common `null -> null` touches no row and bumps no
   * `updatedAt`. If `connections` ever stops being small, cache HERE — never by
   * skipping the selection, which would decide routing from a stale claimant
   * set.
   *
   * The same read also answers #3487's "is this order from the operator's own
   * shop?", so that check costs no extra statement.
   */
  private toRoutingClaimants(connections: readonly Connection[]): AuthorityClaimantInput[] {
    return connections.map((connection) => ({
      connectionId: connection.id,
      isActive: connection.status === 'active',
      supportedCapabilities: [],
      enabledCapabilities: connection.enabledCapabilities,
      config: connection.config,
    }));
  }

  /**
   * Project the in-hand order into the router's ADR-062 allowlist input.
   *
   * Uses the `order` this method already holds rather than re-reading the
   * snapshot: the snapshot has been through `sanitizeAddress`, so hashing it
   * would collapse to one value per country across the whole install.
   * `shippingAddressHash` (#2395) is stamped at ingestion from the UN-redacted
   * address for exactly this reason.
   */
  private projectOrderForRouting(
    order: Order,
    shippingAddressHash: string | null
  ): RoutingProjection | null {
    const shippingAddress = order.shippingAddress;
    if (shippingAddress === undefined) {
      return null;
    }

    return {
      lines: order.items.map((item) => ({
        orderLineId: item.id,
        // A work line needs a variant. `variantId` is optional on `OrderItem`, so
        // fall back to the product id rather than emitting a blank — a work
        // object pointing at no variant is unpickable stock nothing would report.
        productVariantId: item.variantId ?? item.productId,
        quantity: item.quantity,
      })),
      // The OPAQUE key `RoutingInput.requestedDeliveryMethod` documents — the
      // source's own method id, never a neutral vocabulary.
      requestedDeliveryMethod: order.shipping?.methodId ?? null,
      shipTo: buildRoutingShipTo(
        {
          countryIso2: shippingAddress.country,
          postalCode: shippingAddress.postalCode,
          city: shippingAddress.city,
          addressHash: shippingAddressHash,
        },
        {
          // `getEnvBoolean`, NOT `getPiiConfig()`: the latter throws when
          // `OL_PII_HASH_SALT` is unset regardless of the flag, which would break
          // routing on every ordinary deployment that never enabled hash-only mode.
          storePii: getEnvBoolean('OL_STORE_PII', true),
        }
      ),
    };
  }

  /**
   * Persist why the intercept held this order (#2396), or clear a stale reason.
   *
   * Mirrors {@link persistSalesDocumentOutcome} in every respect that matters:
   *
   * 1. **Level-triggered.** The outcome is re-decided on every transition and the
   *    answer is written INCLUDING `null` — which is the only thing that clears a
   *    reason once the operator fixes the condition. A sticky reason is the #2100
   *    lesson.
   * 2. **Its own catch and its own message.** A persistence failure here is not a
   *    routing failure, and reporting it as one would send the next reader to the
   *    wrong service. Swallowed: the outcome is re-decided next transition, so a
   *    lost write self-heals.
   */
  private async persistFulfillmentOutcome(
    internalOrderId: string,
    outcome: FulfillmentInterceptOutcome
  ): Promise<void> {
    try {
      await this.orderRecordService.markFulfillmentBlock(internalOrderId, outcome.block);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Failed to persist the fulfilment block outcome (swallowed): ` +
          `error=${errorName} orderId=${internalOrderId} held=${String(outcome.held)}`
      );
    }

    // #3485 — the UF-L entry, again its own write and its own catch, for the
    // same reason. `indeterminate` (every arm outside an OMS routing attempt)
    // writes nothing.
    if (outcome.lineAttention.kind !== 'indeterminate') {
      try {
        await this.orderRecordService.markOmsAttention(
          internalOrderId,
          'routing',
          outcome.lineAttention
        );
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        this.logger.warn(
          `Failed to persist the routing attention state (swallowed): ` +
            `error=${errorName} orderId=${internalOrderId}`
        );
      }
    }

    // #3455 — its own write and its own catch: the routing-skip reason is an
    // operator-facing explanation, so losing it must neither fail ingestion nor
    // cost the block write above. Re-decided on the next ingestion.
    if (outcome.skip.kind === 'indeterminate') return;
    try {
      await this.orderRecordService.markFulfillmentRoutingSkip(
        internalOrderId,
        outcome.skip.kind === 'skipped' ? outcome.skip.reason : null
      );
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Failed to persist the fulfilment routing skip reason (swallowed): ` +
          `error=${errorName} orderId=${internalOrderId}`
      );
    }
  }

  /**
   * Persist the auto-issue gate's outcome onto the order record (#2100).
   *
   * Three deliberate properties:
   *
   * 1. **`indeterminate` writes nothing.** The gate could not decide, so erasing a
   *    reason it cannot vouch for would trade a true signal for silence.
   * 2. **A no-change outcome costs no `UPDATE`** — but the guard for that lives in
   *    the repository's `WHERE` clause, not here. A caller-side comparison would
   *    have to hold a record read BEFORE the destination round-trip, so a
   *    concurrent writer (the manual-issue clear) could make a genuinely new
   *    answer look unchanged and suppress it. Pushing the check into the statement
   *    keeps last-write-wins intact and still keeps the `@UpdateDateColumn` bump
   *    off the common `null -> null` path — `updatedAt` is a live filter axis
   *    (`FulfillmentStatusSyncService` scans `updatedSince`).
   * 3. **Its own catch and its own message.** A persistence failure here is not a
   *    trigger failure, and reporting it as one would send the next reader to the
   *    wrong service. Swallowed like the trigger itself: the outcome is re-decided
   *    on the next transition, so a lost write self-heals.
   */
  private async persistSalesDocumentOutcome(
    internalOrderId: string,
    outcome: SalesDocumentBlockOutcome
  ): Promise<void> {
    if (outcome.kind === 'indeterminate') {
      return;
    }

    try {
      // `matchedRuleId` (#3186) rides alongside the block, level-triggered the
      // same way. This is the ONE caller that re-decides both, so it is the one
      // that may write the rule column — `undefined` from the gate means "no
      // rule matched this time" and must clear the persisted value, exactly as
      // `null` clears the reason, or a deleted rule would outlive the decision
      // it produced. Every other caller passes `preserve`.
      await this.orderRecordService.markSalesDocumentBlock(
        internalOrderId,
        outcome.kind === 'blocked' ? outcome.block : null,
        { action: 'set', matchedRuleId: outcome.matchedRuleId ?? null }
      );
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Failed to persist the sales-document block outcome (swallowed): ` +
          `error=${errorName} orderId=${internalOrderId} outcome=${outcome.kind}`
      );
    }
  }

  /**
   * Inbound source cancellation → destination(s) via the lifecycle relay (#1158).
   * Resolves the existing internal order; if unknown (never ingested), there is
   * no `order_records` row to mark cancelled yet — instead, a durable
   * `(sourceConnectionId, externalOrderId)`-keyed signal is recorded (#2069)
   * so the later create/sync job can observe the cancellation and skip
   * destination provisioning (`OrderSyncService`'s `#2284` guard) instead of
   * provisioning the order as active. Applies the same destination-echo guard
   * as ingestion (ADR-017) so a re-read of an order OL itself created
   * elsewhere doesn't propagate a spurious cancel. Also durably records the
   * cancellation on the order record itself via `markCancelled` (#1984),
   * best-effort and before the relay call — see the inline comment at the
   * call site for why a DB failure there must never block the relay. Returns
   * an empty result set — a cancel is not an order-create, so there are no
   * OrderSyncResults to report.
   */
  private async handleSourceCancellation(
    connectionId: string,
    externalOrderId: string
  ): Promise<never[]> {
    const internalOrderId = await this.identifierMapping.getInternalId(
      CORE_ENTITY_TYPE.Order,
      externalOrderId,
      connectionId
    );
    if (!internalOrderId) {
      // #2069: a cancel for an order OL has not yet ingested must still leave
      // a durable trace, or the later create provisions the order as active
      // at every destination. No internal id exists yet, and minting one via
      // getOrCreateInternalId would point every downstream trigger at a
      // phantom order before any real order data arrives (the #2328 lesson
      // for returns attribution) — so the signal is keyed on
      // (sourceConnectionId, externalOrderId) instead, and consumed by
      // OrderRecordService.persistIncomingSnapshot the moment the order is
      // genuinely first ingested. Left unguarded (not try/caught): the only
      // action on this branch is the write, so a DB failure here should
      // retry the job rather than be silently swallowed — unlike the
      // known-order branch below, where a relay to already-resolved
      // destinations must proceed regardless.
      //
      // Sits above the ADR-017 destination-echo guard further down (which
      // needs an existing record to compare `sourceConnectionId` against): a
      // cancel arriving on a *destination* connection whose `Order` mapping
      // is not yet written records a signal keyed to that destination
      // connection's id — permanently unconsumable, since the echo guard
      // would early-return before `persistIncomingSnapshot` ever runs for
      // that connection. Narrow and self-limiting (the signal never affects
      // provisioning, it just sits there), not worth a second lookup here.
      await this.orderRecordService.recordEarlyCancellationSignal(
        connectionId,
        externalOrderId,
        new Date()
      );
      this.logger.warn(
        `Cancellation for unknown order: external ${externalOrderId} on connection ${connectionId} ` +
          `has no internal mapping yet — recorded as a pending cancellation signal so the later ` +
          `create is not provisioned active`
      );
      return [];
    }

    const existing = await this.orderRecordService.getOrderRecord(internalOrderId);
    if (existing && existing.sourceConnectionId !== connectionId) {
      // Destination-echo guard (ADR-017): a cancel re-read from a connection OL
      // pushed the order INTO is not the authoritative source's cancel — skip.
      this.logger.debug(
        `Skipping destination-echo cancellation of order ${internalOrderId}: external id ` +
          `${externalOrderId} on connection ${connectionId} maps to an order originating from ` +
          `${existing.sourceConnectionId}`
      );
      return [];
    }

    // Durably record the cancellation on the order record itself (#1984) —
    // previously this handler only relayed to destinations and returned,
    // leaving no queryable trace of the cancellation on the order record.
    // Attempted BEFORE the relay call so the record write isn't skipped if
    // the relay itself throws; first-write-wins, so a redelivered cancel
    // event is a harmless no-op. Swallowed (logged, not rethrown): the
    // pre-existing relay-to-destinations behaviour must not regress because
    // of this new, best-effort write — a transient DB error here must not
    // prevent the cancel from reaching the destination shop.
    try {
      await this.orderRecordService.markCancelled(internalOrderId, new Date());
    } catch (error) {
      this.logger.error(
        `Failed to record cancellation on order record ${internalOrderId} — proceeding with the ` +
          `destination relay regardless; the record will remain queryable as non-cancelled until a ` +
          `future re-poll or retry observes the cancellation again`,
        (error as Error).stack
      );
    }

    const result = await this.orderLifecycleRelay.relay({
      internalOrderId,
      originConnectionId: connectionId,
      event: { type: 'cancelled' },
    });

    const summary =
      result.targets.map((t) => `${t.connectionId}=${t.outcome}`).join(', ') || 'no targets';
    const message = `Cancellation relayed for order ${internalOrderId}: ${summary}`;
    // Surface any non-`applied` target (e.g. a destination that already shipped,
    // so the cancel was rejected) at warn — the cancel is never silently dropped.
    //
    // Formerly a known residual (#1160): a cancel that arrives *before* the
    // order's create/sync job has run finds no relay targets here (there is
    // no order yet to relay to), and the comment used to say closing that
    // race needed the deferred monotonic / relay-log machinery (ADR-027
    // guardrails). #2069's own analysis found that claim false — a per-target
    // relay-obligation table cannot fix a cancel with zero resolved targets,
    // because a sweep re-drives writes that were attempted and failed, and
    // this one was never attemptable. The fix needed only a durable write:
    // the unknown-order branch above now records a `(sourceConnectionId,
    // externalOrderId)`-keyed signal, `OrderRecordService
    // .persistIncomingSnapshot` consumes it the moment the order is
    // genuinely ingested, and `OrderSyncService`'s `#2284`
    // `cancelledAt IS NULL` guard is what then withholds destination
    // creation. No relay-log machinery was ever needed.
    if (result.targets.some((t) => t.outcome !== 'applied')) {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
    return [];
  }

  /**
   * Defensive read of an order record's prior business status from its snapshot
   * (#1146). Returns `undefined` when there is no prior record or the stored
   * value isn't a string — both treated as non-cancelled by the caller. Pure
   * read; binds only to the snapshot's `status` key, not its full JSON layout.
   */
  /**
   * Diff the stored snapshot against the incoming order and persist the fact
   * when something moved (#2283).
   *
   * Best-effort throughout: an ingestion must never fail because an
   * observability fact could not be written, so a repository error is logged and
   * swallowed. The `changes.length > 0` gate is the primary suppressor — on a
   * steady-state poll nothing changed and no statement is issued at all.
   *
   * The log line is PII-free (ids, change kinds and line ids only) and is `warn`
   * rather than `log` on purpose: an adapter with UNSTABLE line ids would report
   * every poll as a removal plus an addition, and that noise must be immediately
   * visible rather than accumulating silently in the column.
   */
  private async recordSourceAmendment(
    existing: OrderRecord | null,
    incoming: IncomingOrder,
    internalOrderId: string,
    connectionId: string
  ): Promise<void> {
    try {
      // `getEnvBoolean` rather than `getPiiConfig()`: the diff needs the FLAG,
      // not the hash salt, and `getPiiConfig` throws when `OL_PII_HASH_SALT` is
      // unset. Reading it here would put an unrelated configuration failure on
      // the ingestion path — swallowed by the catch below, so the fact would go
      // silently unrecorded. The default matches `getPiiConfig`'s own.
      const changes = diffOrderAmendment(existing?.orderSnapshot ?? null, incoming, {
        storePii: getEnvBoolean('OL_STORE_PII', true),
      });
      if (changes.length === 0) {
        return;
      }

      this.logger.warn(
        `Source amended order ${internalOrderId} on connection ${connectionId} after ingestion: ` +
          changes
            .map((c) => (c.lineId ? `${c.kind}(${c.lineId})` : `${c.kind}(${(c.fields ?? []).join(',')})`))
            .join('; ')
      );
      await this.orderRecordService.recordAmendment(internalOrderId, new Date(), changes);
    } catch (error) {
      this.logger.error(
        `Failed to record source amendment for order ${internalOrderId}`,
        (error as Error).stack
      );
    }
  }

  private readSnapshotStatus(existing: OrderRecord | null): string | undefined {
    const value = existing?.orderSnapshot?.status;
    return typeof value === 'string' ? value : undefined;
  }

  private async resolveCustomerId(
    incoming: IncomingOrder,
    connectionId: string,
    internalOrderId: string
  ): Promise<string | undefined> {
    if (incoming.customerExternalId) {
      if (incoming.customerEmail) {
        const resolution = await this.customerIdentityResolver.resolveCustomerIdentity({
          externalBuyerId: incoming.customerExternalId,
          email: incoming.customerEmail,
          sourceConnectionId: connectionId,
        });
        return resolution.internalCustomerId;
      }
      return this.identifierMapping.getOrCreateInternalId(
        CORE_ENTITY_TYPE.Customer,
        incoming.customerExternalId,
        connectionId,
        { parentEntityType: CORE_ENTITY_TYPE.Order, parentInternalId: internalOrderId }
      );
    }

    // Email-only source (#1208 / #995): marketplaces like Erli expose no buyer
    // id — only the buyer email. The email IS the stable buyer identity, so key
    // identity resolution on it (raw email as the connection-scoped buyer-id
    // mapping key; the resolver normalizes + hashes internally for projection
    // matching). Without this the unified Order would carry no customerId and
    // the destination order-create (e.g. PrestaShop) fails closed.
    if (incoming.customerEmail) {
      const resolution = await this.customerIdentityResolver.resolveCustomerIdentity({
        externalBuyerId: incoming.customerEmail,
        email: incoming.customerEmail,
        sourceConnectionId: connectionId,
      });
      return resolution.internalCustomerId;
    }

    return undefined;
  }

  /**
   * Record the rate the CHANNEL itself reported for this line (#2250,
   * ADR-063 § 4).
   *
   * Written only where the source order line really carried one. Most sources
   * carry none (Allegro's `lineItems[].tax` is nullable and an OL-published
   * offer reported no rate at all before this epic), and a row written on their
   * behalf would be OpenLinker's own resolved value wearing the channel's name -
   * which is exactly the attribution the journal exists to keep separable.
   *
   * Best-effort and never throws. The journal is provenance: losing an entry
   * costs an audit trail, while failing the ingestion over it would cost the
   * order.
   */
  private async journalChannelTaxRate(
    connectionId: string,
    productId: string,
    variantId: string | null,
    item: IncomingOrderItem
  ): Promise<void> {
    const channelCode = item.taxRate?.trim();
    if (!channelCode) {
      return;
    }
    try {
      await this.taxRateJournal.record({
        productId,
        variantId,
        connectionId,
        origin: 'channel',
        taxRate: channelCode,
      });
    } catch (error) {
      this.logger.warn(
        `Tax-rate journal write failed for an order line (provenance only, the order is unaffected) ` +
          `[connectionId=${connectionId}, productId=${productId}, variantId=${variantId ?? 'none'}]: ${(error as Error).message}`
      );
    }
  }

  /**
   * Settle the line's tax rate at ingestion (#2054, ADR-063 § 1 and § 4).
   *
   * Shop first, channel second. The order of the two rungs is the decision, not
   * an implementation detail: a rate fixed in the shop serves every channel,
   * while a rate only the marketplace knows was stamped at purchase and can
   * never be corrected afterwards - so preferring the channel would quietly
   * make the unfixable answer authoritative.
   *
   * The shop is read from OpenLinker's own catalogue projection, never live.
   * Issuance must not depend on the shop being reachable, and re-ingesting an
   * order must not be able to move a figure a document was already issued
   * against.
   *
   * Returning **nothing** is a real outcome and is left as absent fields, not
   * an empty string or a zero. It is what holds the document, and the gate
   * child is what reports it.
   */
  private async resolveLineTaxRate(
    productId: string,
    variantId: string | undefined,
    item: IncomingOrderItem
  ): Promise<{
    taxRate?: string;
    taxRateCountry?: string;
    taxSource?: TaxRateSource;
    taxRateReadAt?: string;
    taxRateChannel?: string;
  }> {
    let shopRate: StoredTaxRate | null = null;
    try {
      shopRate = await this.productsService.getEffectiveTaxRate(productId, variantId);
    } catch (error) {
      // A catalogue read failure is not a statement about the rate. Fall
      // through to the channel rung rather than recording a false absence.
      this.logger.warn(
        `Tax-rate catalogue read failed for order line [productId=${productId}, variantId=${variantId ?? 'none'}]: ${(error as Error).message}`
      );
    }

    if (shopRate && taxRateState(shopRate) === 'known' && shopRate.code) {
      // #2254 (epic F1): when the channel ALSO reported a rate and it differs,
      // record the other number. The shop still wins and the document still
      // issues - this is the evidence for a non-blocking conflict, not a veto.
      // Recorded only on disagreement, so its presence IS the conflict and no
      // reader has to compare two fields to find out.
      const channelCode = item.taxRate?.trim();
      const conflicts = Boolean(channelCode) && channelCode !== shopRate.code;
      return {
        taxRate: shopRate.code,
        ...(shopRate.countryIso2 ? { taxRateCountry: shopRate.countryIso2 } : {}),
        taxSource: 'shop',
        ...(shopRate.readAt ? { taxRateReadAt: shopRate.readAt.toISOString() } : {}),
        ...(conflicts ? { taxRateChannel: channelCode } : {}),
      };
    }

    const channelCode = item.taxRate?.trim();
    if (channelCode) {
      return {
        taxRate: channelCode,
        ...(item.taxRateCountry ? { taxRateCountry: item.taxRateCountry } : {}),
        taxSource: 'channel',
        // The channel reported it with this order, so the read instant is now.
        taxRateReadAt: new Date().toISOString(),
      };
    }

    // Neither rung answered. `taxRateReadAt` still travels when the shop was
    // asked, so a reader can tell "the shop has no rate for this" apart from
    // "nothing has ever looked" - the distinction #2245 F3 exists for.
    return shopRate?.readAt ? { taxRateReadAt: shopRate.readAt.toISOString() } : {};
  }

  /**
   * Record OpenLinker's own advisory holds for this order (#2344, ADR-061).
   *
   * **Best-effort by design — this never fails the ingestion.** An advisory hold
   * is exactly that: the order is the fact, the hold is OL's accounting of it, so
   * losing an order because OL could not record its own optimistic promise
   * inverts the priority. `InsufficientAvailabilityError` in particular is the
   * routine, expected refusal of an oversell, and turning it into a failed job
   * would burn the whole retry ladder against a condition retrying cannot change.
   * Surfacing a shortfall as a named fact ON the order is #2349's work; until
   * then the signal is this error-level log.
   *
   * `alreadyCancelled` (#2069) covers the race where an early-cancellation
   * signal was already consumed onto this order's `cancelledAt` while
   * `order.status` — built from the same source read that raced the signal —
   * still reports the pre-cancel status. Holding stock for an order OL already
   * knows is dead would be a hold nothing then releases (#2346's expiry sweep
   * does not release while `UnavailableOrderHoldReader` is bound), so this must
   * be checked independently of `order.status`.
   */
  private async reserveOrderInventory(
    order: Order,
    connectionId: string,
    fulfillmentRouting: () => Promise<FulfillmentRoutingResolution | null>,
    alreadyCancelled = false,
    routedByOms = false
  ): Promise<void> {
    try {
      // A kill switch, default ON (#2344 review). The ledger is additive and
      // nothing subtracts from it until #2345, but this is new unconditional
      // work on the hottest path in the system — a routing resolve plus two
      // reads and a write transaction, re-run on every re-poll — so an operator
      // whose ingestion latency regresses needs an escape hatch that is not a
      // redeploy. Default ON rather than opt-in, because #2345 cannot subtract
      // from a ledger nothing populated.
      if (!getEnvBoolean('OL_RESERVATIONS_ENABLED', true)) return;

      // Holding stock for an order that arrived already dead is pure noise.
      if (order.status === 'cancelled' || alreadyCancelled) return;

      const lines: ReserveOrderLineInput[] = order.items
        .filter((item) => Boolean(item.productId) && item.quantity > 0)
        .map((item) => ({
          orderLineId: item.id,
          productId: item.productId,
          productVariantId: item.variantId ?? null,
          quantity: item.quantity,
        }));

      if (lines.length === 0) return;

      // #3480: an order OpenLinker is about to route stays in OpenLinker — no
      // destination ever receives it — so its hold must reduce what marketplaces
      // are told from this moment, whatever the ADR-012 dispatch routing says
      // (its default `omp_fulfilled` would stamp `diagnostic` and open an
      // oversell window until the sale decrement lands). The decrement then
      // consumes the hold, so the units are counted once.
      const atpEffect: ReservationAtpEffect = routedByOms
        ? 'published'
        : this.toReservationAtpEffect(order, await fulfillmentRouting());

      let result;
      try {
        result = await this.reservationService.reserveForOrder({
          orderRecordId: order.id,
          atpEffect,
          lines,
        });
      } catch (error) {
        if (!(error instanceof AmbiguousReservationPositionError)) throw error;
        // One ambiguous line must not cost the order every other line's hold.
        // The throw is exhaustive (it names every ambiguous line), so ONE retry
        // without them suffices — never a loop.
        this.logger.error(
          `Ambiguous inventory positions while reserving order ${order.id}; ` +
            `re-reserving without ${error.ambiguities.length} affected line(s): ${error.message}`
        );
        const ambiguous = new Set(error.ambiguities.map((a) => a.orderLineId));
        const remaining = lines.filter((line) => !ambiguous.has(line.orderLineId));
        if (remaining.length === 0) return;
        result = await this.reservationService.reserveForOrder({
          orderRecordId: order.id,
          atpEffect,
          lines: remaining,
        });
      }

      if (result.skipped.length > 0) {
        this.logger.warn(
          `Reserved ${result.granted.length} line(s) for order ${order.id}; ` +
            `skipped ${result.skipped.length}: ${result.skipped
              .map((s) => `${s.orderLineId}=${s.reason}`)
              .join(', ')}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to reserve inventory for order ${order.id} [connectionId=${connectionId}]; ` +
          'the order is unaffected and no hold was recorded',
        (error as Error).stack
      );
    }
  }

  /**
   * Which reservations reduce published ATP, for THIS order (ADR-061 decision 1).
   *
   * `published` is written only where OpenLinker itself executes fulfillment. On
   * the default `omp_fulfilled` topology the marketplace or destination ships, so
   * the hold is recorded for visibility and subtracted from nothing.
   *
   * Two arms resolve `diagnostic` for the same reason. A rule pointing at a
   * non-`active` processor still matches but reports `processorAvailable: false`,
   * and stamping `published` there would assert OL executes an order over a route
   * OL demonstrably cannot drive — immutably, since the stamp is insert-only. And
   * a routing failure is not a licence to guess: over-subtraction is the harm
   * ANALYSIS-1032 calls worse than shipping nothing (a seller with 3 units
   * publishing 0 after selling 1, for the whole TTL), so the unknown case takes
   * the arm that subtracts from nothing.
   */
  private toReservationAtpEffect(
    order: Order,
    resolution: FulfillmentRoutingResolution | null
  ): ReservationAtpEffect {
    // `null` is a failed routing read, already warned about where it failed.
    if (resolution === null) return 'diagnostic';

    if (resolution.processorKind === FULFILLMENT_PROCESSOR_KIND.OmpFulfilled) {
      return 'diagnostic';
    }
    if (!resolution.processorAvailable) {
      this.logger.warn(
        `Fulfillment route for order ${order.id} names an unavailable processor; ` +
          'recording the reservation as diagnostic rather than claiming OL executes it'
      );
      return 'diagnostic';
    }
    return 'published';
  }

  /**
   * The order's ADR-012 fulfilment routing, resolved lazily and at most once.
   *
   * **Never rejects.** A failed read answers `null`, which each reader treats as
   * "unknown": the reservation takes the `diagnostic` arm and the #3488 routing
   * skip keeps routing. The failed promise is cached like a successful one, so a
   * store outage costs one warning per order, not one per reader.
   */
  private memoizeFulfillmentRouting(
    order: Order,
    connectionId: string
  ): () => Promise<FulfillmentRoutingResolution | null> {
    let resolution: Promise<FulfillmentRoutingResolution | null> | undefined;
    return () => {
      resolution ??= this.fulfillmentRouting
        .resolve({
          sourceConnectionId: connectionId,
          sourceDeliveryMethodId: order.shipping?.methodId ?? null,
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Could not resolve fulfillment routing for order ${order.id}; ` +
              `treating it as unknown: ${(error as Error).message}`
          );
          return null;
        });
      return resolution;
    };
  }

  private buildUnifiedOrder(
    incoming: IncomingOrder,
    internalOrderId: string,
    internalCustomerId: string | undefined,
    resolvedItems: Order['items']
  ): Order {
    return {
      id: internalOrderId,
      orderNumber: incoming.orderNumber,
      status: incoming.status,
      customerId: internalCustomerId,
      // Carry the buyer email through (#948) — used only for customer-identity
      // resolution before this point; the snapshot needs it for the label
      // recipient. PII gating happens at persistence (`persistOrder`).
      customerEmail: incoming.customerEmail,
      items: resolvedItems,
      totals: incoming.totals,
      shippingAddress: incoming.shippingAddress,
      billingAddress: incoming.billingAddress,
      shipping: incoming.shipping,
      pickupPoint: incoming.pickupPoint,
      deliverySmart: incoming.deliverySmart,
      paymentStatus: incoming.paymentStatus,
      codToCollect: incoming.codToCollect,
      dispatchTime: incoming.dispatchTime,
      placedAt: incoming.placedAt ? new Date(incoming.placedAt) : undefined,
      createdAt: new Date(incoming.createdAt),
      updatedAt: new Date(incoming.updatedAt),
    };
  }
}
