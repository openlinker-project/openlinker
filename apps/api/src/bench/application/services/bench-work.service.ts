/**
 * Bench Work Service (#2416, `W3b-3`, spec § 2.2, decision D8)
 *
 * *"The bench is a holder's interface; its list is routing's dispatch, not a
 * deadline-derived queue."* This composes that list: what routing assigned to
 * OpenLinker's own packing executor and that executor accepted, joined to the
 * facts a packer reads on the row.
 *
 * ## Why this lives in `apps/api` and not in a core context
 *
 * The row needs the ORDER's reference, buyer name and `dispatchByAt`.
 * `FulfillmentWork` carries `orderId` and nothing else about the order, and
 * `libs/core/src/fulfillment` is a registered zero-sibling-edge leaf whose
 * no-injection invariant (ADR-053, `scripts/check-no-injection-contracts.mjs`,
 * `barrel-purity.spec.ts`) forbids it reading `orders`. So the join happens
 * here — the `AuthorityStatusService` (#2353) precedent verbatim: it cannot live
 * in the leaf, and one screen does not earn a new trust-shaped core context.
 * **This adds no core cross-context edge and spends no allow-list entry.**
 *
 * Both reads go through published `I*Service` interfaces, never a
 * `*RepositoryPort` — an intra-context contract, and `check-cross-context-imports`
 * enforces it.
 *
 * ## The list is scoped by EXECUTOR, and deliberately not by location
 *
 * Every line of the work-list mockup is location-scoped ("routed to Warehouse
 * Kraków"), and `FulfillmentWorkListFilter.locationId` exists. It is not used.
 * Nothing in the product tells a bench which location it stands in: #2413 ships
 * no terminal record, and D2 makes the bench *"a device label, not a
 * principal"*, so there is no configuration to read one from and inventing one
 * is device configuration this wave does not have. Story B1 and § 3's non-goal
 * both say the scope is the executor — *"the list is what routing assigned to
 * this holder"* — so that is the scope, and the surface names the executor
 * connection rather than a warehouse. The alternative, a warehouse name over an
 * unfiltered list, is the surface stating something false.
 *
 * ## The executor is resolved through `BenchExecutorResolver`, shared with the
 * ## parcel that opens from this list
 *
 * #2416 had that resolution as two private methods here. #2418 lifted it out
 * unchanged, because story D2 requires opening a parcel to apply the SAME
 * eligibility rule the list applies — and "assigned to OpenLinker's own packing
 * executor" is a third of that rule. See that file for why the registry is
 * asked rather than `connection.adapterKey` compared.
 *
 * @module apps/api/src/bench/application/services
 * @implements {IBenchWorkService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  FULFILLMENT_WORKLIST_MAX_LIMIT,
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  type FulfillmentWorkView,
  type IFulfillmentWorklistService,
} from '@openlinker/core/fulfillment';
import { ORDER_RECORD_SERVICE_TOKEN, IOrderRecordService } from '@openlinker/core/orders';
import type { OrderRecord } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import {
  BENCH_WORK_REQUEST_STATUSES,
  BENCH_WORK_STATUSES,
  deriveBenchWorkState,
} from '../bench-work-eligibility';
import { readBuyerName, readOrderReference } from '../bench-order-facts';
import { compareBenchWork } from '../bench-work-ordering';
import { BenchExecutorResolver } from './bench-executor.resolver';
import type { IBenchWorkService } from '../interfaces/bench-work.service.interface';
import type {
  BenchRoutingReadiness,
  BenchWorkListView,
  BenchWorkState,
  BenchWorkView,
} from '../types/bench-work.types';



/**
 * The most parcels this read will collect before it truncates.
 *
 * Five pages of `FULFILLMENT_WORKLIST_MAX_LIMIT` against the existing
 * `IDX_fulfillment_works_assigned_open`. Paging rather than reading one page is
 * what makes the urgency sort honest: the sort key lives on the order, so it
 * cannot reach the works query, and a single page would have been sorted-after-
 * truncation — the surface would have dropped rows under a heading promising
 * the most urgent first. At 500 the sort is over the complete set on any
 * realistic install, and `total` is reported either way so a truncated list can
 * say so rather than quietly showing part of the work.
 */
export const BENCH_WORK_HARD_CAP = 5 * FULFILLMENT_WORKLIST_MAX_LIMIT;

@Injectable()
export class BenchWorkService implements IBenchWorkService {
  private readonly logger = new Logger(BenchWorkService.name);

  constructor(
    private readonly executors: BenchExecutorResolver,
    @Inject(FULFILLMENT_WORKLIST_SERVICE_TOKEN)
    private readonly worklist: IFulfillmentWorklistService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService
  ) {}

  async listBenchWork(): Promise<BenchWorkListView> {
    const executors = await this.executors.listPackingExecutors();

    // Nothing is set up to send work here. Reported as its own fact rather than
    // as an empty list, because "nothing to pack right now" and "nothing will
    // ever arrive" are different states with different remedies (story B3), and
    // an empty array cannot tell them apart.
    if (executors.length === 0) {
      const notReady: BenchRoutingReadiness = { ready: false, reason: 'no-packing-connection' };
      return { works: [], executorName: null, routing: notReady, total: 0 };
    }

    const { works, total } = await this.collectWorks(executors.map((c) => c.id));
    const rows = await this.project(works);

    return {
      works: rows,
      // One executor is the ordinary case and its name is what the surface
      // shows. With several configured, naming one would be arbitrary, so the
      // surface is told there is no single name rather than being handed a
      // guess to render as a heading.
      executorName: executors.length === 1 ? executors[0].name : null,
      routing: { ready: true },
      total,
    };
  }

