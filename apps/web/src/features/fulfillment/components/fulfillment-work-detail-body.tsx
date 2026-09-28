/**
 * Fulfilment work detail body (#3100, holder panel added by #3291, shipment
 * + payment panels added by #3292/#3293)
 *
 * The stacked sections: "Why it's stuck" (one banner per active hold),
 * "Who's handling this" (the resolved executor, #3291), "Shipment" (label +
 * carrier + tracking, #3292), "Payment" (order total, currency and source
 * channel — deliberately no COD/prepaid claim, #3293), "What's in this task"
 * (the line list plus the stale-counter caveat) and "Details" (the fact
 * grid). The original four are transcribed from `renderDetailView` in
 * `docs/plans/mockups/fulfillment-work-detail-3096.html`; "Shipment" and
 * "Payment" follow the epic's addendum design ("The Manifest") rather than
 * that mockup, which predates them.
 *
 * ## `activeHolds` is THE authority on heldness, and it is what gates section one
 *
 * Nothing in the backend writes `status = 'on_hold'` (#2406), so a held task
 * reads `status: 'open'` with a non-empty `activeHolds`. The holds section is
 * therefore keyed on the array alone and never on the status axis. When it is
 * empty the section is ABSENT — not a heading over nothing, which would read
 * to an operator as "we looked and something is stuck but we cannot say
 * what".
 *
 * ## The hold's actor is not rendered, because it is not projected
 *
 * `FulfillmentHoldResponseDto` withholds `placedByService` as an internal
 * actor and carries no `placedByUserId` (#2406). Rendering only the user arm
 * of that XOR would attribute every service-placed hold to nobody. This
 * surface says what was asked and when, and stays silent about who — the same
 * rule `fulfillment-task-card.tsx` already follows.
 *
 * ## Nothing here reads `supportedActions`
 *
 * These sections describe the task; they offer no control, so no legality
 * decision is taken or mirrored (DESIGN §5.2, and
 * `scripts/check-no-supported-actions-mirror.mjs`). The action bar is
 * #3101's.
 *
 * ## The counters are DISPLAY-ONLY, and the caveat says so once
 *
 * `recordLineProgress` moves `fulfilledQuantity` without bumping the header
 * `version` (#2400), so a count on screen can legitimately be stale.
 * `COPY.lines.caveat` is the byte-identical sentence
 * `fulfillment-task-card.tsx` already renders inline — one fact, one wording.
 * It sits under the list, once per page rather than once per line, and only
 * where counts are — a task with no lines has no counts to be behind.
 *
 * ## Two deliberate divergences from the mockup
 *
 * 1. The Location row ALWAYS renders, carrying `facts.noLocation` when the
 *    task has no location. The mockup pushes the row only
 *    `if (task.locationId)`; a row that names the absent fact beats one that
 *    silently disappears (divergence 5 in the copy table's own docblock).
 * 2. The location renders `task.locationName` when the backend resolved one
 *    (#3426), falling back to the RAW id in mono when it has not — the
 *    assign board's own card reads the same field the same way. There is no
 *    separate location lookup here: `GET /fulfillment/works` and
 *    `GET /fulfillment/works/:workId` share one projection, and that
 *    projection already carries the operator-authored name (#3258).
 *
 * The hold's instant is RELATIVE, matching the shipped task card. The fact
 * grid is also real `<dt>`/`<dd>` rather than the mockup's spans inside a
 * `<dl>` — semantic HTML first, and the shipped card already does it.
 *
 * ## "Who's handling this" (#3291)
 *
 * `task.assignedConnectionId` was on the DTO and read by nothing anywhere in
 * this feature — the hero's `summariseFulfillmentWork` call always passes
 * `executorName: null`, so the derived sentence never actually names a
 * connection. This section is the one place that lookup runs: it calls
 * `useConnectionQuery`, skipping the fetch entirely when the task is
 * unassigned, and is the reason the fact grid still carries no connection row
 * — a row here AND a sentence in the hero would be the same fact stated
 * twice.
 *
 * Four states, and every one of them renders something rather than nothing:
 * unassigned (no id to look up), loading (the fetch is in flight), a failed
 * lookup (the raw id, because a deleted or renamed connection must not make
 * the panel disappear), and loaded (the connection's name, plus whether it is
 * OpenLinker's own OMS executing the task in-house or an external partner).
 * The in-house check is `connection.platformType === OMS_PLATFORM_TYPE` — a
 * local `const`, never a literal on the right of `===`, because
 * `no-restricted-syntax` bans literal platformType dispatch outside
 * `apps/web/src/plugins/` (#578/#579).
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../../../shared/api/api-error';
import { formatAmount } from '../../../shared/format/format-amount';
import { usePlatforms } from '../../../shared/plugins';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { ConnectionEntityLabel, useConnectionQuery } from '../../connections';
import { resolvePlatformLabel } from '../../mappings';
import { holdReasonLabel, parseOrderSnapshot, useOrderQuery } from '../../orders';
import {
  buildCarrierTrackingUrl,
  getCarrierDisplayName,
  ShipmentStatusBadge,
  type Shipment,
} from '../../shipments';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { useFulfillmentWorkShipmentsQuery } from '../hooks/use-fulfillment-work-shipments-query';
import {
  fulfillmentRequestStatusLabel,
  fulfillmentStatusLabel,
} from '../lib/fulfillment-task.copy';
import { FULFILLMENT_WORK_DETAIL_COPY } from '../lib/fulfillment-work-detail.copy';

const COPY = FULFILLMENT_WORK_DETAIL_COPY;

/**
 * The OMS's own `platformType` (#2405, ADR-055). A local `const` rather than
 * a literal at the comparison site — see the module docblock for why that is
 * not decoration.
 */
