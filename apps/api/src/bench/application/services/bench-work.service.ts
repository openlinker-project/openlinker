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
 * ## Completion (pack-bench completion) does not narrow `collectWorks`' SQL selection
 *
 * A parcel already carries `parcelClosedAt` for a while before anything reads
 * `status`/`requestStatus` differently — this list has NEVER filtered on
 * `parcelClosedAt`, so a packed-but-not-yet-completed parcel already stays
 * selectable here today, exactly as before this change. Adding a
 * `completedAt IS NULL` filter to `collectWorks` would be a NEW behaviour
 * change riding inside this slice rather than something the four new columns
 * require, and `listPackedToday` is UNCHANGED for the identical reason: it
 * keys on `parcelClosedAt` (when it was packed), never on `completedAt`
 * (when it left), so today's "packed today" count is unaffected by whether a
 * parcel has since been completed.
 *
 * `BenchWorkView.completedAt` is exposed instead, precisely so a consumer of
 * this list CAN choose to move a completed row out of its own rendering of
 * "to pack" without a backend behaviour change — the field is additive, the
 * query is not.
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
  deriveBenchWorkAssignmentState,
  deriveBenchWorkState,
  isClaimableByViewer,
} from '../bench-work-eligibility';
import { readBuyerName, readOrderReference } from '../bench-order-facts';
import { compareBenchWork } from '../bench-work-ordering';
import { BenchExecutorResolver } from './bench-executor.resolver';
import {
  BENCH_PARCEL_SERVICE_TOKEN,
  type IBenchParcelService,
} from '../interfaces/bench-parcel.service.interface';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';

