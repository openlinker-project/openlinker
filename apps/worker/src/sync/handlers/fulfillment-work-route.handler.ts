/**
 * Fulfillment Work Route Handler (#2395, `W3a-6`, ADR-054 R1, DESIGN §5.3)
 *
 * Handles `fulfillment.work.route` — decide where ONE order is fulfilled from
 * and commit that decision atomically with the work it creates.
 *
 * ## This handler exists BECAUSE core may not resolve any of this
 *
 * `fulfillment` is a registered zero-sibling-edge leaf, so `RoutingCommitService`
 * may not inject `identifier-mapping`, `orders`, `integrations` or `sync`
 * (ADR-053's no-injection invariant, enforced by `barrel-purity.spec.ts`).
 * Selection, the order projection and the lock are therefore resolved HERE, in
 * the host that already composes them, and cross into core as ARGUMENTS. That is
 * ADR-053's own rule — "order data enters as arguments" — and it is exactly the
 * shape #2399's `FulfillmentWorkDispatchHandler` established.
 *
 * ## The router is resolved through a port; `null` is still the default
 *
 * `FulfillmentRouter` is deliberately absent from `CoreCapabilityValues` and
 * from every manifest (#2393/#2403 — A2 is `config-only`), so the router is
 * never resolved through `getCapabilityAdapter`. It arrives instead through
 * `FulfillmentRouterResolverPort` — the ONE seam, shared with #2396's ingestion
 * intercept deliberately: two copies would let one site route while the other
 * mirrors, which is a double shipment (see the port's own header).
 *
 * `null` remains the answer for any connection that is not an OMS one, and on
 * every installation that has not adopted OMS routing this handler still
 * completes as a no-op. That is not unfinished work. ADR-054: *"with no router
 * configured the layer is a degenerate pass-through: no work objects, today's
 * path byte-identical — the property that survives the Wave-5 kill."*
 *
 * ## Nothing enqueues this job type yet, and no outcome is surfaced yet
 *
 * There is no producer in the tree: #2396 owns the ingestion intercept that will
 * enqueue it. Combined with the `null` router above, every arm below except the
 * two `ok` short-circuits is unreachable on any installation this slice ships.
 *
 * More importantly, **every non-routed outcome here is log-only**. An order that
 * will never ship because two connections claim A2 currently reads as a healthy
 * `ok` job. That is the shape ADR-041 §54 / #2100 forbid for sales documents,
 * where the gate REPORTS and `OrderIngestionService` PERSISTS the reason onto
 * the order. Routing is designed the same way — DESIGN §5.3's
 * "gate-reports / caller-persists", the one-way edge that keeps
 * `fulfillment -> orders` from becoming a DI cycle — and the caller in question
 * is #2396. So the persistence half lands there, not here; until it does, an
 * ambiguity is visible only in this log line.
 *
 * ## Outcome contract (ADR-007)
 *
 * | Result | Outcome |
 * |---|---|
 * | routed, or nothing to do (no router / ambiguous / already routed / cancelled) | `ok` |
 * | the router answered and OpenLinker refused the plan | `business_failure` — deterministic; retrying is told the same thing |
 * | the router timed out or threw | **throws** (retryable) — the decision stays `live`, see below |
 * | the order cannot be read yet | **throws** (retryable) |
 *
 * An `in-doubt` outcome throws rather than terminating, and the asymmetry is the
 * point: the decision row is deliberately left `live`, so the retry RESUMES it
 * under the identical idempotency key instead of minting a second one.
 *
 * PII: the ship-to projection is `RoutingShipTo`, ADR-062's allowlist. Failure
 * logs name ids only, never the projection.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  FULFILLMENT_ROUTER_RESOLVER_TOKEN,
  ROUTING_COMMIT_SERVICE_TOKEN,
  buildRoutingShipTo,
  deriveFulfillmentDispatchEnqueueIntents,
  findUndispatchableWorkIds,
  type FulfillmentRouterResolverPort,
  type IRoutingCommitService,
  type RoutingCommitOutcome,
  type RoutingInputLine,
  type RoutingShipTo,
} from '@openlinker/core/fulfillment';
import {
  isFulfillmentRouterUnroutable,
  selectPrimaryFulfillmentRouter,
  type AuthorityClaimantInput,
} from '@openlinker/core/fulfillment-authority';
import { CONNECTION_PORT_TOKEN, type ConnectionPort } from '@openlinker/core/identifier-mapping';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  OrderSnapshotUnavailableError,
  orderFromReadySnapshot,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import type {
  FulfillmentWorkRoutePayloadV1,
  SyncJob,
  SyncJobHandler,
  SyncJobHandlerResult,
} from '@openlinker/core/sync';
import {
  JOB_ENQUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
  SyncJobExecutionError,
  type JobEnqueuePort,
  type SyncLockPort,
} from '@openlinker/core/sync';
import { getEnvBoolean } from '@openlinker/shared/config';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class FulfillmentWorkRouteHandler implements SyncJobHandler {
  private readonly logger = new Logger(FulfillmentWorkRouteHandler.name);

  constructor(
    @Inject(ROUTING_COMMIT_SERVICE_TOKEN)
    private readonly routingCommit: IRoutingCommitService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort,
    // #2408: the ONE seam shared with #2396's ingestion intercept. REQUIRED, so
    // a worker that lost its binding fails to boot rather than quietly routing
    // nothing — see the port's header.
    @Inject(FULFILLMENT_ROUTER_RESOLVER_TOKEN)
    private readonly routerResolver: FulfillmentRouterResolverPort,
    // #2955: this host's enqueue seam. NOT `SyncJobQueuePort` — no worker
    // handler injects that; the worker's fan-out port is `JobEnqueuePort`.
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.validatePayload(job);
    if (payload === null) {
      return { outcome: 'business_failure' };
    }

    const selection = selectPrimaryFulfillmentRouter(await this.loadClaimants());

    if (selection.holder === null) {
      // `no-claimant` is the pass-through. An ambiguity commits NOTHING and is
      // reported — silence-and-pick-one is forbidden, because an unrouted order
      // is recoverable by hand and two shipments of one order are not.
      const level = isFulfillmentRouterUnroutable(selection.reason) ? 'warn' : 'log';
      this.logger[level](
        `Not routing order ${payload.orderId}: reason=${selection.reason} ` +
          `candidates=[${selection.candidateConnectionIds.join(',')}]`
      );
      return { outcome: 'ok' };
    }

    const router = await this.routerResolver.resolve(selection.holder);
    if (router === null) {
      // The degenerate pass-through — see this file's header. Not an error.
      this.logger.log(
        `No fulfilment router is wired for connection ${selection.holder}; ` +
          `order ${payload.orderId} follows today's path unchanged (#2408/#2409).`
      );
      return { outcome: 'ok' };
    }

    const projection = await this.projectOrder(job, payload.orderId);

    const outcome = await this.routingCommit.route({
      orderId: payload.orderId,
      routerConnectionId: selection.holder,
      lines: projection.lines,
      shipTo: projection.shipTo,
      requestedDeliveryMethod: projection.requestedDeliveryMethod,
      router,
      // `SyncLockPort` satisfies the locally-declared `RoutingLockPort`
      // STRUCTURALLY, which is what lets the leaf keep its zero value edges
      // while still getting the real distributed lock.
      lock: this.lock,
      // A CALLBACK, re-read inside the lock. A boolean resolved here would be a
      // value from a moment that has already passed (REVIEW C10).
      isCancelled: async () => {
        const record = await this.orderRecords.getOrderRecord(payload.orderId);
        // `isCancelled` is the ENTITY's own pure derivation (ADR-011's allowed
        // shape), so the predicate has one definition rather than a second copy
        // here. It is a getter, not a method.
        return record?.isCancelled === true;
      },
    });

    await this.enqueueRoutedDispatchJobs(payload.orderId, outcome);

    return this.toJobResult(job, payload.orderId, outcome);
  }

  /**
   * Offer every routed work object to its holder (#2955).
   *
   * The same ONE derivation `OrderIngestionService` uses
   * (`deriveFulfillmentDispatchEnqueueIntents`), mapped onto this host's own
   * enqueue port — the two hosts reach DIFFERENT ports with incompatible request
   * shapes (`JobEnqueuePort.enqueueJob` here, `SyncJobQueuePort.enqueueBulk`
   * there), which is why the derivation returns a neutral intent rather than a
   * request. One decision, two mappings.
   *
   * **This branch is unreachable today, deliberately.** `fulfillment.work.route`
   * has no producer of its own, so nothing calls this handler in production.
   * Wiring it anyway is not oversight: the handler is registered and may gain a
   * producer, and a route handler that silently fails to dispatch is strictly
   * worse than an unexercised branch — the #2400 posture. Do not "clean this up"
   * as dead code without also giving `fulfillment.work.route` a producer.
   *
   * Never throws. A retry re-enters `route()`, which answers `already-routed`
   * and reaches no enqueue, so rethrowing would burn the retry ladder and still
   * dispatch nothing; the loud `error` log naming the work ids is the signal.
   */
  private async enqueueRoutedDispatchJobs(
    orderId: string,
    outcome: RoutingCommitOutcome
  ): Promise<void> {
    if (outcome.status !== 'routed') return;

    const unassigned = findUndispatchableWorkIds(outcome.works);
    if (unassigned.length > 0) {
      this.logger.warn(
        `Not dispatching fulfilment work with no assigned holder: ` +
          `orderId=${orderId} work=[${unassigned.join(',')}]`
      );
    }

    const intents = deriveFulfillmentDispatchEnqueueIntents(outcome.works, orderId);

    for (const intent of intents) {
      try {
        await this.jobEnqueue.enqueueJob({
          jobType: 'fulfillment.work.dispatch',
          connectionId: intent.connectionId,
          payload: {
            workId: intent.workId,
            orderId: intent.orderId,
            // Always `null`, and REQUIRED to be — `claimDispatchAttempt` bumps
            // the counter itself, so a pre-claim value would make this
            // producer's own retry refuse to resume.
            expectedAssignmentAttempt: null,
          },
          idempotencyKey: intent.dedupeKey,
        });
      } catch (error) {
        this.logger.error(
          `Failed to enqueue fulfilment dispatch job; the work is routed but was ` +
            `NOT offered to its holder: orderId=${orderId} workId=${intent.workId}`,
          error instanceof Error ? error.stack : undefined
        );
      }
    }
  }

  private toJobResult(
    job: SyncJob,
    orderId: string,
    outcome: RoutingCommitOutcome
  ): SyncJobHandlerResult {
    switch (outcome.status) {
      case 'routed':
        this.logger.log(
          `Routed order ${orderId}: decisionId=${outcome.decisionId} ` +
            `work=[${outcome.works.map((work) => work.workId).join(',')}]`
        );
        return { outcome: 'ok' };

      case 'skipped':
      case 'contended':
        // Both are the guard doing its job. Nothing was written and nothing is
        // wrong, so neither burns the retry ladder.
        this.logger.log(
          `Routing did not proceed for order ${orderId}: ` +
            `${outcome.status === 'skipped' ? outcome.reason : 'contended'}`
        );
        return { outcome: 'ok' };

      case 'refused':
        // Terminal: the router gave a deterministic answer that OpenLinker
        // refused, and the refusal is already durable on the decision row.
        this.logger.warn(
          `Routing plan refused for order ${orderId}: reason=${outcome.reason} ` +
            `decisionId=${outcome.decisionId}`
        );
        return { outcome: 'business_failure' };

      case 'in-doubt':
        // Retryable, and the retry RESUMES the still-live decision under the
        // identical key. Terminating here would strand the order behind a live
        // decision nothing would ever clear.
        throw new SyncJobExecutionError(
          `fulfillment.work.route is in doubt (${outcome.cause}) for order ${orderId}; ` +
            `decision ${outcome.decisionId} is left live for resumption`,
          job.id,
          job.jobType,
          job.connectionId
        );
    }
  }

  /**
   * Every connection, whatever its status.
   *
   * `isActive` is REPORTED, never filtered upstream — the `analytics-trust` trap.
   * `supportedCapabilities` is left empty deliberately: A2 is `config-only`, so
   * `declaresCapability` short-circuits without reading it, and resolving
   * adapter metadata per connection would be work whose result is discarded.
   */
  private async loadClaimants(): Promise<AuthorityClaimantInput[]> {
    const connections = await this.connections.list();
    return connections.map((connection) => ({
      connectionId: connection.id,
      isActive: connection.status === 'active',
      supportedCapabilities: [],
      enabledCapabilities: connection.enabledCapabilities,
      config: connection.config,
    }));
  }

  private async projectOrder(
    job: SyncJob,
    orderId: string
  ): Promise<{
    lines: RoutingInputLine[];
    shipTo: RoutingShipTo;
    requestedDeliveryMethod: string | null;
  }> {
    const record = await this.orderRecords.getOrderRecord(orderId);
    if (record === null) {
      throw this.retryable(job, `order record not found: orderId=${orderId}`);
    }

    let order;
    try {
      // `requireBuyer: false` — a routing projection names nobody, and the
      // default would make routing impossible on exactly the hash-only
      // deployments ADR-062's degraded arm exists to serve (#2399's precedent).
      order = orderFromReadySnapshot(record, { requireBuyer: false });
    } catch (error) {
      if (error instanceof OrderSnapshotUnavailableError) {
        // `awaiting_mapping` is a TIMING state, not a verdict.
        throw this.retryable(job, `order snapshot is not readable yet: orderId=${orderId}`, error);
      }
      throw error;
    }

    const shippingAddress = order.shippingAddress;
    if (shippingAddress === undefined) {
      throw this.retryable(job, `order carries no shipping address: orderId=${orderId}`);
    }

    const lines: RoutingInputLine[] = order.items.map((item) => ({
      orderLineId: item.id,
      // A work line needs a variant. `variantId` is optional on `OrderItem`, so
      // fall back to the product id rather than emitting a blank — a work object
      // pointing at no variant is unpickable stock nothing would report.
      productVariantId: item.variantId ?? item.productId,
      quantity: item.quantity,
    }));

    return {
      lines,
      // The OPAQUE key `RoutingInput.requestedDeliveryMethod` documents — the
      // source's own method id, never a neutral vocabulary. ADR-054 keeps
      // order-layer sourcing separate from the shipping layer's dispatch
      // resolution, which stays authoritative for label mechanics.
      requestedDeliveryMethod: order.shipping?.methodId ?? null,
      shipTo: buildRoutingShipTo(
        {
          countryIso2: shippingAddress.country,
          postalCode: shippingAddress.postalCode,
          city: shippingAddress.city,
          // #2395's own column, stamped at ingestion from the UN-redacted
          // address. Hashing the snapshot here instead would yield one hash per
          // country for the whole install — see `order-record.service.ts`.
          addressHash: record.shippingAddressHash,
        },
        {
          // `getEnvBoolean`, NOT `getPiiConfig()`: the latter throws when
          // `OL_PII_HASH_SALT` is unset regardless of the flag, which would break
          // routing on every ordinary deployment that never enabled hash-only
          // mode. `routing-ship-to.types.ts` states this requirement.
          storePii: getEnvBoolean('OL_STORE_PII', true),
        }
      ),
    };
  }

  private retryable(job: SyncJob, message: string, cause?: Error): SyncJobExecutionError {
    return new SyncJobExecutionError(
      `fulfillment.work.route: ${message}`,
      job.id,
      job.jobType,
      job.connectionId,
      cause
    );
  }

  private validatePayload(job: SyncJob): FulfillmentWorkRoutePayloadV1 | null {
    const payload = job.payload as Partial<FulfillmentWorkRoutePayloadV1> | undefined;
    const orderId = payload?.orderId;

    if (typeof orderId !== 'string' || orderId.length === 0) {
      // Terminal: a malformed payload fails identically on every attempt.
      this.logger.warn(
        `fulfillment.work.route received a malformed payload: jobId=${job.id} ` +
          `connectionId=${job.connectionId}`
      );
      return null;
    }

    return { schemaVersion: 1, orderId };
  }
}