const OMS_PLATFORM_TYPE = 'openlinker';

export interface FulfillmentWorkDetailBodyProps {
  /** The loaded task. The page mounts this only on its loaded branch. */
  task: FulfillmentTask;
}

/**
 * "Why it's stuck" — one warning banner per active hold, or nothing at all.
 *
 * `Alert` rather than a bespoke banner rule: the mockup's `.hold-banner` is a
 * warning-tinted box with a bold title and a muted body, which is what
 * `alert--warning` already is. A second rule of the same shape is one more
 * thing to drift.
 */
function WorkHoldsSection({ task }: FulfillmentWorkDetailBodyProps): ReactElement | null {
  if (task.activeHolds.length === 0) return null;

  return (
    <section className="fulfilment-work-detail__section">
      <h3 className="fulfilment-work-detail__section-title">{COPY.sections.holds}</h3>
      <div className="fulfilment-work-detail__holds">
        {task.activeHolds.map((hold) => (
          <Alert key={hold.id} tone="warning" title={holdReasonLabel(hold.reason)}>
            <div className="fulfilment-work-detail__hold-body">
              {/* Operator-authored text, rendered verbatim. Absent is absent
                  — there is no stand-in sentence for a hold nobody annotated. */}
              {hold.note ? <span>{hold.note}</span> : null}
              <span>
                {COPY.holds.since} <TimeDisplay iso={hold.placedAt} format="relative" />
              </span>
            </div>
          </Alert>
        ))}
      </div>
    </section>
  );
}

/**
 * "Who's handling this" — resolves `task.assignedConnectionId` and reports
 * one of four states. See the module docblock for why this is a section of
 * its own rather than a row folded into "Details" or a rewrite of the hero's
 * summary sentence.
 *
 * `useConnectionQuery` is called UNCONDITIONALLY (hooks must run in the same
 * order on every render), with `enabled: false` doing the actual skipping
 * when there is no id to look up.
 */
