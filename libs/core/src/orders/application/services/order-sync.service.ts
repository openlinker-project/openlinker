/**
 * Order Sync Service
 *
 * Application service for synchronizing orders from sources to destination processors.
 * Routes unified orders (with internal IDs) to every active connection whose adapter
 * supports the `OrderProcessorManager` capability — narrowed by an optional routing
 * filter, see below — with per-destination error isolation.
 *
 * ## Router-filtered fan-out (#2397, design §5.5)
 *
 * This service is RETAINED, not reinterpreted. Destination-mirror creation is a
 * commercial/catalogue act, distinct from fulfilment assignment — so under a
 * router the fan-out is merely NARROWED, by the optional
 * `OrderSyncRequest.destinationConnectionIds`. Absent ⇒ today's behaviour.
 *
 * **A filtered-out destination gets no `syncStatus[]` entry, by design, and
 * that is safe** because nothing downstream derives correctness from one:
 * for routed orders `fulfillmentState` is fed by work-progress-derived
 * shipments through `ShipmentDispatchService`, and the reservation
 * publish-subtraction never consults `fulfillmentState` at all (design §3
 * adjudication #1). The cost is presentational and is stated at the branch.
 *
 * This service resolves NO router and imports nothing from
 * `@openlinker/core/fulfillment` — the ids arrive as caller-supplied data, so
 * ADR-053's no-injection direction is preserved for free rather than merely
 * respected. Populating them at ingestion is #2400's.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderSyncService}
 * @see {@link IOrderSyncService} for the service interface
 * @see {@link OrderProcessorManagerPort} for destination processor port
 * @see {@link IIntegrationsService} for adapter resolution
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  IOrderSyncService,
  OrderSyncRequest,
  OrderSyncResult,
} from '../interfaces/order-sync.service.interface';
import type { OrderProcessorManagerPort } from '../../domain/ports/order-processor-manager.port';
import type { OrderCreate, OrderRef } from '../../domain/types/order-processor.types';
import { OrderStatusValues } from '../../domain/types/order.types';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IMappingConfigService, MAPPING_CONFIG_SERVICE_TOKEN } from '@openlinker/core/mappings';
import { SyncLockPort, SYNC_LOCK_TOKEN } from '@openlinker/core/sync';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
  DuplicateIdentifierMappingError,
  MappingAlreadyExistsError,
} from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';
import { NoOrderDestinationsAvailableException } from '../../domain/exceptions/no-order-destinations-available.exception';
import { OrderCreateContendedException } from '../../domain/exceptions/order-create-contended.exception';
import { ORDER_CREATE_LOCK_TTL_MS, orderCreateLockKey } from './order-create-lock';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { IOrderHoldService } from '../interfaces/order-hold.service.interface';
import { ORDER_HOLD_SERVICE_TOKEN, ORDER_RECORD_SERVICE_TOKEN } from '../../orders.tokens';

@Injectable()
export class OrderSyncService implements IOrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(MAPPING_CONFIG_SERVICE_TOKEN)
    private readonly mappingConfigService: IMappingConfigService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
    @Inject(ORDER_HOLD_SERVICE_TOKEN)
    private readonly orderHoldService: IOrderHoldService
  ) {}

  async syncOrder(request: OrderSyncRequest): Promise<OrderSyncResult[]> {
    const { order, sourceConnectionId, sourceEventId } = request;

    this.logger.log(
      `Syncing order ${order.id} from source connection ${sourceConnectionId}${sourceEventId ? ` (event: ${sourceEventId})` : ''}`
    );

    const requestedDestinations = request.destinationConnectionIds;
    const { destinations, unresolvedRequestedIds } = await this.resolveDestinations(
      sourceConnectionId,
      requestedDestinations
    );

    // #2397 — an empty destination list now conflates THREE conditions, and
    // only one of them is a non-event. `listCapabilityAdapters` is active-only,
    // so they must be told apart here:
    //
    //   (a) nothing configured / everything inactive  -> throw, as today
    //   (b) the router deliberately named NOBODY      -> warn, return []
    //   (c) the router named ids none of which are
    //       currently eligible                        -> throw, naming them
    if (destinations.length === 0) {
      if (requestedDestinations !== undefined && requestedDestinations.length === 0) {
        // (b) Ruling 1 — a deliberate empty routing decision is a NON-EVENT and
        // must not throw. `MarketplaceOrderSyncHandler` wraps any throw in
        // `SyncJobExecutionError`, and `isNonRetryableError` consults the
        // PER-PLUGIN retry-classifier registry where a core `orders` exception
        // is registered nowhere — so it is retryable. That would re-run the
        // whole of `syncOrderFromSource` (a live marketplace `getOrder`,
        // `persistOrder`, identity resolution, projection updates) ~10 times
        // with backoff and end in a dead job whose `lastError` blames
        // connection configuration for what the ROUTER chose. Loud, and
        // pointing the wrong way.
        //
        // Returning [] makes ingestion's `results.map(...)` a no-op, matching
        // this file's own philosophy: `skipped_cancelled` and `skipped_held`
        // exist precisely so "nothing went wrong" cannot be routed into a retry.
        //
        // KNOWN COST (recorded, not hidden): no `syncStatus` row is written, so
        // on `/orders` today such an order is indistinguishable from one with
        // nothing configured — both render "No destinations". That is a real
        // operator-facing gap in the surface, not a reason to throw here.
        this.logger.warn(
          `Order ${order.id}: the routing decision named no destination for source connection ` +
            `${sourceConnectionId}; no destination provisioning and no sync-status rows written`
        );
        return [];
      }

      // (a) and (c). The exception distinguishes them by whether it carries the
      // unresolved ids. (c) is a genuine NEW regression: an order whose only
      // routed destination is momentarily disabled becomes a total failure,
      // where an unfiltered fan-out would still have reached its siblings. It
      // throws rather than returning [] because the router asked for a
      // destination and OpenLinker could not reach it — and the retry that
      // follows is appropriate, since a disabled connection can be re-enabled.
      //
      // The ids handed over are the SOURCE-ECHO-EXCLUDED set, never the raw
      // request: naming the source connection as "not an eligible destination"
      // would be a false statement about the operator's configuration. An
      // empty set with a non-empty request therefore means every named id WAS
      // the source — a distinct router misconfiguration the message names.
      throw new NoOrderDestinationsAvailableException(
        order.id,
        sourceConnectionId,
        unresolvedRequestedIds
      );
    }

    // #2284 — the `WHERE cancelledAt IS NULL` provisioning predicate. A source
    // cancellation is an observation, never gated (DESIGN-oms-authority-model
    // § 6.4), so a create/update job enqueued before the cancel — or an operator
    // retry afterwards — would otherwise still create the order in every
    // destination. Withhold instead: no lock, no `createOrder`, no mapping write.
    //
    // Deliberately RE-READ rather than threaded from ingestion: ingestion's own
    // snapshot is taken before item resolution and persist, so it is stale in
    // exactly the race this closes. A missing record means "nothing known", which
    // is not "cancelled" — proceed. A read failure PROPAGATES: provisioning a
    // possibly-cancelled order because a read blipped is the worse outcome.
    const record = await this.orderRecordService.getOrderRecord(order.id);
    if (record?.isCancelled) {
      const cancelledAt = record.cancelledAt as Date;
      this.logger.warn(
        `Order ${order.id} was cancelled at source (${cancelledAt.toISOString()}); skipping destination provisioning for ${destinations.length} destination(s)`
      );
      return destinations.map(({ connectionId }) => ({
        destinationConnectionId: connectionId,
        status: 'skipped_cancelled' as const,
        cancelledAt,
      }));
    }

    // #2339 — the hold gate, story L4: "a held order never reaches the
    // destination shop". It sits beside the cancellation predicate above and
    // reads the SAME way — a re-read at the choke point, not a value threaded
    // from a caller who may have looked before the hold was placed.
    //
    // Deliberately reads `order_holds` through `IOrderHoldService`, never
    // #2340's denormalised `order_records.activeHoldReason`: the projection is
    // a cache that loses on drift, and a gate that trusts a stale cache lets a
    // held order ship. That is the epic's L4 exit criterion.
    //
    // Unlike the cancellation skip, this one is NOT terminal: the next run
    // after a release provisions the order with no manual step, which is why no
    // per-destination sync status is persisted for it (see the ingestion
    // handler) and why it has its own result arm.
    //
    // A read failure PROPAGATES, for the same reason cancellation's does:
    // provisioning a possibly-held order because a read blipped is the worse
    // outcome.
    const openHold = await this.orderHoldService.getOpenHold(order.id);
    if (openHold) {
      this.logger.warn(
        `Order ${order.id} is on hold (${openHold.id}, reason '${openHold.reason}'); ` +
          `withholding destination provisioning for ${destinations.length} destination(s)`
      );
      return destinations.map(({ connectionId }) => ({
        destinationConnectionId: connectionId,
        status: 'skipped_held' as const,
        holdId: openHold.id,
        holdReason: openHold.reason,
      }));
    }

    // Resolve status mapping once — identical across all destinations
    const resolvedStatus = await this.mappingConfigService.resolveStatusMapping(
      sourceConnectionId,
      order.status
    );
    const orderStatus = resolvedStatus
      ? this.validateOrderStatus(resolvedStatus)
      : this.validateOrderStatus(order.status);

    const orderCreate: OrderCreate = {
      orderNumber: order.orderNumber,
      status: orderStatus,
      customerId: order.customerId,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
      })),
      totals: {
        subtotal: order.totals.subtotal,
        tax: order.totals.tax,
        shipping: order.totals.shipping,
        total: order.totals.total,
        currency: order.totals.currency,
        taxTreatment: order.totals.taxTreatment,
      },
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
      shipping: order.shipping,
      pickupPoint: order.pickupPoint,
      source: { connectionId: sourceConnectionId, eventId: sourceEventId },
      // Threaded so a destination can record what the buyer has paid apart from
      // what the order is worth (#2600). Passed through, never derived.
      paymentStatus: order.paymentStatus,
      metadata: {
        // Required by destination adapters (e.g. WooCommerce) for idempotency checks.
        internalOrderId: order.id,
        // Neutral buyer email passthrough (#948 source → destination). Destination
        // adapters that provision a customer keyed on email (e.g. WooCommerce)
        // read this; platform-neutral and omitted when the source has no email.
        ...(order.customerEmail ? { buyerEmail: order.customerEmail } : {}),
        // Stamped once and shared across destinations: marks when OL started
        // dispatching this order, not per-destination completion time.
        syncedAt: new Date().toISOString(),
      },
    };

    // Dispatch in parallel with per-destination error isolation. Each create is
    // serialized per (order, destination) by a lock so converging triggers
    // (webhook + poll, or a job retry) on multiple workers can't double-create.
    const settled = await Promise.allSettled(
      destinations.map(({ connectionId, adapter }) =>
        this.createOrderIdempotently(adapter, connectionId, order.id, orderCreate).then(
          (orderRef) => ({ connectionId, orderRef })
        )
      )
    );

    // Lock contention (a concurrent create is in-flight for the same order) is a
    // retryable condition, not a per-destination failure: rethrow so the sync
    // job retries (mirrors MissingOrderItemMappingError). By the retry the peer
    // worker has finished and the create is skipped.
    //
    // Note: the whole-job retry re-dispatches every destination, including ones
    // that already succeeded this run (they hit the core skip path) and a
    // sibling that genuinely failed (re-attempted as a side effect). Both are
    // safe because create is idempotent: the skip path returns the
    // destination-native external id from the persisted mapping (#909).
    const contended = settled.find(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected' && outcome.reason instanceof OrderCreateContendedException
    );
    if (contended) {
      this.logger.warn(`Order ${order.id} create contended on a destination; retrying sync job`);
      throw contended.reason;
    }

    return settled.map((outcome, index): OrderSyncResult => {
      const destinationConnectionId = destinations[index].connectionId;

      if (outcome.status === 'fulfilled') {
        const { orderRef } = outcome.value;
        this.logger.log(
          `Order ${order.id} synced to destination ${destinationConnectionId} (destination order: ${orderRef.orderId}${orderRef.orderNumber ? `, orderNumber: ${orderRef.orderNumber}` : ''})`
        );
        return {
          destinationConnectionId,
          status: 'success',
          orderRef,
        };
      }

      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      this.logger.error(
        `Order ${order.id} failed to sync to destination ${destinationConnectionId}: ${message}`,
        outcome.reason instanceof Error ? outcome.reason.stack : undefined
      );
      return {
        destinationConnectionId,
        status: 'failed',
        error: { message },
      };
    });
  }

  /**
   * Create one order at one destination, idempotently, under a per-(order,
   * destination) lock — platform-agnostically, with no per-adapter create-or-skip
   * code (#909).
   *
   * The lock removes the multi-worker race the adapter could not (`sync-job.runner`
   * locks per-job, not per-order). Two skip paths read the destination mapping:
   * - **Lock held by a peer (contention):** re-read the mapping; if the peer
   *   already created the order, synthesize the ref from it; otherwise throw a
   *   retryable `OrderCreateContendedException` so the sync job retries.
   * - **Lock acquired:** re-read the mapping first (a *prior, completed* run may
   *   already have created+mapped this order before the lock was released); skip
   *   if present, else create via the adapter and persist the external↔internal
   *   mapping. The adapter returns the destination-native external id, which is
   *   what every consumer of `OrderRef.orderId` / `syncStatus.externalOrderId`
   *   expects.
   */
  private async createOrderIdempotently(
    adapter: OrderProcessorManagerPort,
    destinationConnectionId: string,
    internalOrderId: string,
    orderCreate: OrderCreate
  ): Promise<OrderRef> {
    const lockKey = orderCreateLockKey(destinationConnectionId, internalOrderId);
    const token = await this.syncLock.acquire(lockKey, ORDER_CREATE_LOCK_TTL_MS);

    if (!token) {
      const existing = await this.findDestinationMapping(internalOrderId, destinationConnectionId);
      if (existing) {
        this.logger.log(
          `Order ${internalOrderId} already present at destination ${destinationConnectionId} ` +
            `(concurrent create resolved); skipping create`
        );
        return { orderId: existing };
      }
      throw new OrderCreateContendedException(internalOrderId, destinationConnectionId);
    }

    try {
      // A prior completed run may already have created + mapped this order
      // (lock since released). Skip rather than POST a duplicate.
      const existing = await this.findDestinationMapping(internalOrderId, destinationConnectionId);
      if (existing) {
        this.logger.log(
          `Order ${internalOrderId} already present at destination ${destinationConnectionId}; ` +
            `skipping create`
        );
        return { orderId: existing };
      }

      // Create-then-record is non-atomic: if createOrder succeeds but
      // persistDestinationMapping throws a non-duplicate (transient) error, the
      // destination order exists with no mapping. On the next retry this method
      // re-enters createOrder (the mapping read finds nothing); the adapter's
      // own platform-side duplicate recovery is what prevents a second
      // destination order in that window — hence the port contract asks adapters
      // to keep it as defense-in-depth.
      const orderRef = await adapter.createOrder(orderCreate);
      await this.persistDestinationMapping(
        internalOrderId,
        destinationConnectionId,
        orderRef,
        orderCreate.orderNumber
      );
      return orderRef;
    } finally {
      // Best-effort release — never let a release failure mask the create result.
      try {
        await this.syncLock.release(lockKey, token);
      } catch (releaseError) {
        this.logger.warn(
          `Failed to release order-create lock ${lockKey}: ` +
            `${releaseError instanceof Error ? releaseError.message : String(releaseError)}`
        );
      }
    }
  }

  /**
   * Return the destination-native external order id mapped to this internal
   * order at the given destination connection, or null if no mapping exists.
   */
  private async findDestinationMapping(
    internalOrderId: string,
    destinationConnectionId: string
  ): Promise<string | null> {
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Order,
      internalOrderId
    );
    return mappings.find((m) => m.connectionId === destinationConnectionId)?.externalId ?? null;
  }

  /**
   * Persist the external↔internal order mapping after a successful create. A
   * concurrent worker may have inserted the same mapping between our skip-read
   * and this write (the lock bounds same-process contention, not cross-process
   * unique-constraint races), so a duplicate is the expected idempotent outcome
   * and is swallowed.
   */
  private async persistDestinationMapping(
    internalOrderId: string,
    destinationConnectionId: string,
    orderRef: OrderRef,
    orderNumber?: string
  ): Promise<void> {
    try {
      await this.identifierMapping.createMapping(
        CORE_ENTITY_TYPE.Order,
        orderRef.orderId,
        destinationConnectionId,
        internalOrderId,
        {
          metadata: {
            orderNumber: orderRef.orderNumber ?? orderNumber,
            createdAt: new Date().toISOString(),
          },
        }
      );
    } catch (error) {
      if (
        error instanceof DuplicateIdentifierMappingError ||
        error instanceof MappingAlreadyExistsError
      ) {
        this.logger.debug(
          `Destination order mapping already present for internalOrderId=${internalOrderId} ` +
            `externalOrderId=${orderRef.orderId} (idempotent create resolved)`
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Resolve the destinations to dispatch to, applying the optional router
   * filter (#2397).
   *
   * `unresolvedRequestedIds` is present ONLY when a filter was supplied AND
   * nothing resolved — it is then the requested ids that named no eligible
   * destination, source echoes already removed and deduped, and is EMPTY when
   * every id named the source itself. `undefined` otherwise, so the field
   * never has to be read together with `destinations` to be understood.
   *
   * Each narrowing is reported exactly once: partially here as a warn, fully
   * by the exception `syncOrder` raises from these ids.
   */
  private async resolveDestinations(
    sourceConnectionId: string,
    destinationConnectionIds?: readonly string[]
  ): Promise<{
    destinations: Array<{ connectionId: string; adapter: OrderProcessorManagerPort }>;
    unresolvedRequestedIds?: readonly string[];
  }> {
    // The listing argument is deliberately UNCHANGED and carries exactly one
    // key. The router filter is applied to the RESULT below, never pushed down
    // into this call: narrowing here would put the filter beneath the
    // capability gate, where the three conditions behind an empty list stop
    // being distinguishable from one another.
    const resolved =
      await this.integrationsService.listCapabilityAdapters<OrderProcessorManagerPort>({
        capability: 'OrderProcessorManager',
      });

    const eligible = resolved
      .filter(({ connectionId }) => connectionId !== sourceConnectionId)
      .map(({ connectionId, adapter }) => ({ connectionId, adapter }));

    // #2397 ruling 4 — DEGRADE TO UNFILTERED, NEVER TO FILTERED-EMPTY.
    //
    // A caller with no routing answer must omit this field, never pass `[]`.
    // `undefined` degrades to the unfiltered fan-out every install has today;
    // `[]` is a router that positively selected nobody. Get that backwards and
    // provisioning silently stops on every install that exists.
    //
    // Note the deliberate asymmetry with #2393's `assertRoutingPlanResolved`,
    // which RAISES on an *unrecognised* plan status: that is a programming
    // error. An ABSENT router is the normal state — the state of every install
    // today — and must pass straight through.
    if (destinationConnectionIds === undefined) {
      return { destinations: eligible };
    }

    const requested = new Set(destinationConnectionIds);
    const filtered = eligible.filter(({ connectionId }) => requested.has(connectionId));
    const resolvedIds = new Set(filtered.map(({ connectionId }) => connectionId));

    // Source-echo ids are excluded from the unresolved set, and that exclusion
    // is load-bearing rather than cosmetic: source exclusion runs BEFORE the
    // filter, so an id naming the source was dropped BY DESIGN and is not an
    // unreachable connection. Reporting it as one — in the warn or in the
    // exception message — would tell an operator a connection is unreachable
    // when the router in fact routed the order back to where it came from.
    //
    // Deduped through the requested Set, so a repeated id is named once.
    const unresolved = [...requested].filter(
      (id) => id !== sourceConnectionId && !resolvedIds.has(id)
    );

    // #2397 ruling 6 — a narrowed fan-out is never silent. Without this an
    // operator cannot tell a working router from a broken connection.
    //
    // Only the PARTIAL narrowing is warned here; a fully-unresolved decision
    // carries the same ids into the exception instead, so it is reported
    // exactly once rather than warned and thrown about.
    if (unresolved.length > 0 && filtered.length > 0) {
      this.logger.warn(
        `Routing decision for source connection ${sourceConnectionId} named ` +
          `${requested.size} destination(s); ${filtered.length} resolved. Unresolved ` +
          `(unknown, inactive, or not OrderProcessorManager-capable): [${unresolved.join(', ')}]`
      );
    }

    // Reported ONLY when nothing resolved. With a non-empty `filtered` the
    // partial-narrowing warn above has already said everything there is to
    // say, and returning `[]` there would make one value mean two different
    // things — "everything resolved" and "only the source was named" — which
    // is exactly the conflation this change exists to remove one level up.
    return filtered.length > 0
      ? { destinations: filtered }
      : { destinations: filtered, unresolvedRequestedIds: unresolved };
  }

  /**
   * Validate and map order status string to OrderStatus type
   *
   * Ensures type safety when mapping from Order (string status) to OrderCreate (OrderStatus union).
   * Defaults to 'pending' if status is not recognized.
   */
  private validateOrderStatus(status: string): OrderCreate['status'] {
    if (OrderStatusValues.includes(status as OrderCreate['status'])) {
      return status as OrderCreate['status'];
    }
    this.logger.warn(`Unknown order status: ${status}, defaulting to 'pending'`);
    return 'pending';
  }
}