import { productImageProxyPath } from '../../../products/http/product-image-path';
import type { IBenchWorkService } from '../interfaces/bench-work.service.interface';
import type { BenchClaimNextResultView } from '../types/bench-parcel.types';
import type {
  BenchMetricsView,
  BenchPackedTodayListView,
  BenchPackedTodayRowView,
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

/**
 * How many product lines a rail row shows before it stops (#3415).
 *
 * Three, because the row has to stay one glanceable block in a scrolling
 * list - a twelve-line parcel rendering twelve names turns one row into a
 * screenful and the rail stops being scannable, which is the whole reason a
 * packer looks at it. `lineCount` keeps the honest total beside them, so the
 * surface can say how many more there are rather than implying this is all.
 */
const RAIL_ITEM_LIMIT = 3;

@Injectable()
export class BenchWorkService implements IBenchWorkService {
  private readonly logger = new Logger(BenchWorkService.name);

  constructor(
    private readonly executors: BenchExecutorResolver,
    @Inject(FULFILLMENT_WORKLIST_SERVICE_TOKEN)
    private readonly worklist: IFulfillmentWorklistService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
    @Inject(BENCH_PARCEL_SERVICE_TOKEN)
    private readonly parcels: IBenchParcelService,
    // #3415 — the rail leads with what is IN the box, so it needs the
    // catalogue. Read in ONE batch per page (see `project`), never per row.
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService
  ) {}

  async listBenchWork(viewerId: string, supervises: boolean): Promise<BenchWorkListView> {
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
    const projected = await this.project(works, viewerId);

    // A packer sees their own work and the unassigned pool — never a row
    // locked to somebody else (pack-bench completion, ADR-071). They cannot act on it anyway
    // (`isClaimableByViewer` already refuses it), and it carries a buyer name
    // read off the order snapshot, so it is dropped here rather than merely
    // hidden by the frontend. `total` is adjusted by exactly what was dropped
    // from THIS page, so it keeps reporting "what matches" for the rows the
    // viewer was actually given — including the truncation signal above
    // `BENCH_WORK_HARD_CAP`, which this filter must not silently erase.
    const rows = supervises
      ? projected
      : projected.filter((row) => row.assignmentState !== 'assigned-other');
    const hidden = projected.length - rows.length;

    return {
      works: rows,
      // One executor is the ordinary case and its name is what the surface
      // shows. With several configured, naming one would be arbitrary, so the
      // surface is told there is no single name rather than being handed a
      // guess to render as a heading.
      executorName: executors.length === 1 ? executors[0].name : null,
      routing: { ready: true },
      total: total - hidden,
    };
  }

  async claimNext(viewerId: string, supervises: boolean): Promise<BenchClaimNextResultView> {
    // Reuses listBenchWork's OWN sort and eligibility — no second ordering to
    // keep in sync with `compareBenchWork`, and `claimable` is the same
    // predicate `claimParcel` re-checks at write time.
    //
    // Asks for the caller's OWN visible set, never the unfiltered one. This
    // read used to pass `supervises: true`, justified by the claim that a row
    // assigned to somebody else is never claimable anyway — which is false:
    // `isClaimableByViewer`'s first line returns `true` for anything with
    // `selfServeEligible`, and that column defaults `true`, so it is true of
    // essentially every row. The consequence was that "Take next task" could
    // hand a packer a parcel their own rail refuses to show them, on a screen
    // that had just told them there was nothing there. Whatever the list is
    // scoped to, the button must pick from the same set: a control that can
    // reach past what the operator can see is one they cannot reason about.
    const { works } = await this.listBenchWork(viewerId, supervises);
    const top = works.find(
      (row) => row.state === 'packable' && row.claimable && row.assignmentState !== 'mine'
    );
    if (top === undefined) return { outcome: 'nothing-to-claim' };

    // Delegates to claimParcel for the write AND the re-check: the list
    // snapshot above can be stale by the time this runs (another packer
    // claimed it first), so the actual eligibility decision is made fresh,
    // never trusted from the row that picked the candidate.
    const result = await this.parcels.claimParcel(top.workId, viewerId);
    if (result.outcome === 'refused') {
      // Reported as a REFUSAL, never as an empty queue. Reaching here means a
      // candidate was found and lost — a race, with the rail still showing the
      // row — so answering 'nothing-to-claim' would state the opposite of what
      // the packer can see. `reason` is non-null on this arm by the result
      // type's own contract; the fallback keeps the narrowing honest rather
      // than asserting it.
      return { outcome: 'refused', reason: result.reason ?? 'not-claimable' };
    }
    return { outcome: 'claimed', parcel: result.parcel };
  }

  async listPackedToday(dayStart: Date, dayEnd: Date): Promise<BenchPackedTodayListView> {
    const executors = await this.executors.listPackingExecutors();
    if (executors.length === 0) return { works: [], total: 0 };

    const page = await this.worklist.list({
      assignedConnectionId: executors.map((c) => c.id),
      parcelClosedAfter: dayStart,
      parcelClosedBefore: dayEnd,
      limit: FULFILLMENT_WORKLIST_MAX_LIMIT,
    });

    const orderIds = [...new Set(page.works.map((w) => w.orderId))];
    const orders = orderIds.length === 0 ? [] : await this.orders.findByIds(orderIds);
    const orderById = new Map(orders.map((order) => [order.internalOrderId, order]));
    const siblings = await this.worklist.listSiblingWorkIds(orderIds);

    // Newest-closed first — `list`'s own order is `createdAt`, which this
    // context cannot promise correlates with `parcelClosedAt`, so the small,
    // already-bounded page is re-sorted above the query, the same "sort
    // happens above the query" discipline `collectWorks` uses for urgency.
    const sorted = [...page.works].sort((a, b) => {
      const at = a.parcelClosedAt?.getTime() ?? 0;
      const bt = b.parcelClosedAt?.getTime() ?? 0;
      return bt - at;
    });

    const rows: BenchPackedTodayRowView[] = sorted
      // Every row in this page was selected BY `parcelClosedAfter`, so
      // `parcelClosedAt` is never null here — the guard is a type narrowing,
      // not a real filter.
      .filter((w): w is typeof w & { parcelClosedAt: Date } => w.parcelClosedAt !== null)
      .map((w) => {
        const order = orderById.get(w.orderId);
        const parcels = siblings.get(w.orderId) ?? [w.id];
        const index = parcels.indexOf(w.id);
        return {
          workId: w.id,
          orderReference: readOrderReference(order) ?? w.orderId,
          buyerName: readBuyerName(order),
          parcelIndex: index >= 0 ? index + 1 : 1,
          parcelTotal: parcels.length > 0 ? parcels.length : 1,
          closedAt: w.parcelClosedAt.toISOString(),
          packedByUserId: w.packedByUserId,
        };
      });

    return { works: rows, total: page.total };
  }

  async getMetrics(now: Date): Promise<BenchMetricsView> {
    const executors = await this.executors.listPackingExecutors();
    if (executors.length === 0) {
      return { packedToday: 0, packedYesterday: 0, toPackAllBenches: 0 };
    }
    const connectionIds = executors.map((c) => c.id);

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const elapsedMs = now.getTime() - todayStart.getTime();
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    // The SAME elapsed portion of the day, not the whole of yesterday — see
    // `BenchMetricsView.packedYesterday`'s docblock for why.
    const yesterdayCutoff = new Date(yesterdayStart.getTime() + elapsedMs);

    const [packedToday, packedYesterday, toPackAllBenches] = await Promise.all([
      this.worklist.list({
        assignedConnectionId: connectionIds,
        parcelClosedAfter: todayStart,
        parcelClosedBefore: now,
        limit: 1,
      }),
      this.worklist.list({
        assignedConnectionId: connectionIds,
        parcelClosedAfter: yesterdayStart,
        parcelClosedBefore: yesterdayCutoff,
        limit: 1,
      }),
      this.worklist.list({
        assignedConnectionId: connectionIds,
        // `cancelled` is deliberately EXCLUDED here, unlike `listBenchWork`'s
        // own selection — that list shows a cancelled parcel so a packer
        // spots a tote that must NOT be packed, but "to pack" is a backlog
        // count and a cancelled parcel has nothing left to pack.
        status: BENCH_WORK_STATUSES.filter((status) => status !== 'cancelled'),
        requestStatus: [...BENCH_WORK_REQUEST_STATUSES],
        parcelClosed: false,
        limit: 1,
      }),
    ]);

    return {
      packedToday: packedToday.total,
      packedYesterday: packedYesterday.total,
      toPackAllBenches: toPackAllBenches.total,
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
  private async project(
    works: readonly FulfillmentWorkView[],
    viewerId: string
  ): Promise<BenchWorkView[]> {
    if (works.length === 0) return [];

    const orderIds = [...new Set(works.map((work) => work.orderId))];
    // Batched across the whole page, never per row — the #2083 rule. The
    // variant read is one query for EVERY line of every row on the page, and
    // the product read one more; a per-row resolve would be an N+1 on the
    // rail, which is the hottest read this bench has.
    const variantIds = [
      ...new Set(works.flatMap((work) => work.lines.map((line) => line.productVariantId))),
    ];
    const [orders, siblingIds, variants] = await Promise.all([
      this.orders.findByIds(orderIds),
      this.worklist.listSiblingWorkIds(orderIds),
      variantIds.length === 0 ? Promise.resolve([]) : this.products.getVariantsByIds(variantIds),
    ]);
    const productIds = [...new Set(variants.map((variant) => variant.productId))];
    const products =
      productIds.length === 0 ? [] : await this.products.getProductsByIds(productIds);
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));
    const productById = new Map(products.map((product) => [product.id, product]));
    const orderById = new Map(orders.map((order) => [order.internalOrderId, order]));

    return works
      .map((work) =>
        this.toView(
          work,
          orderById.get(work.orderId),
          siblingIds.get(work.orderId),
          viewerId,
          variantById,
          productById
        )
      )
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
    siblings: readonly string[] | undefined,
    viewerId: string,
    variantById: ReadonlyMap<string, { readonly productId: string }>,
    // Structural, and it carries `images` because `productImageProxyPath`
    // reads it - typing this as `{ name }` alone compiled under ts-jest and
    // failed the real build, which is the one that matters.
    productById: ReadonlyMap<
      string,
      { readonly id: string; readonly name: string; readonly images: readonly string[] | null }
    >
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
    // #3341, ADR-074 — the SAME two shared predicates the write path reads
    // (`bench-parcel.service.ts`), so list and write can never disagree about
    // who this parcel is locked to.
    const assignmentState = deriveBenchWorkAssignmentState(work, viewerId);
    const claimable = isClaimableByViewer(work, viewerId);

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
      // What is in the box, capped. Cancelled units are subtracted for the
      // same reason `unitsToVerify` below subtracts them: nobody will put them
      // in, so showing them would have a packer looking for something that is
      // not going in the parcel. A line cancelled to zero is dropped entirely.
      items: work.lines
        .map((line) => {
          const variant = variantById.get(line.productVariantId);
          const product = variant === undefined ? undefined : productById.get(variant.productId);
          return {
            // `null`, never a placeholder: a variant absent from the catalogue
            // is a fact the packer can act on, and a fabricated name is not.
            name: product?.name ?? null,
            quantity: Math.max(0, line.totalQuantity - line.cancelledQuantity),
            imageUrl: productImageProxyPath(product),
          };
        })
        .filter((item) => item.quantity > 0)
        .slice(0, RAIL_ITEM_LIMIT),
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
      assignmentState,
      claimable,
      completedAt: work.completedAt?.toISOString() ?? null,
    };
  }
}