function WorkExecutorSection({ task }: FulfillmentWorkDetailBodyProps): ReactElement {
  const connectionId = task.assignedConnectionId;
  const connectionQuery = useConnectionQuery(connectionId ?? '', {
    enabled: connectionId !== null,
  });
  const platforms = usePlatforms();

  let body: ReactElement;
  if (connectionId === null) {
    // A real, reachable state — a `scheduled`/`unsubmitted` task has no
    // executing connection yet, and that is not an error condition.
    body = <p className="text-muted">{COPY.executor.unassigned}</p>;
  } else if (connectionQuery.data) {
    const connection = connectionQuery.data;
    const isInHouse = connection.platformType === OMS_PLATFORM_TYPE;
    body = (
      <div className="fulfilment-work-detail__executor">
        <span className="fulfilment-work-detail__executor-name">{connection.name}</span>
        {isInHouse ? (
          <span className="text-muted">{COPY.executor.inHouse}</span>
        ) : (
          <span className="fulfilment-work-detail__executor-partner">
            {COPY.executor.externalPartner} — {resolvePlatformLabel(platforms, connection)}
          </span>
        )}
      </div>
    );
  } else if (connectionQuery.isPending) {
    body = <p className="text-muted">{COPY.executor.loading}</p>;
  } else {
    // Never nothing: a deleted/renamed connection (404) or any other failed
    // read still surfaces the raw id, because a panel that vanishes on
    // failure reads as "nobody is handling this" — a claim this build cannot
    // support either way.
    const isNotFound =
      connectionQuery.error instanceof ApiError && connectionQuery.error.isNotFound();
    body = (
      <p className="fulfilment-work-detail__executor-removed">
        <span className="mono-text">{connectionId}</span>
        <span className="text-muted">
          {isNotFound ? COPY.executor.removed : COPY.executor.unavailable}
        </span>
      </p>
    );
  }

  return (
    <section className="fulfilment-work-detail__section">
      <h3 className="fulfilment-work-detail__section-title">{COPY.sections.executor}</h3>
      {body}
    </section>
  );
}

/**
 * "Shipment" (#3292) — the label/carrier/tracking state for this task's own
 * dispatch, via `shipments.fulfillmentWorkId` (#2402).
 *
 * The `Create a label` CTA links to `/orders/:orderId#shipment` rather than
 * re-implementing the label-generation dialog on this page — the existing
 * order-detail flow already collects the recipient and parcel fields
 * (weight, dimensions) a label needs, which are operator-typed and have no
 * source this page could derive them from, so a duplicate dialog here would
 * either omit them or re-ask for the same thing twice.
 *
 * The CTA is gated on the SAME `connectionId`/in-house check
 * `WorkExecutorSection` already makes — a 3rd-party holder ships on its own,
 * and offering the button there would invite a duplicate shipment for a
 * parcel the partner is already handling.
 */
