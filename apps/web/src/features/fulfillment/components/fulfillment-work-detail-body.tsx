/**
 * Fulfilment work detail body (#3100; rebuilt to the mockup's box model by
 * #3096)
 *
 * Two columns, every section a card. The LEFT column is the reviewed mockup
 * (`docs/plans/mockups/fulfillment-work-detail-3096.html`, `#detailView`),
 * section for section: the hero, "Why it's stuck", "What's in this task",
 * "Details" and the action card. The RIGHT column is what the mockup did not
 * draw, built from modules that already exist elsewhere rather than new
 * variations of them: the Packer card (`assign-packing-work.html`), and the
 * order page's own `OrderShipmentPanel`, `SalesDocumentPanel` and
 * `OrderTotalsPanel`, fed by ONE order read for all three.
 *
 * ## The grid is the order page's, and so is the column ratio
 *
 * `.order-detail__primary-grid--split` + `.order-detail__stack` — the same
 * 60/40 split the order detail uses at ≥ 1024 px, so the two pages read as one
 * product. Below that the grid is one column, and the two stacks dissolve
 * (`display: contents`) so the cards can be put in the mobile order the
 * analysis set: hero → holds → lines → packer → shipment → sales document →
 * payment → details → actions. The DOM order is the desktop reading order, so
 * a screen reader meets the task before the modules beside it.
 *
 * ## `activeHolds` is THE authority on heldness, and it gates the holds card
 *
 * Nothing in the backend writes `status = 'on_hold'` (#2406), so a held task
 * reads `status: 'open'` with a non-empty `activeHolds`. The holds card is
 * keyed on the array alone, and when it is empty the card is ABSENT — not a
 * heading over nothing.
 *
 * ## The hold's actor is not rendered, because it is not projected
 *
 * `FulfillmentHoldResponseDto` withholds `placedByService` and carries no
 * `placedByUserId` (#2406). This surface says what was asked and when, and
 * stays silent about who.
 *
 * ## Nothing here reads `supportedActions`
 *
 * These sections describe the task; the action card's controls are composed
 * by the page from `FulfillmentTaskActions`, which renders the server's list
 * as served (`scripts/check-no-supported-actions-mirror.mjs`).
 *
 * ## The counters are DISPLAY-ONLY, and the caveat says so once
 *
 * `recordLineProgress` moves `fulfilledQuantity` without bumping the header
 * `version` (#2400), so a count on screen can legitimately be stale. The
 * caveat sits under the list, once per page rather than once per line.
 *
 * ## Delivery is a carrier name, never an id
 *
 * `task.deliveryMethod` is the source's delivery-method id — a UUID on Allegro
 * — and the page used to print it as the fact. The row now reads the
 * resolved `carrierName` (or the order's own delivery-method name) and is
 * absent when neither is known, rather than showing an id nobody can read.
 *
 * ## Location renders only where there is more than one
 *
 * With a single warehouse the Location fact names the same place on every
 * task. It, and the location in the hero's sub-line, render only when the
 * install has more than one active location (`useHasMultipleLocations`).
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement, ReactNode } from 'react';

import { ApiError } from '../../../shared/api/api-error';
import { usePlatforms } from '../../../shared/plugins';
import { distinguishingAttributeKeys, narrowAttributes } from '../../../shared/lib/variant-attributes';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { DetailSection } from '../../../shared/ui/detail-section';
import { shortenId } from '../../../shared/ui/entity-label';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { ConnectionEntityLabel, useConnectionQuery } from '../../connections';
import { resolvePlatformLabel } from '../../mappings';
import {
  holdReasonLabel,
  OrderShipmentPanel,
  OrderTotalsPanel,
  parseOrderSnapshot,
  SalesDocumentPanel,
  useOrderQuery,
  type OrderRecord,
} from '../../orders';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { useHasMultipleLocations } from '../hooks/use-has-multiple-locations';
import {
  FULFILLMENT_EXPEDITED_BADGE,
  fulfillmentRequestStatusLabel,
  fulfillmentStatusLabel,
} from '../lib/fulfillment-task.copy';
import { FULFILLMENT_WORK_DETAIL_COPY } from '../lib/fulfillment-work-detail.copy';
import { summariseFulfillmentWork } from '../lib/fulfillment-work-summary';
import { FulfillmentLineIdentity } from './fulfillment-line-identity';
import { FulfillmentWorkPackerSection } from './fulfillment-work-packer-section';

const COPY = FULFILLMENT_WORK_DETAIL_COPY;

/**
 * The OMS's own `platformType` (#2405, ADR-055). A local `const` rather than a
 * literal at the comparison site: `no-restricted-syntax` bans literal
 * platformType dispatch outside `apps/web/src/plugins/` (#578/#579).
 */
