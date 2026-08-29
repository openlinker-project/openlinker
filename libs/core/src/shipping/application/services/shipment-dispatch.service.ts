/**
 * Shipment Dispatch Service
 *
 * Converges fulfillment dispatch onto the #832 routing model (#835): resolves
 * the processor for an order, and for a label-generating processor kind
 * (`ol_managed_carrier` / `source_brokered`) creates a `Shipment` and calls
 * `generateLabel` on the resolved connection's `ShippingProviderManagerPort`.
 *
 * This is the single dispatch entry point — it owns the `resolve()` call, so
 * there is no parallel routing mechanism by construction. It is unwired in
 * #835 (no trigger); the manual/auto call-site is #769/#771, exactly as #832
 * shipped `resolve()` without a live caller.
 *
 * `ol_managed_carrier` and `source_brokered` share one path: both implement
 * `ShippingProviderManagerPort` and the source-vs-distinct-connection topology
 * is enforced at rule-creation (#832 `assertCompatible`), not here. So #833's
 * Allegro Delivery adapter dispatches through this same code with zero changes
 * the day it declares the capability.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IShipmentDispatchService}
 */

import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import {
  type IFulfillmentRoutingService,
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
} from '@openlinker/core/mappings';
import {
  type IOrderRecordService,
  type PaymentStatus,
  type CodToCollect,
  type OrderRecord,
  PAYMENT_STATUS,
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderHoldService,
  ORDER_HOLD_SERVICE_TOKEN,
} from '@openlinker/core/orders';
import { type SyncLockPort, SYNC_LOCK_TOKEN } from '@openlinker/core/sync';

import type { IShipmentDispatchService } from '../interfaces/shipment-dispatch.service.interface';
import { IOrderFulfillmentProjectionService } from '../interfaces/order-fulfillment-projection.service.interface';
import type {
  ShipmentDispatchInput,
  ShipmentDispatchResult,
} from '../types/shipment-dispatch.types';
import type { Shipment } from '../../domain/entities/shipment.entity';
import {
  resolveCarrierMethod,
  deriveIntentFromLegacyMethod,
} from '../../domain/delivery-intent-resolution';
import { UndispatchableResolutionException } from '../../domain/exceptions/undispatchable-resolution.exception';
import { OrderNotDispatchablePaymentStatusException } from '../../domain/exceptions/order-not-dispatchable-payment-status.exception';
import { OrderNotDispatchableHeldException } from '../../domain/exceptions/order-not-dispatchable-held.exception';
import { ShippingProviderRejectionException } from '../../domain/exceptions/shipping-provider-rejection.exception';
import { ShipmentDispatchContendedException } from '../../domain/exceptions/shipment-dispatch-contended.exception';
import { ShipmentRepositoryPort } from '../../domain/ports/shipment-repository.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { isShipmentReferenceReconciler } from '../../domain/ports/capabilities/shipment-reference-reconciler.capability';
import { shipmentDispatchLockKey, SHIPMENT_DISPATCH_LOCK_TTL_MS } from './shipment-dispatch-lock';
import { SHIPMENT_STATUS } from '../../domain/types/shipment-status.types';
import type { ShippingMethod } from '../../domain/types/shipping-method.types';
import type { DeliveryIntent } from '../../domain/types/delivery-intent.types';
import { DISPATCH_BLOCKING_PAYMENT_STATUSES } from '../types/dispatch-payment-policy.types';
import {
  ORDER_FULFILLMENT_PROJECTION_SERVICE_TOKEN,
  SHIPMENT_REPOSITORY_TOKEN,
} from '../../shipping.tokens';

/** Capability the resolved processor connection must declare to issue a label. */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

/** Payment statuses that block dispatch (#938). Built once from the domain policy. */
const DISPATCH_BLOCKING: ReadonlySet<PaymentStatus> = new Set(DISPATCH_BLOCKING_PAYMENT_STATUSES);

@Injectable()
export class ShipmentDispatchService implements IShipmentDispatchService {
  private readonly logger = new Logger(ShipmentDispatchService.name);

