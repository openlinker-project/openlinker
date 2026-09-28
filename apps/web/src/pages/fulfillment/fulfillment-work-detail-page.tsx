/**
 * Fulfilment work detail (#3098)
 *
 * One fulfilment task, at its own address. `GET /fulfillment/works/:workId`
 * has been served since #2406 and had no caller; this is the page that lands
 * on it.
 *
 * ## Its own page, not a split screen
 *
 * #3098's issue body records the decision and the mockup committed alongside
 * it (`docs/plans/mockups/fulfillment-work-detail-3096.html`) is the design
 * of record. The short version: the detail carries seven stacked sections
 * while the assign board's desktop grouping needs real width, so side by
 * side collapses one of them at every width an operator uses — and a page
 * has an ADDRESS, which "the third row I had selected" cannot be.
 *
 * ## Four states, none impersonating another
 *
 * Loading renders loading, a FAILED read renders an error with a retry, and
 * an id matching nothing renders a distinct not-found. The 404 is a fact
 * about the URL; the error is a fact about the request. Collapsing them
 * points an operator at a problem they do not have — this page follows
 * `return-detail-page.tsx`'s shape rather than `order-detail-page.tsx`'s,
 * whose error branch swallows the 404.
 *
 * ## The back link carries the assign board's own state
 *
 * Filters, paging and the `?groupBy=` axis switch all live in the `/fulfillment`
 * screen's search params. An operator who filtered to one lane, paged twice
 * and drilled into a task has done work; returning them to an unfiltered
 * first page throws it away. `fulfillmentWorklistPath` / `fulfillmentWorkDetailPath`
 * (`lib/fulfillment-filters.ts`) share one whitelist for both directions of
 * this link, so this page never parses the query string itself and cannot
 * disagree with the screen about what a param means.
 *
 * ## This file carries no user-visible string literal
 *
 * `scripts/check-ui-vocabulary.mjs` does not scan `apps/web/src/pages` at
 * all, so a sentence written here would ship past the gate that exists to
 * keep the internal aggregate name out of operator copy. Every one comes
 * from `FULFILLMENT_WORK_DETAIL_COPY`.
 *
 * ## The action wiring reuses the shared runner (#3257/#3101)
 *
 * Every rule about sending an action — the rendered-version token, the two
 * coded 409s, which failures toast and which reach the form — lives in
 * `useFulfillmentTaskActionRunner`, shared with the assign board and the
 * order-detail panel. This page decides what to render and nothing else. A
 * private copy of that block here would be a third implementation of one
 * optimistic-concurrency contract, which is exactly how two surfaces come to
 * disagree about what is legal.
 *
 * The outcome is reported through the same global `useToast()` every other
 * fulfilment surface uses. There is deliberately no page-local result
 * banner: a second place for an outcome to be reported is a second place for
 * it to drift, and the mockup is explicit that neither view gets an inline
 * result slot.
 *
 * @module apps/web/src/pages/fulfillment
 */
