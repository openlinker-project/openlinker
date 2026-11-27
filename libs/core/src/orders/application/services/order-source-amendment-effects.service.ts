/**
 * Order Source Amendment Effects Service (#3961)
 *
 * See the interface and `planSourceAmendment`. In short: when the order source
 * changes a line of a routed order, lower the packing work, the reservation and
 * the master stock to the new quantity if nobody has packed past it yet;
 * otherwise hold the box and raise `source-change-unapplied`.
 *
 * It reuses the operator-edit machinery (#3542) rather than a second path, and
 * takes the same per-order lock (`orderEditLockKey`), so an operator edit and a
 * source change can never narrow the same work concurrently.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderSourceAmendmentEffectsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  FULFILLMENT_ORDER_EDIT_SERVICE_TOKEN,
  type ClosedParcelReport,
  type IFulfillmentOrderEditService,
  type OrderWorkEditAssessment,
} from '@openlinker/core/fulfillment';
import {
  CONNECTION_PORT_TOKEN,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  resolveRequiresCredentials,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  INVENTORY_SALE_REVERSAL_SERVICE_TOKEN,
  RESERVATION_SERVICE_TOKEN,
  type IInventorySaleReversalService,
  type IReservationService,
} from '@openlinker/core/inventory';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import type { ComponentLineRef } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

import type { OrderRecord } from '../../domain/entities/order-record.entity';
import { orderEditLockKey } from '../../domain/types/order-edits.types';
import {
  planSourceAmendment,
  sourceChangeAcceptTargetRef,
  type SourceAmendmentLine,
  type SourceAmendmentPlan,
} from '../../domain/types/source-amendment-plan.types';
import { ORDER_CHANGE_SERVICE_TOKEN, ORDER_RECORD_SERVICE_TOKEN } from '../../orders.tokens';
import type {
  AcceptSourceChangeInput,
  IOrderSourceAmendmentEffectsService,
  ReconcileSourceAmendmentInput,
  SourceAmendmentReconcileResult,
} from '../interfaces/order-source-amendment-effects.service.interface';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { IOrderChangeService } from './order-change.service.interface';

/** Long enough for a few work writes and master calls; short enough not to wedge an operator edit. */
const SOURCE_AMENDMENT_LOCK_TTL_MS = 30_000;

/** Stored on the hold; the bench shows held boxes and the order page names the cause. */

const PRODUCER = 'source-amendment';
const ACCEPT_KIND = 'order.source_change_accept';

const NOTHING: SourceAmendmentReconcileResult = { outcome: 'nothing-to-do', lines: [], cause: null, closedParcels: [] };