function WorkShipmentSection({ task }: FulfillmentWorkDetailBodyProps): ReactElement {
  const shipmentsQuery = useFulfillmentWorkShipmentsQuery(task.id);
  const connectionQuery = useConnectionQuery(task.assignedConnectionId ?? '', {
    enabled: task.assignedConnectionId !== null,
  });
  const isOlExecuted = connectionQuery.data?.platformType === OMS_PLATFORM_TYPE;

  // Newest first, already the API's own ordering (#3292's controller sorts
  // before responding) — `[0]` is therefore the CURRENT attempt on an
  // append-only cancel-and-re-issue history, never an arbitrary one.
  const shipment = shipmentsQuery.data?.[0];
  // Only the two fields `buildCarrierTrackingUrl` reads — never the full
  // `features/shipments` `Shipment` shape, which this narrower projection
  // does not carry.
  const trackingUrl =
    shipment === undefined
      ? null
      : buildCarrierTrackingUrl({
          trackingNumber: shipment.trackingNumber,
          carrier: shipment.carrier,
        } as Shipment);

  const body = ((): ReactElement => {
    if (shipmentsQuery.isPending) {
      return <p className="text-muted">{COPY.shipment.loading}</p>;
    }
    if (shipmentsQuery.isError) {
      return <p className="text-muted">{COPY.shipment.unavailable}</p>;
    }
    if (shipment === undefined) {
      return (
        <div className="fulfilment-work-detail__shipment-empty">
          <p className="text-muted">{COPY.shipment.none}</p>
          {/* Never for a 3rd-party holder — they ship on their own, and this
              button would invite a duplicate shipment for a parcel already
              being handled. */}
          {isOlExecuted ? (
            <Link to={`/orders/${task.orderId}#shipment`} className="link">
              <Button tone="secondary" className="button--sm">
                {COPY.shipment.createLabel}
              </Button>
            </Link>
          ) : null}
        </div>
      );
    }

    const carrierLabel = getCarrierDisplayName(shipment.carrier);

    return (
      <>
        <dl className="fulfilment-work-detail__facts">
          <div>
            <dt>{COPY.shipment.status}</dt>
            <dd>
              <ShipmentStatusBadge status={shipment.status} />
            </dd>
          </div>
          {carrierLabel ? (
            <div>
              <dt>{COPY.shipment.carrier}</dt>
              <dd>{carrierLabel}</dd>
            </div>
          ) : null}
          {shipment.trackingNumber ? (
            <div>
              <dt>{COPY.shipment.trackingNumber}</dt>
              <dd className="mono-text">{shipment.trackingNumber}</dd>
            </div>
          ) : null}
        </dl>
        {/* A shipment row with no label yet — a draft that has not reached
            the provider, or one whose provider call failed. Outside the
            `<dl>` rather than a labelless row inside it. */}
        {!shipment.hasLabel ? (
          <p className="text-muted">{COPY.shipment.noLabelYet}</p>
        ) : null}
      </>
    );
  })();

  return (
    <section className="fulfilment-work-detail__section">
      <h3 className="fulfilment-work-detail__section-title">{COPY.sections.shipment}</h3>
      {body}
      {trackingUrl ? (
        <p>
          <a href={trackingUrl} target="_blank" rel="noreferrer" className="link">
            {COPY.shipment.trackParcel}
          </a>
        </p>
      ) : null}
    </section>
  );
}

/**
 * "Payment" (#3293) — narrowed deliberately: total, currency and the source
 * channel, never a COD/prepaid claim this build cannot support. See the
 * copy table's own docblock and #3294, the named follow-up.
 *
 * Resolves the task's own order via `useOrderQuery` (exported from
 * `features/orders` for exactly this) and `parseOrderSnapshot` — the SAME
 * read `order-detail-page.tsx` already uses for its own totals panel, never
 * a second one.
 */
function WorkPaymentSection({ task }: FulfillmentWorkDetailBodyProps): ReactElement {
  const orderQuery = useOrderQuery(task.orderId);

  const body = ((): ReactElement => {
    if (orderQuery.isPending) {
      return <p className="text-muted">{COPY.executor.loading}</p>;
    }
    if (orderQuery.isError) {
      return <p className="text-muted">{COPY.payment.unavailable}</p>;
    }

    const { totals } = parseOrderSnapshot(orderQuery.data.orderSnapshot);
    if (totals === undefined) {
      return <p className="text-muted">{COPY.payment.unavailable}</p>;
    }

    return (
      <p>
        <span className="mono-text">{formatAmount(totals.total, totals.currency)}</span>
        {' · '}
        {COPY.payment.placedOn}{' '}
        <ConnectionEntityLabel connectionId={orderQuery.data.sourceConnectionId} showId={false} />
      </p>
    );
  })();

  return (
    <section className="fulfilment-work-detail__section">
      <h3 className="fulfilment-work-detail__section-title">{COPY.sections.payment}</h3>
      {body}
      <p className="fulfilment-work-detail__note text-muted">{COPY.payment.followUpNote}</p>
    </section>
  );
}

