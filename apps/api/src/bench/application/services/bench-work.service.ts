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
 * ## The executor is resolved through the REGISTRY, not by a string compare
 *
 * `Connection.adapterKey` is nullable and the connection create form omits it —
 * which is exactly why the OMS plugin's manifest carries `isDefault: true`. So a
 * real OMS row stores NULL, and comparing `connection.adapterKey` to
 * `OMS_ADAPTER_KEY` would match nothing on any install: the bench would report
 * "nothing is set up" forever. `resolveAdapterMetadata` is asked instead, which
 * is metadata-only — it constructs no adapter and resolves no credential, so a
 * read that must answer while the floor is busy never touches a secret. Asking
 * the registry is also what keeps this from being a `platformType` switch: the
 * registry owns the platform-to-default mapping, and this service merely asks
 * it a question and compares the answer to the OMS package's own exported
 * constant.
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
import type { Connection } from '@openlinker/core/identifier-mapping';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import { ORDER_RECORD_SERVICE_TOKEN, IOrderRecordService } from '@openlinker/core/orders';
import type { OrderRecord } from '@openlinker/core/orders';
import { OMS_ADAPTER_KEY } from '@openlinker/oms';
import { Logger } from '@openlinker/shared/logging';

import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../../integrations/application/interfaces/connection.service.interface';
import { compareBenchWork } from '../bench-work-ordering';
import type { IBenchWorkService } from '../interfaces/bench-work.service.interface';
import type {
  BenchRoutingReadiness,
  BenchWorkListView,
  BenchWorkState,
  BenchWorkView,
} from '../types/bench-work.types';

/**
 * The capability a connection must have ENABLED to be a packing executor.
 *
 * Enabled, not merely advertised: `enabledCapabilities` is the operator's own
 * decision, and a connection whose adapter can execute fulfilment but which
 * nobody switched on is not carrying out anything.
 */
const PACKING_CAPABILITY = 'FulfillmentExecutor';

/**
 * Which execution states can appear on the bench.
 *
 * `closed` and `incomplete` are excluded: both are terminal and neither is
 * packable.
 *
 * **`cancelled` is INCLUDED, and that is not a slip against B1's "not yet
 * closed".** The mockup ships a "Do not pack these" section carrying exactly
 * the held and the cancelled — *"nothing to pack. Take the items back to the
 * shelf."* A cancelled parcel whose tote is physically on the bench is the one
 * case where silence is worse than speech: say nothing and the packer packs it.
 * Being terminal, such a row carries no actions at all — `deriveSupportedActions`
 * returns `[]` — including no expedite, which is correct and is stated here
 * because an empty `supportedActions` otherwise reads like a bug.
 *
 * **`on_hold` is defensive only.** Nothing in the tree writes
 * `status = 'on_hold'`: `placeHold` inserts a hold row and leaves the status
 * alone, so a held parcel arrives as `open` with a non-empty `activeHolds`.
 * Heldness is therefore derived from that array, never from this list — keying
 * on the status would have made every held parcel vanish from the one section
 * whose absence is dangerous.
 */
const BENCH_STATUSES = ['open', 'scheduled', 'on_hold', 'in_progress', 'cancelled'] as const;

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
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connections: IConnectionService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(FULFILLMENT_WORKLIST_SERVICE_TOKEN)
    private readonly worklist: IFulfillmentWorklistService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService
  ) {}

  async listBenchWork(): Promise<BenchWorkListView> {
    const executors = await this.resolvePackingExecutors();

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
   * Every active connection an operator has switched packing on for.
   *
   * A connection that is not `active` is excluded: routing cannot dispatch to
   * it, so listing its work at a bench would show parcels nothing will ever
   * hand over.
   */
  private async resolvePackingExecutors(): Promise<Connection[]> {
    const connections = await this.connections.list();
    const executors: Connection[] = [];

    for (const connection of connections) {
      if (connection.status !== 'active') continue;
      if (!connection.enabledCapabilities.includes(PACKING_CAPABILITY)) continue;
      if (await this.isOpenLinkerExecutor(connection)) executors.push(connection);
    }
    return executors;
  }

  /**
   * Is this connection OpenLinker's own packing executor?
   *
   * Through the registry, comparing the RESOLVED adapter key — see the module
   * docblock for why a bare `connection.adapterKey` compare matches nothing.
   *
   * A connection whose adapter cannot be resolved is reported as "not the
   * executor" rather than failing the whole read: an unrelated plugin that is
   * unregistered in this process must not be able to blank a packer's screen.
   */
  private async isOpenLinkerExecutor(connection: Connection): Promise<boolean> {
    try {
      const metadata = await this.integrations.resolveAdapterMetadata({
        platformType: connection.platformType,
        adapterKey: connection.adapterKey,
      });
      return metadata.adapterKey === OMS_ADAPTER_KEY;
    } catch (error) {
      this.logger.warn(
        `Could not resolve adapter metadata for connection ${connection.id}; not treating it ` +
          `as a packing connection: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
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
        status: BENCH_STATUSES,
        // Story B1's "accepted": a parcel the executor has not taken on is not
        // this bench's work yet, and one it rejected never will be.
        requestStatus: ['accepted'],
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
    // Heldness comes from the hold rows, never from `status` — see BENCH_STATUSES.
    const state: BenchWorkState =
      work.status === 'cancelled' ? 'cancelled' : work.activeHolds.length > 0 ? 'held' : 'packable';

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

/** A non-empty trimmed string, or `undefined`. */
function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The source's own order reference, when the snapshot carries one.
 *
 * `orderNumber` is what a marketplace calls the order and what a packer reads
 * back to a colleague. Absent, the caller falls back to the internal id, which
 * is always there — so the row never renders a blank where its identity goes.
 */
function readOrderReference(order: OrderRecord | undefined): string | undefined {
  if (order === undefined) return undefined;
  const snapshot = order.orderSnapshot;
  return readString(snapshot.orderNumber);
}

/**
 * The buyer's name from the snapshot's shipping address, then its billing one.
 *
 * `null` is an ordinary answer, not a failure: under `OL_STORE_PII=false` the
 * persisted address is redacted, so there is no name to report and the surface
 * renders none. Shipping is preferred over billing because it is the name that
 * goes on the parcel.
 *
 * Nothing else is taken from either address — no street, no city, no postcode,
 * no phone — which is the whole reason this reads two named fields instead of
 * projecting an address.
 */
function readBuyerName(order: OrderRecord | undefined): string | null {
  if (order === undefined) return null;
  const snapshot = order.orderSnapshot;

  for (const key of ['shippingAddress', 'billingAddress']) {
    const address = snapshot[key];
    if (typeof address !== 'object' || address === null) continue;
    const record = address as Record<string, unknown>;
    const name = [readString(record.firstName), readString(record.lastName)]
      .filter((part): part is string => part !== undefined)
      .join(' ');
    if (name.length > 0) return name;
    const company = readString(record.company);
    if (company !== undefined) return company;
  }
  return null;
}