@Injectable()
export class OrderSourceAmendmentEffectsService implements IOrderSourceAmendmentEffectsService {
  private readonly logger = new Logger(OrderSourceAmendmentEffectsService.name);

  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(FULFILLMENT_ORDER_EDIT_SERVICE_TOKEN)
    private readonly fulfillmentEdit: IFulfillmentOrderEditService,
    @Inject(RESERVATION_SERVICE_TOKEN)
    private readonly reservations: IReservationService,
    @Inject(INVENTORY_SALE_REVERSAL_SERVICE_TOKEN)
    private readonly saleReversal: IInventorySaleReversalService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(ORDER_CHANGE_SERVICE_TOKEN)
    private readonly changes: IOrderChangeService
  ) {}

  async reconcile(input: ReconcileSourceAmendmentInput): Promise<SourceAmendmentReconcileResult> {
    return this.withLock(input.internalOrderId, async () => {
      const loaded = await this.load(input.internalOrderId);
      if (loaded === null) return NOTHING;
      return this.act(input.internalOrderId, loaded.record, loaded.plan);
    });
  }

  async accept(input: AcceptSourceChangeInput): Promise<SourceAmendmentReconcileResult> {
    return this.withLock(input.internalOrderId, async () => {
      const loaded = await this.load(input.internalOrderId);
      if (loaded === null) return NOTHING;
      const { record, plan } = loaded;
      if (plan.kind !== 'hold' && plan.kind !== 'shipped') {
        // Nothing to accept: the order agrees with its work, or the change can
        // simply be applied. `act` settles or applies it.
        return this.act(input.internalOrderId, record, plan);
      }
      const opened = await this.changes.openOrReuse({
        internalOrderId: input.internalOrderId,
        kind: ACCEPT_KIND,
        targetRef: sourceChangeAcceptTargetRef(plan.lines),
        payload: { lines: plan.lines.map((line) => ({ ...line })) },
        requestedBy: input.actorUserId,
        requestedAt: new Date(),
      });
      await this.changes.confirm(opened.change.id, input.actorUserId);
      await this.release(input.internalOrderId);
      this.logger.log(
        `source_change_accepted order=${input.internalOrderId} lines=${describeLines(plan.lines)}`
      );
      return { outcome: 'accepted', lines: plan.lines, cause: null, closedParcels: [] };
    });
  }

  /** Every entry point runs under the order's edit lock and never throws. */
  private async withLock(
    orderId: string,
    work: () => Promise<SourceAmendmentReconcileResult>
  ): Promise<SourceAmendmentReconcileResult> {
    const key = orderEditLockKey(orderId);
    let token: Awaited<ReturnType<SyncLockPort['acquire']>>;
    try {
      token = await this.lock.acquire(key, SOURCE_AMENDMENT_LOCK_TTL_MS);
    } catch (error) {
      this.logger.warn(`source_amendment_lock_failed order=${orderId}: ${describe(error)}`);
      return { outcome: 'contended', lines: [], cause: null, closedParcels: [] };
    }
    if (token === null) {
      // An operator edit (or a parallel ingestion) holds the order. Its own
      // follow-ups are idempotent toward the same targets, and the next
      // ingestion compares state again, so skipping is safe.
      return { outcome: 'contended', lines: [], cause: null, closedParcels: [] };
    }
    try {
      return await work();
    } catch (error) {
      this.logger.error(
        `source_amendment_reconcile_failed order=${orderId}: ${describe(error)}`,
        error instanceof Error ? error.stack : undefined
      );
      return { outcome: 'failed', lines: [], cause: null, closedParcels: [] };
    } finally {
      await this.lock.release(key, token).catch((error: unknown) => {
        // Not fatal - the lock expires on its own TTL - but until it does the
        // next ingestion or "Check again" answers `contended`, so say why.
        this.logger.warn(`source_amendment_lock_release_failed order=${orderId}: ${describe(error)}`);
      });
    }
  }

  /**
   * Read the record fresh and plan. `null` when there is nothing this service
   * may compare: no record, a cancelled order (the cancellation path owns it),
   * an order whose items never resolved, or a snapshot with no readable lines.
   * The last one matters: `orderItems` answers `[]` for "unreadable", and
   * reading that as "every line lowered to 0" would empty the box.
   */
  private async load(
    orderId: string
  ): Promise<{ record: OrderRecord; plan: SourceAmendmentPlan } | null> {
    const record = await this.orderRecords.getOrderRecord(orderId);
    if (record === null || record.cancelledAt !== null || record.recordStatus !== 'ready') {
      return null;
    }
    const items = record.orderItems;
    if (items.length === 0) return null;

    // A bundle line's work sits on its component lines; the assessment folds
    // them back so every figure below is per commercial line.
    const assessment = await this.fulfillmentEdit.assessForEdit(orderId, bundleComponents(record));
    const plan = planSourceAmendment({
      effectiveByLine: effectiveQuantities(items),
      requiredByLine: assessment.requiredByLine,
      verifiedByLine: assessment.verifiedByLine,
      fulfilledByLine: assessment.fulfilledByLine,
      increasedLineIds: increasedLines(record),
      unrouted: assessment.unrouted,
      boxClosed: assessment.anyParcelClosed || record.packedAt !== null,
      shipped: record.fulfillmentState === 'dispatched' || record.fulfillmentState === 'delivered',
      outsideHolder: await this.hasOutsideHolder(assessment),
    });
    return { record, plan };
  }

  private async act(
    orderId: string,
    record: OrderRecord,
    plan: SourceAmendmentPlan
  ): Promise<SourceAmendmentReconcileResult> {
    switch (plan.kind) {
      case 'in-sync':
        if (hasUnfinishedApply(record)) return this.finishEarlierApply(orderId, record);
        await this.settle(orderId, record);
        return NOTHING;

      case 'no-work':
        await this.settle(orderId, record);
        return NOTHING;

      case 'shipped':
        if (await this.isAccepted(orderId, plan.lines)) return this.accepted(orderId, record, plan.lines);
        // Nothing can be taken back out of a parcel that left. No hold: there is
        // no box left to stop.
        await this.markAttention(orderId, 'shipped');
        this.logger.warn(
          `source_change_after_shipping order=${orderId} lines=${describeLines(plan.lines)}`
        );
        return { outcome: 'shipped', lines: plan.lines, cause: null, closedParcels: [] };

      case 'hold':
        if (await this.isAccepted(orderId, plan.lines)) return this.accepted(orderId, record, plan.lines);
        await this.fulfillmentEdit.holdForSourceChange({ orderId });
        await this.markAttention(orderId, plan.cause);
        this.logger.warn(
          `source_change_held order=${orderId} cause=${plan.cause} lines=${describeLines(plan.lines)}`
        );
        return { outcome: 'held', lines: plan.lines, cause: plan.cause, closedParcels: [] };

      case 'apply':
        return this.apply(orderId, record, plan.lines);
    }
  }

  /**
   * Lower the work, then the reservation, then give back the master stock - the
   * operator edit's order (#3542). Every step is toward an absolute target, so a
   * crash part-way is finished by the next ingestion rather than doubled.
   */
  private async apply(
    orderId: string,
    record: OrderRecord,
    lines: readonly SourceAmendmentLine[]
  ): Promise<SourceAmendmentReconcileResult> {
    let failed = false;
    const closedParcels: ClosedParcelReport[] = [];
    for (const line of lines) {
      try {
        const lowered = await this.fulfillmentEdit.lowerLineQuantity({
          orderId,
          orderLineId: line.orderLineId,
          newQuantity: line.to,
          ...componentsFor(record, line.orderLineId),
        });
        closedParcels.push(...lowered.closedParcels);
      } catch (error) {
        failed = true;
        this.logger.error(
          `source_change_work_not_narrowed order=${orderId} line=${line.orderLineId}: ${describe(error)}`
        );
      }
    }

    if (await this.followUp(orderId, record, lines)) failed = true;

    if (failed) {
      // Leave (or raise) the attention entry so the order is visible until a
      // later ingestion finishes the job.
      await this.markAttention(orderId, 'apply-failed');
      return { outcome: 'failed', lines, cause: null, closedParcels };
    }

    await this.settle(orderId, record);
    this.logger.log(`source_change_applied order=${orderId} lines=${describeLines(lines)}`);
    return { outcome: 'applied', lines, cause: null, closedParcels };
  }

  /**
   * The reservation, then the master stock, each moved to an absolute target.
   * Answers whether either failed. A failed reservation counts the same as a
   * failed stock reversal: the work is already lower, so leaving the hold at the
   * old quantity under-publishes availability until something repairs it.
   */
  private async followUp(
    orderId: string,
    record: OrderRecord,
    lines: readonly SourceAmendmentLine[]
  ): Promise<boolean> {
    let failed = false;
    try {
      await this.reservations.narrowForOrder({
        orderRecordId: orderId,
        lines: lines.map((line) => ({
          orderLineId: line.orderLineId,
          quantity: line.to,
          ...componentsFor(record, line.orderLineId),
        })),
      });
    } catch (error) {
      failed = true;
      this.logger.error(`source_change_reservation_not_narrowed order=${orderId}: ${describe(error)}`);
    }

    for (const line of lines) {
      try {
        const reversed = await this.saleReversal.reverseLineToTarget({
          internalOrderId: orderId,
          orderLineId: line.orderLineId,
          targetUnits: line.to,
          ...componentsFor(record, line.orderLineId),
        });
        if (reversed.status === 'failed') {
          failed = true;
          this.logger.error(
            `source_change_stock_not_given_back order=${orderId} line=${line.orderLineId}: ${reversed.detail ?? 'no detail'}`
          );
        }
      } catch (error) {
        failed = true;
        this.logger.error(
          `source_change_stock_not_given_back order=${orderId} line=${line.orderLineId}: ${describe(error)}`
        );
      }
    }
    return failed;
  }

  /**
   * The work already matches the order, but an earlier apply did not finish its
   * reservation or stock step. Comparing work alone would call this in sync and
   * drop the flag with those steps still undone, so they run again here, toward
   * the order's current quantities - both are idempotent toward a target.
   */
  private async finishEarlierApply(
    orderId: string,
    record: OrderRecord
  ): Promise<SourceAmendmentReconcileResult> {
    const lines = Object.entries(effectiveQuantities(record.orderItems)).map(([orderLineId, quantity]) => ({
      orderLineId,
      from: quantity,
      to: quantity,
    }));
    if (await this.followUp(orderId, record, lines)) {
      await this.markAttention(orderId, 'apply-failed');
      return { outcome: 'failed', lines: [], cause: null, closedParcels: [] };
    }
    await this.settle(orderId, record);
    this.logger.log(`source_change_finished order=${orderId}`);
    return { outcome: 'applied', lines: [], cause: null, closedParcels: [] };
  }

  /** The order and its work agree: drop this producer's entry and its own holds, if any. */
  private async settle(orderId: string, record: OrderRecord): Promise<void> {
    const hadEntry = record.omsAttention.some((entry) => entry.producer === PRODUCER);
    if (!hadEntry) return;
    await this.release(orderId);
  }

  private async release(orderId: string): Promise<void> {
    await this.fulfillmentEdit.releaseSourceChangeHolds(orderId);
    await this.orderRecords.markOmsAttention(orderId, PRODUCER, { kind: 'none' });
  }

  /** Whether an operator already accepted exactly this mismatch. */
  private async isAccepted(orderId: string, lines: readonly SourceAmendmentLine[]): Promise<boolean> {
    const latest = await this.changes.findLatestByTarget(
      orderId,
      sourceChangeAcceptTargetRef(lines),
      ACCEPT_KIND
    );
    return latest !== null && latest.status === 'confirmed';
  }

  private async accepted(
    orderId: string,
    record: OrderRecord,
    lines: readonly SourceAmendmentLine[]
  ): Promise<SourceAmendmentReconcileResult> {
    await this.settle(orderId, record);
    return { outcome: 'accepted', lines, cause: null, closedParcels: [] };
  }

  /**
   * The cause rides in `detail` as a code (core emits no operator English); the
   * frontend maps it to copy. `shipped` and `apply-failed` are codes outside the
   * hold-cause union because nothing is held for them.
   */
  private async markAttention(orderId: string, detail: string): Promise<void> {
    await this.orderRecords.markOmsAttention(orderId, PRODUCER, {
      kind: 'blocked',
      reason: 'source-change-unapplied',
      detail,
    });
  }

  /**
   * A holder that answers from OpenLinker's own tables needs no credentials
   * (`AdapterMetadata.requiresCredentials: false`, ADR-055): narrowing OL's work
   * row IS that holder's state. Any other holder that has the work would never
   * see the change, so it counts as outside. An unresolvable holder counts as
   * outside too: holding is the safe answer when OL cannot show the change would
   * reach it.
   */
  private async hasOutsideHolder(assessment: OrderWorkEditAssessment): Promise<boolean> {
    for (const work of assessment.handedOff) {
      if (work.assignedConnectionId === null) continue;
      if (!(await this.isInProcessHolder(work.assignedConnectionId))) return true;
    }
    return false;
  }

  /**
   * `requiresCredentials: false` stands in for "this holder runs inside
   * OpenLinker". That is true today only because ADR-055 makes the OL-OMS the
   * one credential-less executor. A future third-party executor that also needs
   * no credentials would be read as in-process, and its work narrowed without it
   * ever hearing of the change - revisit this test before shipping one.
   */
  private async isInProcessHolder(connectionId: string): Promise<boolean> {
    try {
      const connection = await this.connections.get(connectionId);
      const metadata = await this.integrations.resolveAdapterMetadata({
        platformType: connection.platformType,
        adapterKey: connection.adapterKey,
      });
      return !resolveRequiresCredentials(metadata);
    } catch (error) {
      this.logger.warn(
        `source_change_holder_unresolved connection=${connectionId}: ${describe(error)}`
      );
      return false;
    }
  }
}