/** "What's in this task" — the line list, its counts, and the stale-count caveat. */
function WorkLinesSection({ task }: FulfillmentWorkDetailBodyProps): ReactElement {
  return (
    <section className="fulfilment-work-detail__section">
      <h3 className="fulfilment-work-detail__section-title">{COPY.sections.lines}</h3>
      {task.lines.length > 0 ? (
        <>
          <ul className="fulfilment-work-detail__lines">
            {task.lines.map((line) => {
              // Reinforcement, never the only signal: the two numbers beside
              // it already say the line is complete, which is why the glyph
              // is decorative and hidden from assistive technology.
              const done = line.fulfilledQuantity >= line.totalQuantity;

              return (
                <li key={line.id} className="fulfilment-work-detail__line">
                  <span className="mono-text">{line.productVariantId}</span>
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
          {/* Byte-identical to the card's own caveat — once, under the counts
              it is about. A task with no lines has no count to be behind. */}
          <p className="fulfilment-work-detail__note text-muted">{COPY.lines.caveat}</p>
        </>
      ) : (
        <p className="text-muted">{COPY.lines.empty}</p>
      )}
    </section>
  );
}

/**
 * "Details" — the reference facts, in the mockup's order.
 *
 * The connection executing the task is deliberately NOT a row here: it has
 * its own section now, `WorkExecutorSection` above (#3291) — a row in this
 * grid AND a dedicated panel would state the same fact twice.
 */
function WorkFactsSection({ task }: FulfillmentWorkDetailBodyProps): ReactElement {
  return (
    <section className="fulfilment-work-detail__section">
      <h3 className="fulfilment-work-detail__section-title">{COPY.sections.facts}</h3>
      <dl className="fulfilment-work-detail__facts">
        {/* Both axes, always. Heldness lives in `activeHolds`, so neither of
            these can be dropped without losing a fact the other cannot
            carry. */}
        <div>
          <dt>{COPY.facts.state}</dt>
          <dd>{fulfillmentStatusLabel(task.status)}</dd>
        </div>
        <div>
          <dt>{COPY.facts.handshake}</dt>
          <dd>{fulfillmentRequestStatusLabel(task.requestStatus)}</dd>
        </div>
        <div>
          <dt>{COPY.facts.location}</dt>
          {/* `task.locationName` when the backend resolved one (#3426),
              falling back to the raw id in mono — see divergence 2 above. */}
          {task.locationId ? (
            <dd className={task.locationName ? undefined : 'mono-text'}>
              {task.locationName ?? task.locationId}
            </dd>
          ) : (
            <dd className="text-muted">{COPY.facts.noLocation}</dd>
          )}
        </div>
        {/* Delivery and the external reference stay conditional, as the
            mockup has them: there is no copy for an absent one, and
            inventing a stand-in sentence is what the copy table exists to
            prevent. */}
        {task.deliveryMethod ? (
          <div>
            <dt>{COPY.facts.delivery}</dt>
            <dd>{task.deliveryMethod}</dd>
          </div>
        ) : null}
        {task.externalWorkId ? (
          <div>
            <dt>{COPY.facts.externalReference}</dt>
            <dd className="mono-text">{task.externalWorkId}</dd>
          </div>
        ) : null}
        <div>
          <dt>{COPY.facts.started}</dt>
          <dd>
            <TimeDisplay iso={task.createdAt} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function FulfillmentWorkDetailBody({
  task,
}: FulfillmentWorkDetailBodyProps): ReactElement {
  return (
    <>
      <WorkHoldsSection task={task} />
      <WorkExecutorSection task={task} />
      <WorkShipmentSection task={task} />
      <WorkPaymentSection task={task} />
      <WorkLinesSection task={task} />
      <WorkFactsSection task={task} />
    </>
  );
}