const OMS_PLATFORM_TYPE = 'openlinker';

export interface FulfillmentWorkDetailBodyProps {
  /** The loaded task. The page mounts this only on its loaded branch. */
  task: FulfillmentTask;
  /** The action card, composed by the page, which owns the action runner and its dialog. */
  actions: ReactNode;
  /** Whether staffing controls render (`useWriteAccess().visible`). */
  canStaff: boolean;
  /** Rendered but disabled — the demo-viewer state (#1615). */
  readOnly: boolean;
}

/** Who is executing the task, resolved once for the hero's sub-line and its sentence. */
interface ExecutorFacts {
  /** The connection's display name, when it resolved. Feeds the summary sentence. */
  readonly name: string | null;
  /** What the sub-line says about the executor, or `null` while it is loading. */
  readonly label: string | null;
}

function useExecutorFacts(task: FulfillmentTask): ExecutorFacts {
  const connectionId = task.assignedConnectionId;
  // Called unconditionally (hooks run in one order every render); `enabled`
  // does the skipping when there is no id to look up.
  const connectionQuery = useConnectionQuery(connectionId ?? '', {
    enabled: connectionId !== null,
  });
  const platforms = usePlatforms();

  if (connectionId === null) return { name: null, label: COPY.executor.unassigned };
  if (connectionQuery.data) {
    const connection = connectionQuery.data;
    if (connection.platformType === OMS_PLATFORM_TYPE) {
      return { name: connection.name, label: connection.name };
    }
    return {
      name: connection.name,
      label: `${connection.name} · ${COPY.executor.externalPartner} — ${resolvePlatformLabel(platforms, connection)}`,
    };
  }
  if (connectionQuery.isPending) return { name: null, label: null };
  // A deleted or unreadable connection must not make the sub-line go blank:
  // a blank reads as "nobody is handling this", which this build cannot say.
  const isNotFound = connectionQuery.error instanceof ApiError && connectionQuery.error.isNotFound();
  return { name: null, label: isNotFound ? shortenId(connectionId) : COPY.executor.unavailable };
}

/**
 * The hero: the sub-line (task id · executor · location), the headline (both
 * axes joined, 22 px / 700, as the mockup draws it), the expedited pill beside
 * it, and the derived sentence.
 *
 * Both axis labels always render. Heldness lives in `activeHolds` and nothing
 * writes `status: 'on_hold'`, so neither axis can be dropped without the page
 * losing a fact the other one cannot carry.
 */
function WorkDetailHero({
  task,
  executor,
  showLocation,
}: {
  task: FulfillmentTask;
  executor: ExecutorFacts;
  showLocation: boolean;
}): ReactElement {
  const summary = summariseFulfillmentWork({
    status: task.status,
    requestStatus: task.requestStatus,
    activeHoldCount: task.activeHolds.length,
    locationId: task.locationId,
    expeditedAt: task.expeditedAt ?? null,
    cancellationReason: task.cancellationReason,
    executorName: executor.name,
  });
  const location = showLocation ? (task.locationName ?? task.locationId ?? COPY.facts.noLocation) : null;
  const subParts = [executor.label, location].filter((part): part is string => part !== null);
  const expeditedAt = task.expeditedAt ?? null;

  return (
    <DetailSection tone="hero" className="fulfilment-work-detail__slot--hero" data-testid="work-detail-hero">
      <p className="fulfilment-work-detail__hero-sub">
        <span className="mono-text" title={task.id}>
          {shortenId(task.id)}
        </span>
        {subParts.map((part) => (
          <span key={part}> · {part}</span>
        ))}
      </p>
      <div className="fulfilment-work-detail__hero-row">
        <p className="fulfilment-work-detail__headline">
          {fulfillmentStatusLabel(task.status)} · {fulfillmentRequestStatusLabel(task.requestStatus)}
        </p>
        {/* Display only (#3247): which expedite verb is offered comes from
            `supportedActions`. The wording is the card's own, one fact one
            wording. */}
        {expeditedAt !== null ? (
          <span className="fulfilment-work-detail__expedited" data-testid="expedited-badge">
            <span aria-hidden="true">⚡ </span>
            {FULFILLMENT_EXPEDITED_BADGE} · <TimeDisplay iso={expeditedAt} format="datetime" />
          </span>
        ) : null}
      </div>
      {/* `null` when this build cannot say — the headline above still carries
          both axes, so the hero is never blank. */}
      {summary !== null ? <p className="fulfilment-work-detail__summary">{summary}</p> : null}
    </DetailSection>
  );
}

