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

import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '../../fulfillment.tokens';
import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import { isTerminalFulfillmentWorkStatus } from '../../domain/types/fulfillment-supported-actions.types';
import type {
  AddLineToWorkInput,
  AddLineToWorkResult,
  IFulfillmentOrderEditService,
  LineComponentRef,
  LineComponentsByLine,
  LowerLineQuantityInput,
  LowerLineQuantityResult,
  OrderWorkEditAssessment,
} from '../interfaces/fulfillment-order-edit.service.interface';

@Injectable()
export class FulfillmentOrderEditService implements IFulfillmentOrderEditService {
  private readonly logger = new Logger(FulfillmentOrderEditService.name);

  constructor(
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly works: FulfillmentWorkRepositoryPort
  ) {}

  async assessForEdit(
    orderId: string,
    components: LineComponentsByLine = {}
  ): Promise<OrderWorkEditAssessment> {
    const works = await this.works.findByOrderId(orderId);
    const live = works.filter((work) => work.status !== 'cancelled');
    const fulfilledByLine: Record<string, number> = {};
    for (const work of live) {
      for (const line of work.lines) {
        fulfilledByLine[line.orderLineId] =
          (fulfilledByLine[line.orderLineId] ?? 0) + line.fulfilledQuantity;
      }
    }
    // A bundle line's units are on its component lines: fold them back so the
    // answer is per commercial line, which is how the edit guards key.
    for (const [bundleLineId, refs] of Object.entries(components)) {
      if (refs.length === 0) continue;
      // Conservative fold, the exact complement of `lowerComponents`: the line
      // can only be lowered to Q when EVERY component has `Q * perUnit >=
      // fulfilled`, i.e. Q >= ceil(fulfilled / perUnit) for each. A floor/min
      // fold under-reports a partly fulfilled component and lets an edit pass
      // the guard that the write then refuses half-way.
      fulfilledByLine[bundleLineId] = Math.max(
        ...refs.map((ref) =>
          Math.ceil((fulfilledByLine[ref.componentLineId] ?? 0) / Math.max(ref.perUnit, 1))
        )
      );
      for (const ref of refs) delete fulfilledByLine[ref.componentLineId];
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
    };
  }

  async addLineToOpenWork(input: AddLineToWorkInput): Promise<AddLineToWorkResult> {
    const works = await this.works.findByOrderId(input.orderId);
    if (works.length === 0) return { outcome: 'unrouted', workId: null };
    if (works.some((work) => work.lines.some((line) => line.orderLineId === input.orderLineId))) {
      return { outcome: 'unchanged', workId: null };
    }
    for (const work of works) {
      if (isTerminalFulfillmentWorkStatus(work.status) || work.parcelClosedAt !== null) continue;
      if (!(await input.acceptsHolder(work.assignedConnectionId))) continue;
      const added = await this.works.addLine(work.id, {
        orderLineId: input.orderLineId,
        productVariantId: input.productVariantId,
        totalQuantity: input.quantity,
      });
      if (added) return { outcome: 'added', workId: work.id };
    }
    return { outcome: 'no-eligible-work', workId: null };
  }

  async lowerLineQuantity(input: LowerLineQuantityInput): Promise<LowerLineQuantityResult> {
    if (!Number.isInteger(input.newQuantity) || input.newQuantity < 0) {
      throw new RangeError(`newQuantity must be a non-negative integer, got ${String(input.newQuantity)}`);
    }
    if (input.components !== undefined && input.components.length > 0) {
      return this.lowerComponents(input, input.components);
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
      return { outcome: 'unrouted', cancelledUnits: 0, workIds: [] };
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
      return { outcome: 'unchanged', cancelledUnits: 0, workIds: [] };
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

    this.logger.log(
      `Lowered order line ${input.orderLineId} of order ${input.orderId} to ${String(input.newQuantity)}: ` +
        `cancelled ${String(cancelled)} unit(s) on ${String(touched.length)} work object(s)`
    );
    return { outcome: 'applied', cancelledUnits: cancelled, workIds: touched };
  }

  /**
   * A bundle line (#3607): its work lines carry the component line ids, so each
   * component is lowered to `newQuantity * perUnit` and the outcomes sum back to
   * one answer. Every component is validated BEFORE any is written, so a
   * component that already shipped refuses the whole edit instead of leaving a
   * half-narrowed set.
   */
  private async lowerComponents(
    input: LowerLineQuantityInput,
    components: readonly LineComponentRef[]
  ): Promise<LowerLineQuantityResult> {
    const works = (await this.works.findByOrderId(input.orderId)).filter(
      (work) => !isTerminalFulfillmentWorkStatus(work.status)
    );
    for (const component of components) {
      const fulfilled = works
        .flatMap((work) => work.lines)
        .filter((line) => line.orderLineId === component.componentLineId)
        .reduce((sum, line) => sum + line.fulfilledQuantity, 0);
      const target = input.newQuantity * component.perUnit;
      if (target < fulfilled) {
        throw new RangeError(
          `Order line ${input.orderLineId} already has ${String(fulfilled)} unit(s) of component ` +
            `${component.componentLineId} fulfilled; it cannot be lowered to ${String(input.newQuantity)}`
        );
      }
    }

    const results: LowerLineQuantityResult[] = [];
    for (const component of components) {
      results.push(
        await this.lowerLineQuantity({
          orderId: input.orderId,
          orderLineId: component.componentLineId,
          newQuantity: input.newQuantity * component.perUnit,
        })
      );
    }
    const applied = results.some((r) => r.outcome === 'applied');
    return {
      outcome: applied
        ? 'applied'
        : results.every((r) => r.outcome === 'unrouted')
          ? 'unrouted'
          : 'unchanged',
      cancelledUnits: results.reduce((sum, r) => sum + r.cancelledUnits, 0),
      workIds: [...new Set(results.flatMap((r) => r.workIds))],
    };
  }
}