/**
 * Effective quantity per line. The overlay drops a line lowered to zero, and a
 * line the source removed is simply absent; both read as `0` in the planner.
 */
/** An earlier apply left its reservation or stock step undone (see `finishEarlierApply`). */
function hasUnfinishedApply(record: OrderRecord): boolean {
  return record.omsAttention.some((entry) => entry.producer === PRODUCER && entry.detail === 'apply-failed');
}

/** Bundle line id -> its components, for the lines that are bundles (ADR-083). */
function bundleComponents(record: OrderRecord): Record<string, ComponentLineRef[]> {
  const out: Record<string, ComponentLineRef[]> = {};
  for (const bundle of record.bundleLines) {
    out[bundle.lineId] = record.componentsOfLine(bundle.lineId);
  }
  return out;
}

/** `{ components }` for a bundle line, nothing for an ordinary one. */
function componentsFor(
  record: OrderRecord,
  orderLineId: string
): { components?: ComponentLineRef[] } {
  const components = record.componentsOfLine(orderLineId);
  return components.length > 0 ? { components } : {};
}

function effectiveQuantities(items: OrderRecord['orderItems']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item.id] = (out[item.id] ?? 0) + item.quantity;
  return out;
}

/** Lines the stored amendment reports as raised or added - the only lines that can be an increase. */
function increasedLines(record: OrderRecord): Set<string> {
  const out = new Set<string>();
  for (const change of record.lastAmendmentChanges ?? []) {
    if (change.lineId === undefined) continue;
    if (change.kind === 'line-added') out.add(change.lineId);
    if (
      change.kind === 'line-quantity-changed' &&
      (change.toQuantity ?? 0) > (change.fromQuantity ?? 0)
    ) {
      out.add(change.lineId);
    }
  }
  return out;
}

function describeLines(lines: readonly SourceAmendmentLine[]): string {
  return lines.map((line) => `${line.orderLineId}:${String(line.from)}->${String(line.to)}`).join(',');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
