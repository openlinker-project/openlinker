/**
 * Fulfillment Order Edit Service (#3542, D-C)
 *
 * Lowers a routed order line by cancelling units on the work line(s) that carry
 * it. `totalQuantity` is insert-only and never rewritten; the counters are the
 * only thing that moves, through the repository's own `recordLineProgress`
 * (`CHK_fulfillment_work_lines_capacity` is the backstop).
 *
 * It deliberately does NOT go through `IFulfillmentProgressService`. That
 * service exists for a holder's progress report and may return relay intents or
 * a re-route intent (a short pick re-enters routing). An operator lowering a
 * quantity is not a holder reporting progress: nothing must be relayed to a
 * marketplace and nothing re-routed, so the write is made directly and the
 * result type has no place to carry an intent.
 *
 * @module libs/core/src/fulfillment/application/services
 * @implements {IFulfillmentOrderEditService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import {
  FULFILLMENT_PROGRESS_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
} from '../../fulfillment.tokens';
import { buildFulfillmentParcelClosureIdempotencyKey } from '../../domain/types/fulfillment-progress-event.types';
import { IFulfillmentProgressService } from '../interfaces/fulfillment-progress.service.interface';
import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import { isTerminalFulfillmentWorkStatus } from '../../domain/types/fulfillment-supported-actions.types';
import {
  isParcelComplete,
  requiredUnitsForLine,
} from '../../domain/types/fulfillment-verification.types';
import { SOURCE_CHANGE_HOLD_ACTOR } from '../../domain/types/fulfillment-hold.types';
import type {
  ClosedParcelReport,
  HoldForSourceChangeInput,
  HoldForSourceChangeResult,
  IFulfillmentOrderEditService,
  LowerLineQuantityInput,
  LowerLineQuantityResult,
  OrderWorkEditAssessment,
  ReleaseSourceChangeHoldsResult,
} from '../interfaces/fulfillment-order-edit.service.interface';

@Injectable()
export class FulfillmentOrderEditService implements IFulfillmentOrderEditService {
  private readonly logger = new Logger(FulfillmentOrderEditService.name);

  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly works: FulfillmentWorkRepositoryPort,
    @Inject(FULFILLMENT_PROGRESS_SERVICE_TOKEN)
    private readonly progress: IFulfillmentProgressService
  ) {}

  async assessForEdit(orderId: string): Promise<OrderWorkEditAssessment> {
    const works = await this.works.findByOrderId(orderId);
    const live = works.filter((work) => work.status !== 'cancelled');
    const fulfilledByLine: Record<string, number> = {};
    for (const work of live) {
      for (const line of work.lines) {
        fulfilledByLine[line.orderLineId] =
          (fulfilledByLine[line.orderLineId] ?? 0) + line.fulfilledQuantity;
      }
    }

    const requiredByLine: Record<string, number> = {};
    const verifiedByLine: Record<string, number> = {};
    for (const work of works.filter((candidate) => !isTerminalFulfillmentWorkStatus(candidate.status))) {
      const orderLineByWorkLine = new Map<string, string>();
      for (const line of work.lines) {
        orderLineByWorkLine.set(line.id, line.orderLineId);
        requiredByLine[line.orderLineId] =
          (requiredByLine[line.orderLineId] ?? 0) + requiredUnitsForLine(line);
      }
      for (const count of await this.works.countParcelVerifications(work.id)) {
        const orderLineId = orderLineByWorkLine.get(count.workLineId);
        if (orderLineId === undefined) continue;
        verifiedByLine[orderLineId] = (verifiedByLine[orderLineId] ?? 0) + count.verifiedQuantity;
      }
    }

    return {
      unrouted: works.length === 0,
      anyParcelClosed: live.some((work) => work.parcelClosedAt !== null),
      handedOff: live
        .filter((work) => work.requestStatus === 'submitted' || work.requestStatus === 'accepted')
        .map((work) => ({
          workId: work.id,
          assignedConnectionId: work.assignedConnectionId,
          status: work.status,
          requestStatus: work.requestStatus,
        })),
      underway: live.some(
        (work) => work.status === 'in_progress' || work.requestStatus === 'accepted'
      ),
      fulfilledByLine,
      requiredByLine,
      verifiedByLine,
    };
  }

  async holdForSourceChange(input: HoldForSourceChangeInput): Promise<HoldForSourceChangeResult> {
    const works = (await this.works.findByOrderId(input.orderId)).filter(
      (work) => !isTerminalFulfillmentWorkStatus(work.status)
    );
    if (works.length === 0) return { heldWorkIds: [] };

    const active = await this.works.listActiveHoldsForWorks(works.map((work) => work.id));
    const heldWorkIds: string[] = [];
    for (const work of works) {
      const already = (active.get(work.id) ?? []).some(
        (hold) => hold.placedByService === SOURCE_CHANGE_HOLD_ACTOR
      );
      if (already) continue;
      await this.works.placeHold({
        workId: work.id,
        reason: 'awaiting-amendment',
        // No note: a hold note is operator-authored text rendered verbatim, and
        // a system-written English sentence would reach every surface
        // untranslated. The `awaiting-amendment` reason names the hold.
        note: null,
        placedByUserId: null,
        placedByService: SOURCE_CHANGE_HOLD_ACTOR,
        placedAt: new Date(),
      });
      heldWorkIds.push(work.id);
    }
    if (heldWorkIds.length > 0) {
      this.logger.log(
        `Held ${String(heldWorkIds.length)} work object(s) of order ${input.orderId}: the source changed a line`
      );
    }
    return { heldWorkIds };
  }

  async releaseSourceChangeHolds(orderId: string): Promise<ReleaseSourceChangeHoldsResult> {
    const works = await this.works.findByOrderId(orderId);
    if (works.length === 0) return { releasedHoldIds: [] };

    const active = await this.works.listActiveHoldsForWorks(works.map((work) => work.id));
    const releasedHoldIds: string[] = [];
    for (const holds of active.values()) {
      for (const hold of holds) {
        if (hold.placedByService !== SOURCE_CHANGE_HOLD_ACTOR) continue;
        await this.works.releaseHold({
          holdId: hold.id,
          workId: hold.fulfillmentWorkId,
          releasedAt: new Date(),
          releasedByUserId: null,
          releaseNote: 'The order and its packing work agree again.',
        });
        releasedHoldIds.push(hold.id);
      }
    }
    return { releasedHoldIds };
  }

  async lowerLineQuantity(input: LowerLineQuantityInput): Promise<LowerLineQuantityResult> {
    if (!Number.isInteger(input.newQuantity) || input.newQuantity < 0) {
      throw new RangeError(`newQuantity must be a non-negative integer, got ${String(input.newQuantity)}`);
    }

    const works = (await this.works.findByOrderId(input.orderId)).filter(
      (work) => !isTerminalFulfillmentWorkStatus(work.status)
    );
    const carrying = works.flatMap((work) =>
      work.lines
        .filter((line) => line.orderLineId === input.orderLineId)
        .map((line) => ({ work, line }))
    );
    if (carrying.length === 0) {
      return { outcome: 'unrouted', cancelledUnits: 0, workIds: [], closedParcels: [] };
    }

    const required = carrying.reduce(
      (sum, { line }) => sum + (line.totalQuantity - line.cancelledQuantity),
      0
    );
    const fulfilled = carrying.reduce((sum, { line }) => sum + line.fulfilledQuantity, 0);
    if (input.newQuantity < fulfilled) {
      throw new RangeError(
        `Order line ${input.orderLineId} already has ${String(fulfilled)} unit(s) fulfilled; ` +
          `it cannot be lowered to ${String(input.newQuantity)}`
      );
    }

    let toCancel = required - input.newQuantity;
    if (toCancel <= 0) {
      return { outcome: 'unchanged', cancelledUnits: 0, workIds: [], closedParcels: [] };
    }

    // Largest remaining first, so a split line is narrowed where most of it
    // sits rather than shaving one unit off every parcel.
    const ordered = [...carrying].sort(
      (a, b) =>
        b.line.totalQuantity - b.line.cancelledQuantity - b.line.fulfilledQuantity -
        (a.line.totalQuantity - a.line.cancelledQuantity - a.line.fulfilledQuantity)
    );
    const touched: string[] = [];
    let cancelled = 0;
    for (const { work, line } of ordered) {
      if (toCancel <= 0) break;
      const cancellable = line.totalQuantity - line.cancelledQuantity - line.fulfilledQuantity;
      const cut = Math.min(cancellable, toCancel);
      if (cut <= 0) continue;
      const applied = await this.works.recordLineProgress({
        workId: work.id,
        orderLineId: input.orderLineId,
        fulfilledDelta: 0,
        cancelledDelta: cut,
      });
      if (applied) {
        toCancel -= cut;
        cancelled += cut;
        touched.push(work.id);
      }
    }

    const closedParcels: ClosedParcelReport[] = [];
    for (const workId of touched) {
      const closed = await this.closeIfNowComplete(workId);
      if (closed !== null) closedParcels.push(closed);
    }

    this.logger.log(
      `Lowered order line ${input.orderLineId} of order ${input.orderId} to ${String(input.newQuantity)}: ` +
        `cancelled ${String(cancelled)} unit(s) on ${String(touched.length)} work object(s)`
    );
    return { outcome: 'applied', cancelledUnits: cancelled, workIds: touched, closedParcels };
  }

  /**
   * Close a box the lowered quantity left exactly full (#3961).
   *
   * A box normally shuts inside the scan that fills it (D18). When the order
   * shrinks instead - the packer had already scanned the new quantity, or took
   * the surplus out - no further scan will ever come, and without this the
   * parcel sits at "1 of 1" with nothing the packer can press to finish it.
   * The rule is the scan's own (`isParcelComplete`) and the owner is the last
   * verifier (D13), so the box ends in the state a final scan would have left.
   *
   * A box under any hold OTHER than the shop-change one is left open: a scan
   * cannot close a held box either, and closing it here would report a parcel
   * an operator stopped as shipped. The shop-change hold is the exception
   * because "Done, I took it out" closes the box moments before that very
   * hold is released.
   *
   * The close is then recorded as `shipped` progress, exactly as the bench and
   * the worklist record theirs (#3525). That is what makes the #2728 relay sweep
   * tell the order's channel even on the worker path, where no host holds the
   * parcel-closure notifier; a host that does relays at once from the returned
   * report. Without the record the parcel would be closed in OpenLinker and
   * never reported as dispatched.
   *
   * Best-effort: the quantity change is already durable, and a box left open
   * still closes on the next scan, so a failure here is logged, never thrown.
   */
  private async closeIfNowComplete(workId: string): Promise<ClosedParcelReport | null> {
    try {
      const holds = (await this.works.listActiveHoldsForWorks([workId])).get(workId) ?? [];
      if (holds.some((hold) => hold.placedByService !== SOURCE_CHANGE_HOLD_ACTOR)) {
        this.logger.log(`Left parcel ${workId} open: it is on hold for another reason`);
        return null;
      }

      const closed = await this.works.runInTransaction(async (transaction) => {
        const work = await this.works.lockWorkForVerification(workId, transaction);
        if (work === null || work.parcelClosedAt !== null) return null;
        const counts = await this.works.countParcelVerifications(workId, transaction);
        if (!isParcelComplete(work.lines, counts)) return null;
        const last = await this.works.findLatestActiveVerification(workId, transaction);
        // A close naming nobody is refused by the schema; a box with no
        // attributable scan stays open for the packer to finish.
        if (last?.verifiedByUserId == null) return null;
        const closedAt = new Date();
        const claimed = await this.works.claimParcelClose(
          { workId, closedAt, packedByUserId: last.verifiedByUserId },
          transaction
        );
        return claimed ? { closedAt, connectionId: work.assignedConnectionId } : null;
      });
      if (closed === null) return null;

      this.logger.log(`Closed parcel ${workId}: the lowered quantity left it full`);
      await this.recordShipped(workId, closed.connectionId, closed.closedAt);
      return { workId, closedAt: closed.closedAt };
    } catch (error) {
      this.logger.warn(
        `Could not close parcel ${workId} after lowering its quantity: ${(error as Error).message}`
      );
      return null;
    }
  }

  /**
   * The `shipped` progress fact for an edit-driven close, keyed exactly as the
   * notifier keys its own (`buildFulfillmentParcelClosureIdempotencyKey`), so a
   * host relaying the same close finds the claim already taken rather than
   * recording it twice.
   */
  private async recordShipped(workId: string, connectionId: string | null, closedAt: Date): Promise<void> {
    if (connectionId === null) {
      // A progress event without a reporting connection is meaningless; the
      // notifier's own contract refuses one for the same reason.
      this.logger.warn(`Closed parcel ${workId} has no holder; its dispatch is not recorded`);
      return;
    }
    try {
      await this.progress.record({
        kind: 'shipped',
        workId,
        connectionId,
        idempotencyKey: buildFulfillmentParcelClosureIdempotencyKey(workId, closedAt),
        occurredAt: closedAt,
      });
    } catch (error) {
      this.logger.error(
        `Closed parcel ${workId} but could not record it as shipped: ${(error as Error).message}`
      );
    }
  }
}