  /**
   * Collect up to `BENCH_WORK_HARD_CAP` parcels, oldest first.
   *
   * `createdAt_ASC` is a SELECTION decision, not a display one: the rows are
   * re-sorted by urgency afterwards, so the only thing this direction decides is
   * which rows survive a truncation. Oldest-first means truncation drops the
   * newest, and an older work object is the one closer to its deadline — the
   * safe end to lose. The default (`createdAt_DESC`) would have dropped the most
   * overdue parcels.
   */
  private async collectWorks(
    executorIds: readonly string[]
  ): Promise<{ works: FulfillmentWorkView[]; total: number }> {
    const works: FulfillmentWorkView[] = [];
    // Keyed by work id, because paging a LIVE table can hand the same row back
    // twice: a parcel that leaves the filter mid-walk (someone closes it, or a
    // hold moves it) shifts every later row into an offset already read. The
    // consequence without this is two rows sharing a React key, which renders as
    // a duplicated parcel — a packer packing one box twice.
    const seen = new Set<string>();
    let total = 0;

    for (let offset = 0; offset < BENCH_WORK_HARD_CAP; offset += FULFILLMENT_WORKLIST_MAX_LIMIT) {
      const page = await this.worklist.list({
        status: BENCH_WORK_STATUSES,
        requestStatus: BENCH_WORK_REQUEST_STATUSES,
        assignedConnectionId: executorIds,
        orderBy: 'createdAt_ASC',
        limit: FULFILLMENT_WORKLIST_MAX_LIMIT,
        offset,
      });
      total = page.total;
      for (const work of page.works) {
        if (seen.has(work.id)) continue;
        seen.add(work.id);
        works.push(work);
      }
      // `page.works.length` rather than the accumulated count decides the end of
      // the walk: a short page IS the end of the collection, whereas the count
      // can lag `total` for ever once a duplicate has been dropped.
      if (page.works.length < FULFILLMENT_WORKLIST_MAX_LIMIT) break;
      if (works.length >= page.total) break;
    }

    if (total > works.length) {
      this.logger.warn(
        `Bench work list truncated at ${String(works.length)} of ${String(total)} parcels ` +
          `(cap ${String(BENCH_WORK_HARD_CAP)}); the newest are omitted.`
      );
    }
    return { works, total };
  }

  /** Join the orders, count the siblings, sort by urgency. */
  private async project(works: readonly FulfillmentWorkView[]): Promise<BenchWorkView[]> {
    if (works.length === 0) return [];

    const orderIds = [...new Set(works.map((work) => work.orderId))];
    // Both batched across the whole page, never per row — the #2083 rule.
    const [orders, siblingIds] = await Promise.all([
      this.orders.findByIds(orderIds),
      this.worklist.listSiblingWorkIds(orderIds),
    ]);
    const orderById = new Map(orders.map((order) => [order.internalOrderId, order]));

    return works
      .map((work) => this.toView(work, orderById.get(work.orderId), siblingIds.get(work.orderId)))
      .sort((a, b) =>
        compareBenchWork(
          {
            expeditedAt: a.expeditedAt === null ? null : new Date(a.expeditedAt),
            dispatchByAt: a.dispatchByAt === null ? null : new Date(a.dispatchByAt),
            workId: a.workId,
          },
          {
            expeditedAt: b.expeditedAt === null ? null : new Date(b.expeditedAt),
            dispatchByAt: b.dispatchByAt === null ? null : new Date(b.dispatchByAt),
            workId: b.workId,
          }
        )
      );
  }

  private toView(
    work: FulfillmentWorkView,
    order: OrderRecord | undefined,
    siblings: readonly string[] | undefined
  ): BenchWorkView {
    const hold = work.activeHolds[0];
    // Story D2's shared rule — the SAME function `BenchParcelService` refuses
    // with, which is what stops the list and the bench disagreeing about
    // whether a parcel may be packed. Never inlined here again.
    const state: BenchWorkState = deriveBenchWorkState({
      status: work.status,
      requestStatus: work.requestStatus,
      activeHoldCount: work.activeHolds.length,
    });

    // A parcel whose siblings could not be read is "1 of 1" rather than "1 of 0":
    // the work in the packer's hands exists, so the count must include it.
    const parcels = siblings !== undefined && siblings.length > 0 ? siblings : [work.id];
    const index = parcels.indexOf(work.id);

    // Field-by-field, never a spread — this is an allowlist over an order
    // snapshot that carries the buyer's address, email and phone.
    return {
      workId: work.id,
      version: work.version,
      orderId: work.orderId,
      orderReference: readOrderReference(order) ?? work.orderId,
      buyerName: readBuyerName(order),
      dispatchByAt: order?.dispatchByAt?.toISOString() ?? null,
      parcelIndex: index >= 0 ? index + 1 : 1,
      parcelTotal: parcels.length,
      lineCount: work.lines.length,
      // Units still to be confirmed against the box. Cancelled units are
      // subtracted because nobody will put them in; `fulfilledQuantity` is
      // deliberately NOT consulted — see the view type's module note on B2.
      unitsToVerify: work.lines.reduce(
        (sum, line) => sum + Math.max(0, line.totalQuantity - line.cancelledQuantity),
        0
      ),
      state,
      holdReason: hold?.reason ?? null,
      holdPlacedAt: hold?.placedAt.toISOString() ?? null,
      expeditedAt: work.expeditedAt?.toISOString() ?? null,
      supportedActions: work.supportedActions,
    };
  }
}
