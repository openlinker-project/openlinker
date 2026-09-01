/**
 * Fulfillment Work Dispatch Handler (#2399, `W3a-10`, ADR-054, DESIGN §5.4)
 *
 * Handles `fulfillment.work.dispatch` — offer a routed `FulfillmentWork` to its
 * assigned holder under a retry-stable idempotency key.
 *
 * ## This handler exists BECAUSE core may not resolve the adapter
 *
 * `fulfillment` is a registered zero-sibling-edge leaf, so
 * `FulfillmentHandshakeService` may not inject `IIntegrationsService` (a VALUE
 * import from a sibling context) nor any `orders` service (ADR-053's
 * no-injection invariant). Both therefore resolve HERE, in the host that already
 * composes them, and cross into core as arguments. That is ADR-053's own rule —
 * "order data enters as arguments" — applied to a second kind of dependency, not
 * a way around it.
 *
 * The consequence is that this handler assembles the dispatch: work → holder →
 * executor → order → ship-to. #2406/#2410's operator actions will need the same
 * chain in `apps/api`; the intended landing spot for the second caller is a
 * shared host-side helper rather than a copy of this method.
 *
 * ## Outcome contract (ADR-007)
 *
 * | Result | Outcome |
 * |---|---|
 * | holder accepted | `ok` |
 * | holder REJECTED | `business_failure` — a deterministic business answer; retrying burns the ladder to no effect and the refusal is already durable |
 * | no-op (already accepted, terminal, or an attempt this job was not enqueued for) | `ok` |
 * | work has no holder | **throws** (retryable) — see below |
 * | executor capability unresolvable | **throws** (retryable) — a disabled connection or a credential failure is transient |
 *
 * **Unassigned work throws rather than terminating**, and that asymmetry is
 * deliberate. `business_failure` is terminal, and this slice does not own the
 * enqueue: if #2395's router enqueues before `assignHolder` commits, or from a
 * different transaction, a terminal answer would dead-end permanently on work
 * that becomes assignable a moment later. The retry ladder absorbs that race.
 *
 * PII: the ship-to projection is `RoutingShipTo`, ADR-062's allowlist — country,
 * postcode, city, or a hash under `OL_STORE_PII=false`. Failure logs name ids
 * only, never the projection.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';

import {
  FULFILLMENT_HANDSHAKE_SERVICE_TOKEN,
  FulfillmentWorkUnassignedError,
  buildRoutingShipTo,
  type FulfillmentExecutorPort,
  type IFulfillmentHandshakeService,
  type RoutingShipTo,
} from '@openlinker/core/fulfillment';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  OrderSnapshotUnavailableError,
  orderFromReadySnapshot,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import type {
  FulfillmentWorkDispatchPayloadV1,
  SyncJob,
  SyncJobHandler,
  SyncJobHandlerResult,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { getEnvBoolean } from '@openlinker/shared/config';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class FulfillmentWorkDispatchHandler implements SyncJobHandler {
  private readonly logger = new Logger(FulfillmentWorkDispatchHandler.name);

  constructor(
    @Inject(FULFILLMENT_HANDSHAKE_SERVICE_TOKEN)
    private readonly handshake: IFulfillmentHandshakeService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.validatePayload(job);
    if (payload === null) return { outcome: 'business_failure' };

    const shipTo = await this.resolveShipTo(job, payload);
    const executor = await this.resolveExecutor(job);

    try {
      const result = await this.handshake.dispatch({
        workId: payload.workId,
        expectedAssignmentAttempt: payload.expectedAssignmentAttempt,
        shipTo,
        executor,
      });

      if (result.outcome === 'rejected') {
        this.logger.warn(
          `fulfillment.work.dispatch rejected: workId=${payload.workId} ` +
            `connectionId=${job.connectionId} reason=${result.rejectionReason ?? 'unknown'} ` +
            `blocking=${String(result.blocking)}`
        );
        // Terminal: the holder gave a deterministic business answer and it is
        // already recorded durably. Re-asking would re-cross the executor
        // boundary to be told the same thing.
        return { outcome: 'business_failure' };
      }

      return { outcome: 'ok' };
    } catch (error) {
      if (error instanceof FulfillmentWorkUnassignedError) {
        // Retryable by design — see this file's header.
        throw new SyncJobExecutionError(
          `fulfillment.work.dispatch has no holder yet: workId=${payload.workId}`,
          job.id,
          job.jobType,
          job.connectionId,
          error
        );
      }
      throw error;
    }
  }

  /**
   * The ship-to projection.
   *
   * `payload.orderId` is used ONLY to load the order for this projection — it is
   * never the authority on which order the work belongs to. The request the
   * executor receives carries `work.orderId`, read from the row inside the
   * handshake service, so a stale or wrong payload value cannot mislabel the
   * dispatch; at worst it produces the wrong ship-to, which the guard below
   * turns into a retryable failure rather than a silent mis-ship.
   */
  private async resolveShipTo(
    job: SyncJob,
    payload: FulfillmentWorkDispatchPayloadV1
  ): Promise<RoutingShipTo> {
    const record = await this.orderRecords.getOrderRecord(payload.orderId);
    if (record === null) {
      throw this.retryable(job, `order record not found: orderId=${payload.orderId}`);
    }

    let shippingAddress;
    try {
      // `requireBuyer: false` is deliberate and load-bearing. The default
      // (`true`) refuses a snapshot whose BUYER IDENTITY is redacted, which is
      // the invoicing contract — a fiscal document must name a buyer. A ship-to
      // projection names nobody: `RoutingShipTo` carries country, postcode and
      // city, and `ROUTING_SHIP_TO_FORBIDDEN_KEYS` bans every identity field.
      // Leaving the default on would make routing impossible on exactly the
      // hash-only deployments ADR-062's degraded arm exists to serve.
      shippingAddress = orderFromReadySnapshot(record, { requireBuyer: false }).shippingAddress;
    } catch (error) {
      if (error instanceof OrderSnapshotUnavailableError) {
        // An `awaiting_mapping` record is a TIMING state, not a verdict — the
        // snapshot holds a raw incoming order and becomes readable once
        // resolution lands. Retryable for the same reason unassigned work is.
        throw this.retryable(
          job,
          `order snapshot is not readable yet: orderId=${payload.orderId}`,
          error
        );
      }
      throw error;
    }

    if (shippingAddress === undefined) {
      // Refusing to send is the safe direction. An executor handed no
      // destination would either reject the request or — worse — accept it and
      // ship to somewhere decided by its own defaults.
      throw this.retryable(
        job,
        `order carries no shipping address: orderId=${payload.orderId} workId=${payload.workId}`
      );
    }

    return buildRoutingShipTo(
      {
        countryIso2: shippingAddress.country,
        postalCode: shippingAddress.postalCode,
        city: shippingAddress.city,
        // Honestly `null`, not fabricated. The hash the degraded arm wants is
        // `customer_address_projections.addressHash`, and NO read surface
        // exposes it today — `routing-ship-to.types.ts` says so and names #2395
        // as the slice that must add one. Hashing the snapshot's address here
        // instead would be worse than `null`: under `OL_STORE_PII=false` that
        // address has already been through `redactAddress`, so it yields ONE
        // hash per country shared by every order in the install — a plausible
        // 64-hex string that groups everything and preserves nothing.
        addressHash: null,
      },
      {
        // `getEnvBoolean`, NOT `getPiiConfig()`. The latter throws
        // `PiiConfigurationError` when `OL_PII_HASH_SALT` is unset REGARDLESS of
        // the flag's value, so reading the flag through it would break dispatch
        // on every ordinary deployment that never enabled hash-only mode.
        // `routing-ship-to.types.ts` states this requirement explicitly; the
        // precedent with its own rationale is `order-ingestion.service.ts`.
        storePii: getEnvBoolean('OL_STORE_PII', true),
      }
    );
  }

  /**
   * A retryable failure that names ids only — never the ship-to projection.
   */
  private retryable(job: SyncJob, message: string, cause?: Error): SyncJobExecutionError {
    return new SyncJobExecutionError(
      `fulfillment.work.dispatch: ${message}`,
      job.id,
      job.jobType,
      job.connectionId,
      cause
    );
  }

  private async resolveExecutor(job: SyncJob): Promise<FulfillmentExecutorPort> {
    try {
      return await this.integrations.getCapabilityAdapter<FulfillmentExecutorPort>(
        job.connectionId,
        'FulfillmentExecutor'
      );
    } catch (error) {
      // A disabled connection, a missing capability or a credential failure.
      // Retryable: none of them is a statement about the WORK, and an operator
      // re-enabling the connection makes the same job succeed unchanged.
      throw new SyncJobExecutionError(
        `fulfillment.work.dispatch could not resolve a FulfillmentExecutor: connectionId=${job.connectionId}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    }
  }

  private validatePayload(job: SyncJob): FulfillmentWorkDispatchPayloadV1 | null {
    const payload = job.payload as Partial<FulfillmentWorkDispatchPayloadV1> | undefined;
    const workId = payload?.workId;
    const orderId = (payload as { orderId?: unknown } | undefined)?.orderId;
    const attempt = payload?.expectedAssignmentAttempt;

    const attemptValid =
      attempt === null ||
      attempt === undefined ||
      (typeof attempt === 'number' && Number.isInteger(attempt) && attempt >= 0);

    if (
      typeof workId !== 'string' ||
      workId.length === 0 ||
      typeof orderId !== 'string' ||
      orderId.length === 0 ||
      !attemptValid
    ) {
      // Terminal: a malformed payload throws identically on every attempt.
      this.logger.warn(
        `fulfillment.work.dispatch received a malformed payload: jobId=${job.id} connectionId=${job.connectionId}`
      );
      return null;
    }

    return {
      workId,
      orderId,
      expectedAssignmentAttempt: attempt ?? null,
    } as FulfillmentWorkDispatchPayloadV1;
  }
}