/** "Why it's stuck" — one compact banner per active hold, or no card at all. */
function WorkHoldsSection({ task }: { task: FulfillmentTask }): ReactElement | null {
  if (task.activeHolds.length === 0) return null;

  return (
    <DetailSection
      title={COPY.sections.holds}
      aria-label={COPY.sections.holds}
      className="fulfilment-work-detail__slot--holds"
    >
      <div className="fulfilment-work-detail__holds">
        {task.activeHolds.map((hold) => (
          <Alert key={hold.id} tone="warning" density="compact" title={holdReasonLabel(hold.reason)}>
            <div className="fulfilment-work-detail__hold-body">
              {/* Operator-authored text, rendered verbatim. Absent is absent. */}
              {hold.note ? <span>{hold.note}</span> : null}
              <span>
                {COPY.holds.since} <TimeDisplay iso={hold.placedAt} format="datetime" />
              </span>
            </div>
          </Alert>
        ))}
      </div>
    </DetailSection>
  );
}

/** "What's in this task" — a product card per line, its counts, and the stale-count caveat. */
function WorkLinesSection({ task }: { task: FulfillmentTask }): ReactElement {
  // Narrowed across THIS task's lines: an attribute every line shares tells
  // the operator nothing about which box is which (`variant-attributes.ts`).
  const distinguishing = distinguishingAttributeKeys(
    task.lines.map((line) => ({ attributes: line.attributes ?? null }))
  );

  return (
    <DetailSection
      title={COPY.sections.lines}
      aria-label={COPY.sections.lines}
      className="fulfilment-work-detail__slot--lines"
    >
      {task.lines.length > 0 ? (
        <>
          <ul className="fulfilment-work-detail__lines">
            {task.lines.map((line) => {
              // Reinforcement, never the only signal: the two numbers beside
              // it already say the line is complete.
              const done = line.fulfilledQuantity >= line.totalQuantity;

              return (
                <li key={line.id} className="fulfilment-work-detail__line">
                  <FulfillmentLineIdentity
                    line={line}
                    attributes={narrowAttributes(line.attributes ?? null, distinguishing)}
                  />
                  <span className="fulfilment-work-detail__line-count">
                    {line.fulfilledQuantity} / {line.totalQuantity}
                    {line.cancelledQuantity > 0
                      ? ` ${COPY.lines.cancelledSuffix(line.cancelledQuantity)}`
                      : ''}
                    {done ? (
                      <span aria-hidden="true" className="fulfilment-work-detail__line-done">
                        {' '}
                        ✓
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="fulfilment-work-detail__note text-muted">{COPY.lines.caveat}</p>
        </>
      ) : (
        <p className="text-muted">{COPY.lines.empty}</p>
      )}
    </DetailSection>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="fulfilment-work-detail__fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * "Details" — the reference facts, in the mockup's order, then what the bench
 * has done to the box (#3096, G02-3).
 *
 * The bench rows render only when the API carries them (`undefined` against an
 * older API leaves the rows absent rather than claiming the parcel is open),
 * and "Channel notified" only once the parcel is closed — before that there is
 * nothing to notify the channel about.
 */
function WorkFactsSection({
  task,
  order,
  showLocation,
}: {
  task: FulfillmentTask;
  order: OrderRecord | undefined;
  showLocation: boolean;
}): ReactElement {
  const delivery = task.carrierName ?? order?.sourceDeliveryMethodName ?? null;
  const parcelClosedAt = task.parcelClosedAt;
  const completedAt = task.completedAt ?? null;

  return (
    <DetailSection
      title={COPY.sections.facts}
      aria-label={COPY.sections.facts}
      className="fulfilment-work-detail__slot--facts"
    >
      <dl className="fulfilment-work-detail__facts">
        <Fact label={COPY.facts.state}>{fulfillmentStatusLabel(task.status)}</Fact>
        <Fact label={COPY.facts.handshake}>{fulfillmentRequestStatusLabel(task.requestStatus)}</Fact>
        {showLocation ? (
          <Fact label={COPY.facts.location}>
            {task.locationName ?? task.locationId ?? COPY.facts.noLocation}
          </Fact>
        ) : null}
        {delivery !== null ? <Fact label={COPY.facts.delivery}>{delivery}</Fact> : null}
        {task.externalWorkId ? (
          <Fact label={COPY.facts.externalReference}>
            <span className="mono-text">{task.externalWorkId}</span>
          </Fact>
        ) : null}
        <Fact label={COPY.facts.started}>
          <TimeDisplay iso={task.createdAt} format="datetime" />
        </Fact>
        {parcelClosedAt === undefined ? null : parcelClosedAt === null ? (
          <Fact label={COPY.facts.parcel}>{COPY.facts.parcelOpen}</Fact>
        ) : (
          <>
            <Fact label={COPY.facts.parcelClosed}>
              <TimeDisplay iso={parcelClosedAt} format="datetime" />
            </Fact>
            <Fact label={COPY.facts.channelNotified}>
              {task.channelNotifiedAt ? (
                <TimeDisplay iso={task.channelNotifiedAt} format="datetime" />
              ) : (
                <span className="fulfilment-work-detail__fact-warning">{COPY.facts.channelNotYet}</span>
              )}
            </Fact>
          </>
        )}
        {completedAt !== null ? (
          <Fact label={COPY.facts.completed}>
            <TimeDisplay iso={completedAt} format="datetime" />
          </Fact>
        ) : null}
      </dl>
    </DetailSection>
  );
}

/** A placeholder card for a rail module whose order is still loading. */
function RailSkeleton({ slot }: { slot: string }): ReactElement {
  return (
    <DetailSection className={`fulfilment-work-detail__slot--${slot}`} aria-hidden="true">
      <span className="data-table-skeleton__bar data-table-skeleton__bar--title" />
      <span className="data-table-skeleton__bar data-table-skeleton__bar--subtitle" />
    </DetailSection>
  );
}

/**
 * The order page's own modules for this task's order: shipment, sales
 * document and payment, from ONE `useOrderQuery`.
 *
 * Per ORDER, not per task: `OrderShipmentPanel` reads the order's shipments.
 * With one warehouse an order has one task, so the two are the same set; when
 * multi-warehouse sourcing ships, the panel grows a `fulfillmentWorkId`
 * filter (`shipments.fulfillmentWorkId`, #2402) rather than this page growing
 * a second shipment panel.
 */
function WorkOrderModules({ task }: { task: FulfillmentTask }): ReactElement {
  const orderQuery = useOrderQuery(task.orderId);

  if (orderQuery.isPending) {
    return (
      <>
        <RailSkeleton slot="shipment" />
        <RailSkeleton slot="payment" />
      </>
    );
  }

  // A failed read, or a read that answered nothing — an order the API no
  // longer has — gets the same quiet card. The task is still the page; the
  // modules beside it are context it can do without.
  if (orderQuery.isError || !orderQuery.data) {
    return (
      <DetailSection className="fulfilment-work-detail__slot--shipment">
        <p className="text-muted fulfilment-work-detail__order-unavailable">{COPY.order.unavailable}</p>
        <Button
          tone="secondary"
          onClick={() => {
            void orderQuery.refetch();
          }}
        >
          {COPY.order.retry}
        </Button>
      </DetailSection>
    );
  }

  const order = orderQuery.data;
  const { totals } = parseOrderSnapshot(order.orderSnapshot);

  return (
    <>
      {/* The same anchor wrappers the order page uses, so a `#shipment` deep
          link works here too and a capability-gated panel still leaves its
          target in place. */}
      <div id="shipment" tabIndex={-1} className="fulfilment-work-detail__slot--shipment">
        <OrderShipmentPanel order={order} />
      </div>
      <div id="invoicing" tabIndex={-1} className="fulfilment-work-detail__slot--invoicing">
        <SalesDocumentPanel order={order} />
      </div>
      <DetailSection
        title={COPY.sections.payment}
        aria-label={COPY.sections.payment}
        className="fulfilment-work-detail__slot--payment"
      >
        {totals === undefined ? (
          <p className="text-muted">{COPY.payment.unavailable}</p>
        ) : (
          <OrderTotalsPanel totals={totals} />
        )}
        <p className="fulfilment-work-detail__payment-source">
          <span className="text-muted">{COPY.payment.placedOn}</span>{' '}
          <ConnectionEntityLabel connectionId={order.sourceConnectionId} showId={false} />
        </p>
      </DetailSection>
    </>
  );
}

export function FulfillmentWorkDetailBody({
  task,
  actions,
  canStaff,
  readOnly,
}: FulfillmentWorkDetailBodyProps): ReactElement {
  const showLocation = useHasMultipleLocations();
  const executor = useExecutorFacts(task);
  // The facts card reads the order's delivery-method name as a fallback. The
  // query is shared with `WorkOrderModules` through the cache — one request.
  const orderQuery = useOrderQuery(task.orderId);

  return (
    <div className="order-detail__primary-grid order-detail__primary-grid--split fulfilment-work-detail__layout">
      <div className="order-detail__stack fulfilment-work-detail__main">
        <WorkDetailHero task={task} executor={executor} showLocation={showLocation} />
        <WorkHoldsSection task={task} />
        <WorkLinesSection task={task} />
        <WorkFactsSection task={task} order={orderQuery.data} showLocation={showLocation} />
        {actions}
      </div>
      <div className="order-detail__stack fulfilment-work-detail__rail">
        <div className="fulfilment-work-detail__slot--packer">
          <FulfillmentWorkPackerSection task={task} canStaff={canStaff} readOnly={readOnly} />
        </div>
        <WorkOrderModules task={task} />
      </div>
    </div>
  );
}