import type { ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import {
  FULFILLMENT_EXPEDITED_BADGE,
  FULFILLMENT_WORK_DETAIL_COPY,
  FulfillmentTaskActionDialog,
  FulfillmentTaskActions,
  FulfillmentVsOrdersExplainer,
  FulfillmentWorkDetailBody,
  fulfillmentRequestStatusLabel,
  fulfillmentStatusLabel,
  fulfillmentWorklistPath,
  summariseFulfillmentWork,
  useFulfillmentTaskActionRunner,
  useFulfillmentWorkQuery,
  type FulfillmentTask,
} from '../../features/fulfillment';
import { useDemoMode } from '../../features/system';
import { ApiError } from '../../shared/api/api-error';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';
import { shortenId } from '../../shared/ui/entity-label';
import { StatusBadge } from '../../shared/ui/status-badge';

const COPY = FULFILLMENT_WORK_DETAIL_COPY;

/**
 * The hero: both axes verbatim, the expedited badge, and the derived
 * sentence.
 *
 * Both axis labels always render. Heldness lives in `activeHolds` and
 * nothing writes `status: 'on_hold'`, so neither axis can be dropped without
 * the page losing a fact the other one cannot carry.
 */
function WorkDetailHero({ task }: { task: FulfillmentTask }): ReactElement {
  // `null` when this build cannot say. Rendering nothing is the fail-safe
  // direction the derivation promises — a hedge would be a claim about
  // somebody's parcel that nobody reviewed. `executorName` stays `null`
  // here: naming the executing connection is #3291's dedicated section, and
  // stating it twice on one page — once in the hero, once in that section —
  // is the same fact said twice.
  const summary = summariseFulfillmentWork({
    status: task.status,
    requestStatus: task.requestStatus,
    activeHoldCount: task.activeHolds.length,
    locationId: task.locationId,
    expeditedAt: task.expeditedAt ?? null,
    cancellationReason: task.cancellationReason,
    executorName: null,
  });

  return (
    <section className="fulfilment-work-detail__hero">
      <div className="fulfilment-work-detail__axes">
        <StatusBadge tone="info" compact>
          {fulfillmentStatusLabel(task.status)}
        </StatusBadge>
        <StatusBadge tone="neutral" compact>
          {fulfillmentRequestStatusLabel(task.requestStatus)}
        </StatusBadge>
        {/* Byte-identical to the card's badge, deliberately — one fact, one
            wording, wherever it is rendered. */}
        {(task.expeditedAt ?? null) !== null ? (
          <StatusBadge tone="warning" withDot compact>
            {FULFILLMENT_EXPEDITED_BADGE}
          </StatusBadge>
        ) : null}
      </div>
      {summary !== null ? <p className="fulfilment-work-detail__summary">{summary}</p> : null}
    </section>
  );
}

export function FulfillmentWorkDetailPage(): ReactElement {
  const { workId = '' } = useParams<{ workId: string }>();
  const [searchParams] = useSearchParams();
  const query = useFulfillmentWorkQuery(workId);
  const demoMode = useDemoMode();
  // The same `orders:write` decision the assign board and the order-detail
  // panel resolve, because it is the same route: `@Roles('admin', 'operator')`
  // is exactly who holds this permission. Deliberately WITHOUT `useIsAdmin()`
  // — the action route is not admin-only, so ANDing it in would hide every
  // control from the operators it exists to serve.
  const write = useWriteAccess('orders:write', demoMode);
  // Above the early returns, or the loading and failure branches would skip
  // a hook call and React would tear the render down on the next pass.
  const actions = useFulfillmentTaskActionRunner();

  const backTo = {
    to: fulfillmentWorklistPath(searchParams),
    label: COPY.backToWorklist,
  };

  if (query.isPending) {
    return (
      <PageLayout eyebrow={COPY.eyebrow} title={COPY.titleFallback} backTo={backTo}>
        <LoadingState
          liveRegion="off"
          title={COPY.states.loading.title}
          message={COPY.states.loading.message}
        />
      </PageLayout>
    );
  }

  if (query.error !== null) {
    const isNotFound = query.error instanceof ApiError && query.error.status === 404;

    return (
      <PageLayout
        eyebrow={COPY.eyebrow}
        title={isNotFound ? COPY.states.notFound.title : COPY.titleFallback}
        backTo={backTo}
      >
        {isNotFound ? (
          <EmptyState
            liveRegion="off"
            title={COPY.states.notFound.title}
            message={COPY.states.notFound.message}
          />
        ) : (
          <ErrorState
            title={COPY.states.error.title}
            message={COPY.states.error.message}
            action={
              <Button
                onClick={() => {
                  void query.refetch();
                }}
              >
                {COPY.states.error.retry}
              </Button>
            }
          />
        )}
      </PageLayout>
    );
  }

  const task = query.data;

  return (
    <PageLayout
      eyebrow={COPY.eyebrow}
      // The ORDER, not the task id: an operator opening this from a ticket
      // is looking for an order. `shortenId` rather than a hand-rolled
      // `replace('ol_order_', '#').toUpperCase()`, which reads fine on the
      // demo's short fake ids and shouts 32 hex characters on a real one.
      title={`${COPY.orderTitlePrefix} ${shortenId(task.orderId)}`}
      backTo={backTo}
    >
      <FulfillmentVsOrdersExplainer />
      <WorkDetailHero task={task} />
      <FulfillmentWorkDetailBody task={task} />

      <section className="fulfilment-work-detail__section">
        <h3 className="fulfilment-work-detail__section-title">{COPY.sections.actions}</h3>
        <div
          className="fulfilment-work-detail__actions"
          // The REGION, not the button. This page renders one task, so while
          // an action is in flight the whole write surface is what is
          // updating.
          aria-busy={actions.busyTaskId === task.id}
        >
          {/* `supportedActions` rendered as served. No filter, no reorder, no
              legality predicate: the server decides, and an action this
              build has no copy for still renders under the humanising
              fallback, because a value the server declared legal must stay
              invokable. */}
          <FulfillmentTaskActions
            task={task}
            visible={write.visible}
            readOnly={write.demoReadOnly}
            busy={actions.busyTaskId === task.id}
            onInvoke={(action) => {
              actions.run(task, action, {});
            }}
            onHold={() => {
              actions.openForm({ mode: 'hold', task });
            }}
            onReleaseHold={(hold) => {
              actions.openForm({ mode: 'release_hold', task, hold });
            }}
            onForceCancel={() => {
              actions.openForm({ mode: 'force_cancel', task });
            }}
          />
          {/* Guarded on `write.visible` as well as on the action set.
              `FulfillmentTaskActions` renders null for BOTH an empty set and
              a session that may not act, so the bare length test would tell
              a read-only viewer this task is finished when what is true is
              that they cannot act on it. Two different facts, and only one
              of them is this sentence. */}
          {write.visible && task.supportedActions.length === 0 ? (
            <p className="fulfilment-work-detail__actions-empty">{COPY.actions.nothingLeft}</p>
          ) : null}
        </div>
      </section>

      {/* The confirmation form for the three actions that need a field,
          mounted exactly as the assign board and the order panel mount it. */}
      {actions.pendingForm ? (
        <FulfillmentTaskActionDialog
          key={`${actions.pendingForm.task.id}:${actions.pendingForm.mode}:${actions.pendingForm.hold?.id ?? ''}`}
          open
          mode={actions.pendingForm.mode}
          holdId={actions.pendingForm.hold?.id}
          submitting={actions.busyTaskId === actions.pendingForm.task.id}
          error={actions.pendingForm.error ?? null}
          onOpenChange={(open) => {
            if (!open) actions.closeForm();
          }}
          onSubmit={actions.submitForm}
        />
      ) : null}
    </PageLayout>
  );
}