  constructor(
    @Inject(SHIPMENT_REPOSITORY_TOKEN)
    private readonly shipments: ShipmentRepositoryPort,
    @Inject(FULFILLMENT_ROUTING_SERVICE_TOKEN)
    private readonly routing: IFulfillmentRoutingService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
    @Inject(ORDER_FULFILLMENT_PROJECTION_SERVICE_TOKEN)
    private readonly fulfillmentProjection: IOrderFulfillmentProjectionService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly dispatchLock: SyncLockPort,
    @Inject(ORDER_HOLD_SERVICE_TOKEN)
    private readonly orderHolds: IOrderHoldService,
  ) {}

  /**
   * Serialize dispatch per order (#1917), then run the dispatch itself.
   *
   * The lock closes the race the in-code note at `dispatchViaShippingProvider`
   * deferred to "the live call-site": `findActiveByOrderId` is a plain read, so
   * two concurrent dispatches can both pass it, and the loser then RESETS the
   * winner's just-created draft row (the partial-unique index forbids inserting
   * a second waybill-less row, so it reuses instead). Both then call
   * `generateLabel` with the same shipment id and the carrier mints two paid
   * labels under one reference.
   *
   * Contended behaviour mirrors `OrderSyncService.createOrderIdempotently`:
   * - **Lock held by a peer:** re-read the active shipment. If the peer already
   *   FINISHED, return its shipment - the caller pressed the button twice and
   *   gets the same answer either way. Otherwise the peer is mid-`generateLabel`
   *   with nothing to return yet, so raise the retryable contended exception
   *   rather than proceeding into the race we just prevented.
   * - **Lock acquired:** run the real dispatch; release in `finally`.
   *
   * The whole method is wrapped, including the branch-1 (`omp_fulfilled`) path
   * that generates no label. Two Redis round-trips on a no-op branch is the
   * price of one entry point with one invariant.
   */
  async dispatch(input: ShipmentDispatchInput): Promise<ShipmentDispatchResult> {
    const lockKey = shipmentDispatchLockKey(input.orderId);
    const token = await this.dispatchLock.acquire(lockKey, SHIPMENT_DISPATCH_LOCK_TTL_MS);

    if (!token) {
      // "Did the peer FINISH", not "does a row exist". The peer persists its
      // draft row BEFORE calling `generateLabel`, so for the whole multi-second
      // carrier round-trip a row exists for a label that does not. Handing that
      // draft back as `dispatched` would advertise a waybill the operator cannot
      // download; the retryable contended exception tells the truth instead.
      // `providerShipmentId` is the completion marker - it is written in the
      // same update that flips the row to `generated`, and a branch-1/omp
      // projection row never carries one, so such a row is never mistaken for a
      // finished label either.
      //
      // The re-read is connection-agnostic - as is the idempotency check in
      // `dispatchViaShippingProvider`, and as is the deliberate per-ORDER lock
      // key - so the caller can get back a shipment dispatched on a DIFFERENT
      // carrier connection than the one it asked for. Intended: at this grain
      // the answer is "this order is already shipping", not "your carrier is".
      const active = await this.shipments.findActiveByOrderId(input.orderId, 'outbound');
      if (active?.providerShipmentId) {
        this.logger.log(
          `Dispatch for order ${input.orderId} is contended; returning the shipment ` +
            `the concurrent dispatch already generated (${active.id} on connection ` +
            `${active.connectionId})`,
        );
        return { kind: 'dispatched', shipment: active };
      }
      this.logger.warn(
        `Dispatch for order ${input.orderId} is contended and no labelled shipment is ` +
          `persisted yet; refusing to race a concurrent label request`,
      );
      throw new ShipmentDispatchContendedException(input.orderId);
    }

    try {
      return await this.dispatchLocked(input);
    } finally {
      // Best-effort release — never let a release failure mask the dispatch
      // result (a label may already have been paid for at this point).
      try {
        await this.dispatchLock.release(lockKey, token);
      } catch (releaseError) {
        this.logger.warn(
          `Failed to release shipment-dispatch lock ${lockKey}: ` +
            `${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
        );
      }
    }
  }

  private async dispatchLocked(input: ShipmentDispatchInput): Promise<ShipmentDispatchResult> {
    const resolution = await this.routing.resolve({
      sourceConnectionId: input.sourceConnectionId,
      sourceDeliveryMethodId: input.sourceDeliveryMethodId,
    });

    // Payment-status gate (#938): server-side enforcement of the FE Generate-label
    // gate (#928) — the FE affordance is not authorization (frontend-architecture
    // § App Boundary), so the durable guarantee lives here. Runs after routing
    // resolve (routing errors take precedence) and before any processor branch,
    // mirroring the processor-kind-agnostic FE gate. A read failure here PROPAGATES
    // (fails closed) — it must never silently permit dispatch of an unpaid order.
    // Only an absent/unknown payment status permits (graceful degradation for
    // PrestaShop / legacy orders). NOTE: this precedes the per-order idempotency
    // check, so an order that was dispatched while `paid` and later goes
    // `refunded` is refused (422) on a repeat call rather than returning the
    // existing shipment — intended.
    const order = await this.orders.getOrderRecord(input.orderId);
    const paymentStatus = order?.paymentStatus;
    if (paymentStatus !== undefined && DISPATCH_BLOCKING.has(paymentStatus)) {
      // Audit signal: the FE already disables dispatch for blocked payment, so
      // reaching here means a direct API call (or a bug) bypassed that gate.
      this.logger.warn(
        `Blocked dispatch of order ${input.orderId}: payment status '${paymentStatus}'`,
      );
      throw new OrderNotDispatchablePaymentStatusException(input.orderId, paymentStatus);
    }

    // Hold gate (#2339, DESIGN §6.4): an order OL deliberately stopped must not
    // ship. Placed immediately after the payment gate so the two operator-facing
    // refusals sit together, and BEFORE any processor branch — an
    // `omp_fulfilled` order is held too; the difference is only who prints the
    // label.
    //
    // Reads `order_holds` through `IOrderHoldService`, never #2340's
    // denormalised projection column, for the same reason the provisioning gate
    // does: a cache that loses on drift must not be what decides whether a
    // parcel leaves the building.
    //
    // Fails CLOSED like the payment gate — a read failure propagates rather than
    // permitting a possibly-held dispatch. Terminal, never retryable (ADR-007):
    // releasing the hold is the only thing that changes the answer.
    //
    // Like the payment gate, this precedes the per-order idempotency check, so
    // an order held AFTER a successful dispatch is refused (422) on a repeat
    // call rather than handed back its existing shipment — intended, and the
    // same trade the #938 gate above already documents.
    const openHold = await this.orderHolds.getOpenHold(input.orderId);
    if (openHold) {
      this.logger.warn(
        `Blocked dispatch of order ${input.orderId}: on hold (${openHold.id}, ` +
          `reason '${openHold.reason}')`,
      );
      throw new OrderNotDispatchableHeldException(
        input.orderId,
        openHold.id,
        openHold.reason,
      );
    }

    switch (resolution.processorKind) {
      case FULFILLMENT_PROCESSOR_KIND.OmpFulfilled:
        // Branch-1: the OMP ships via its own carrier setup — OL generates no
        // label. Read-back is #834. Covers both the fan-out default (null
        // connection) and a configured omp_fulfilled rule (non-null connection).
        return { kind: 'omp_fulfilled' };

      case FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier:
      case FULFILLMENT_PROCESSOR_KIND.SourceBrokered: {
        // COD authorization gate (#1435): the FE is not authorization
        // (frontend-architecture § App Boundary), so COD is decided server-side
        // from the order's payment status — mirroring the #938 payment gate
        // above. Resolved only on the label-generating path, so an OMP-fulfilled
        // order never computes (and discards) a COD or logs a spurious strip.
        const cod = this.resolveEffectiveCod(order, input.cod, input.orderId);
        const shipment = await this.dispatchViaShippingProvider(
          input,
          resolution.processorConnectionId,
          cod,
        );
        return { kind: 'dispatched', shipment };
      }

      default: {
        // Exhaustiveness guard — a new processor kind must fail loud, not
        // silently skip dispatch (mirrors #832's assertCompatible).
        const exhaustive: never = resolution.processorKind;
        throw new UndispatchableResolutionException(
          `unknown processor kind: ${String(exhaustive)}`,
        );
      }
    }
  }

  /**
   * Resolve the provider-side delivery-method id the adapter sends, from the
   * source-side method — the **compatibility seam** ADR-012 keeps the OQ-B1
   * namespace question behind. v1 is identity: it assumes the order's
   * `delivery.method.id` is the value the source-brokered provider expects.
   * If a sandbox probe shows the namespaces diverge, only this body changes
   * (e.g. a co-keyed source→service mapping lookup, mirroring `CarrierMapping`)
   * — the adapter and routing model never reshape. Returns `undefined` for the
   * omp-fulfilled default (no source method); source-brokered adapters that
   * require the id throw a readable error when it is absent.
   */
  private resolveProviderDeliveryMethodId(input: ShipmentDispatchInput): string | undefined {
    return input.sourceDeliveryMethodId ?? undefined;
  }

  /**
   * Resolve the COD to actually apply at the carrier (#1435). COD is authorized
   * by the order's payment status, never blindly by the dispatch caller (FE
   * input is not authorization) — but the gate is a block-list on the one status
   * that must never carry COD, not an allow-list, so sources that don't report
   * payment (PrestaShop / WooCommerce / DPD / legacy) keep their operator-typed
   * COD:
   * - `paymentStatus === 'paid'` → strip COD, even if the caller passed one
   *   (prevents double-charging a prepaid order via a crafted API call).
   * - `paymentStatus === 'cod'` → prefer the marketplace-sourced `codToCollect`;
   *   fall back to the caller-supplied amount when the source didn't provide one
   *   (legacy / non-Allegro COD).
   * - otherwise (`undefined` / unrecognised, or no order record) → pass the
   *   caller amount through unchanged. Non-marketplace sources don't express
   *   payment status, so operator-supplied COD (#966) stays authoritative here.
   *   (`awaiting` / `refunded` never reach this point — the #938 gate blocks
   *   dispatch entirely for them.)
   */
  private resolveEffectiveCod(
    order: OrderRecord | null,
    inputCod: CodToCollect | undefined,
    orderId: string,
  ): CodToCollect | undefined {
    const paymentStatus = order?.paymentStatus;
    if (paymentStatus === PAYMENT_STATUS.Paid) {
      if (inputCod !== undefined) {
        this.logger.warn(
          `Stripping COD from dispatch of order ${orderId}: ` +
            `order is prepaid (payment status 'paid')`,
        );
      }
      return undefined;
    }
    if (paymentStatus === PAYMENT_STATUS.Cod) {
      const resolved = order?.codToCollect ?? inputCod;
      if (resolved === undefined) {
        // Likely operator mistake: a COD order is being dispatched with no
        // amount from either the marketplace source or the caller, so it would
        // ship COD with nothing to collect. Surface it; the value is unchanged.
        this.logger.warn(
          `COD order ${orderId} resolved to no COD amount ` +
            `(no marketplace-sourced amount and no caller-supplied amount): ` +
            `it will ship without a collectable amount`,
        );
      }
      return resolved;
    }
    // Unknown / unreported payment (non-marketplace sources) — preserve the
    // caller-supplied COD (the pre-#1435 behavior for PrestaShop / DPD).
    return inputCod;
  }

  private async dispatchViaShippingProvider(
    input: ShipmentDispatchInput,
    processorConnectionId: string | null,
    cod: CodToCollect | undefined,
  ): Promise<Shipment> {
    if (!processorConnectionId) {
      // A label-generating rule always carries a processor connection (it can't
      // pass #832's compatibility gate otherwise). Defensive — unreachable.
      throw new UndispatchableResolutionException(
        'a label-generating processor resolved without a connection id',
      );
    }

    // Idempotency: don't issue a second label/fee while a non-terminal shipment
    // for this order is in flight. The cancel + re-issue flow flips the prior
    // row to `cancelled` first, so a genuine re-dispatch is still allowed.
    // This find→create is still not atomic on its own, but `dispatch()` now
    // holds a per-order lock around the whole path (#1917), so the concurrent
    // window it used to leave open is closed by construction.
    const active = await this.shipments.findActiveByOrderId(input.orderId, 'outbound');
    if (active) {
      return active;
    }

    const adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
      processorConnectionId,
      SHIPPING_PROVIDER_MANAGER_CAPABILITY,
    );

    // Resolve the carrier-neutral delivery intent to this carrier's concrete
    // method (#979, ADR-020). The seam reads the adapter's published
    // `getSupportedMethods()`; the adapter's `generateLabel` branching is
    // unchanged. Legacy callers may still send a concrete `shippingMethod` for
    // one release — derive the intent from it as a fallback.
    const intent =
      input.deliveryIntent ??
      (input.shippingMethod !== undefined
        ? deriveIntentFromLegacyMethod(input.shippingMethod)
        : undefined);
    if (intent === undefined) {
      throw new UndispatchableResolutionException(
        'a deliveryIntent (or a legacy shippingMethod) is required to dispatch a label',
      );
    }
    const shippingMethod = resolveCarrierMethod(intent, adapter.getSupportedMethods());
    if (shippingMethod === null) {
      throw new UndispatchableResolutionException(
        `the resolved carrier cannot fulfil delivery intent '${intent}'`,
      );
    }
    if (input.shippingMethod !== undefined && input.shippingMethod !== shippingMethod) {
      this.logger.log(
        `Resolved deliveryIntent '${intent}' to shippingMethod '${shippingMethod}' for connection ${processorConnectionId}`,
      );
    }

    // A prior dispatch that failed BEFORE a waybill was minted leaves a
    // terminal `(orderId, connectionId)` row with `providerShipmentId = NULL`.
    // The partial-unique `UQ_shipments_branch_one_per_order_conn` index forbids
    // inserting a second waybill-less row, so a plain `create()` would throw a
    // duplicate-key error and wedge every retry (the `findActiveByOrderId` guard
    // above is status-based and waves terminal `failed` rows through). Reset and
    // reuse that row instead — the active guard already returned for any
    // still-in-flight attempt, so anything found here is terminal and safe to
    // recycle for this fresh attempt.
    // Outbound only (#2373). Return-label dispatch is a separate cohort and a
    // separate row under the widened branch-1 index; it must never reset or
    // reuse an outbound attempt's row.
    const priorBranchOne = await this.shipments.findBranchOneByOrderAndConnection(
      input.orderId,
      processorConnectionId,
      'outbound',
    );

    // How this attempt's label-shaping parameters compare with the ones the
    // PRIOR attempt was made under. Captured here because the reset below
    // overwrites them with this attempt's values, after which the row can no
    // longer tell you what the lost label was minted for.
    const divergedParameters = priorBranchOne
      ? this.describeParameterDivergence(
          priorBranchOne,
          shippingMethod,
          intent,
          input.paczkomatId ?? null,
          input.sourceDeliveryMethodId ?? null,
        )
      : [];

    const shipment = priorBranchOne
      ? await this.shipments.update(priorBranchOne.id, {
          status: SHIPMENT_STATUS.Draft,
          shippingMethod,
          deliveryIntent: intent,
          paczkomatId: input.paczkomatId ?? null,
          sourceDeliveryMethodId: input.sourceDeliveryMethodId ?? null,
          failedAt: null,
          errorMessage: null,
        })
      : await this.shipments.create({
          orderId: input.orderId,
          connectionId: processorConnectionId,
          shippingMethod,
          deliveryIntent: intent,
          paczkomatId: input.paczkomatId,
          sourceDeliveryMethodId: input.sourceDeliveryMethodId ?? undefined,
        });

    // Lost-response recovery (#1917). A prior attempt may have committed at the
    // carrier and had its response lost (timeout / socket reset / 5xx after
    // commit) — the catch below persists `failed` with `providerShipmentId`
    // still NULL, so OL holds no id for a label that exists and was paid for.
    // Before creating anything, ask the carrier whether it already holds a
    // shipment under this reference and adopt it if so. Retry path only: on a
    // first dispatch the reference has never been sent, so the lookup is
    // guaranteed-empty and would only add latency.
    //
    // Skipped when this retry asks for DIFFERENT label parameters than the lost
    // attempt used: the operator deliberately wants something else (another
    // locker, another delivery intent), so a fresh label is the correct answer
    // and adopting the old one would make the row lie about what was paid for.
    // The orphan is then a separate reconciliation problem, logged loudly.
    if (priorBranchOne) {
      if (divergedParameters.length > 0) {
        this.logger.warn(
          `Skipping the carrier reference lookup for shipment ${shipment.id} ` +
            `(order ${input.orderId}): this retry changed ${divergedParameters.join('; ')}, so a ` +
            `label already minted under the previous parameters must not be adopted. If the ` +
            `prior attempt did commit at the carrier it is now an orphan needing manual ` +
            `cancellation.`,
        );
      } else {
        const adopted = await this.adoptExistingCarrierShipment(shipment.id, adapter, input.orderId);
        if (adopted) {
          return adopted;
        }
      }
    }

    try {
      const result = await adapter.generateLabel({
        shipmentId: shipment.id,
        connectionId: processorConnectionId,
        orderId: input.orderId,
        shippingMethod,
        paczkomatId: input.paczkomatId,
        deliveryMethodId: this.resolveProviderDeliveryMethodId(input),
        recipient: input.recipient,
        parcel: input.parcel,
        // Declared-value / insurance (#1542) — caller-supplied pass-through,
        // not order-sourced (unlike COD below). Insurance-incapable adapters
        // ignore it; insurance-capable ones (InPost ShipX) translate it.
        insuredValue: input.insuredValue,
        // Payment-status-authorized COD (#1435): stripped for non-COD orders,
        // sourced from the order when available, caller amount only as fallback.
        // COD-incapable adapters ignore it; COD-capable ones translate it.
        cod,
      });

      const generated = await this.shipments.update(shipment.id, {
        status: SHIPMENT_STATUS.Generated,
        providerShipmentId: result.providerShipmentId,
        // Some providers issue tracking asynchronously; leave null when absent.
        trackingNumber: result.trackingNumber ?? undefined,
        labelPdfRef: result.labelPdfRef,
      });
      // Project the order's fulfillment rollup (#1108) — best-effort, never throws.
      await this.fulfillmentProjection.recompute(input.orderId);
      return generated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Surface the carrier's structured rejection (code + field errors) in the
      // log — the top-level message alone is often a generic "validation error"
      // that hides which field the provider rejected (#1428).
      const rejectionDetail =
        error instanceof ShippingProviderRejectionException
          ? ` [provider=${error.providerName} code=${error.providerCode ?? 'null'} details=${JSON.stringify(
              error.providerDetails ?? null,
            )}]`
          : '';
      this.logger.warn(
        `generateLabel failed for shipment ${shipment.id} (order ${input.orderId}): ${message}${rejectionDetail}`,
      );
      // Persist the visible failure (surfaces in /shipments + enables retry),
      // then propagate the domain error so the caller can render it. The
      // structured `providerCode` (#1918) is persisted alongside the
      // free-text message so triage grouping can key on it instead of
      // fuzzy-matching prose.
      await this.shipments.update(shipment.id, {
        status: SHIPMENT_STATUS.Failed,
        failedAt: new Date(),
        errorMessage: message,
        providerCode:
          error instanceof ShippingProviderRejectionException ? error.providerCode : null,
      });
      // Reflect the failed shipment in the order rollup (#1108) before surfacing.
      await this.fulfillmentProjection.recompute(input.orderId);
      throw error;
    }
  }

  /**
   * Describe how a retry's label-shaping parameters differ from the ones the
   * prior (possibly carrier-committed) attempt on the same row was made under.
   * Returns `[]` when they agree, so adoption is safe.
   *
   * Only the parameters the row PERSISTS can be compared - the recipient,
   * parcel dimensions, COD and insured value are not on the row, so parameter
   * identity is established best-effort. That is the right side to err on: a
   * false "diverged" only costs the recovery (falling back to today's create
   * path), while a false "identical" would mis-describe a paid label.
   *
   * `deliveryIntent` and `sourceDeliveryMethodId` are nullable columns added
   * after the first shipping release, so a NULL on the prior row means "not
   * recorded", not "different", and is not treated as divergence. Nothing
   * material is lost: an intent change resolves into a different
   * `shippingMethod`, which is compared strictly.
   */
  private describeParameterDivergence(
    prior: Shipment,
    shippingMethod: ShippingMethod,
    intent: DeliveryIntent,
    paczkomatId: string | null,
    sourceDeliveryMethodId: string | null,
  ): string[] {
    const diverged: string[] = [];
    if (prior.shippingMethod !== shippingMethod) {
      diverged.push(`shippingMethod '${prior.shippingMethod}' -> '${shippingMethod}'`);
    }
    if (prior.paczkomatId !== paczkomatId) {
      diverged.push(`paczkomatId '${prior.paczkomatId ?? 'null'}' -> '${paczkomatId ?? 'null'}'`);
    }
    if (prior.deliveryIntent !== null && prior.deliveryIntent !== intent) {
      diverged.push(`deliveryIntent '${prior.deliveryIntent}' -> '${intent}'`);
    }
    if (
      prior.sourceDeliveryMethodId !== null &&
      prior.sourceDeliveryMethodId !== sourceDeliveryMethodId
    ) {
      diverged.push(
        `sourceDeliveryMethodId '${prior.sourceDeliveryMethodId}' -> ` +
          `'${sourceDeliveryMethodId ?? 'null'}'`,
      );
    }
    return diverged;
  }

  /**
   * Adopt a carrier shipment that already exists under this shipment's
   * reference, instead of creating a second one (#1917).
   *
   * Returns the healed `Shipment` when a single unambiguous match was adopted,
   * or `null` to tell the caller to proceed with a normal `generateLabel`.
   *
   * Deliberately NON-FATAL: an adapter that cannot answer, a carrier that 404s
   * an endpoint, an auth blip — none of these should block a dispatch the
   * operator explicitly asked for. Every failure degrades to the pre-#1917
   * create path, which is exactly today's behaviour, so this can only improve
   * on the status quo and never regress it.
   */
  private async adoptExistingCarrierShipment(
    shipmentId: string,
    adapter: ShippingProviderManagerPort,
    orderId: string,
  ): Promise<Shipment | null> {
    if (!isShipmentReferenceReconciler(adapter)) {
      return null;
    }

    let existing: Awaited<ReturnType<typeof adapter.findShipmentByReference>>;
    try {
      existing = await adapter.findShipmentByReference({ reference: shipmentId });
    } catch (error) {
      this.logger.warn(
        `Reference lookup failed for shipment ${shipmentId} (order ${orderId}); ` +
          `proceeding with a fresh label request: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    if (!existing) {
      return null;
    }

    this.logger.log(
      `Adopting carrier shipment ${existing.providerShipmentId} for ${shipmentId} ` +
        `(order ${orderId}): a prior attempt committed at the carrier but lost its response, ` +
        `so no second label is created`,
    );

    // `labelPdfRef` stays null — adoption recovers identity and trackability,
    // not the document. The operator re-fetches it through the existing
    // LabelDocumentReader path, which is keyed on `providerShipmentId` and
    // works as soon as that id is known.
    //
    // The carrier fee is likewise not recovered — but nothing under-reports
    // today, because `Shipment` carries no cost column at all (a generated row
    // records no fee either). If one is ever added, the adopted row must read it
    // back from the carrier here; the neutral `ReconciledShipment` shape would
    // need to carry it.
    const adopted = await this.shipments.update(shipmentId, {
      status: SHIPMENT_STATUS.Generated,
      providerShipmentId: existing.providerShipmentId,
      trackingNumber: existing.trackingNumber ?? undefined,
    });
    await this.fulfillmentProjection.recompute(orderId);
    return adopted;
  }
}
