/**
 * Fulfilment work detail (#3098; rebuilt to the mockup's box model by #3096)
 *
 * One fulfilment task, at its own address. Design of record:
 * `docs/plans/mockups/fulfillment-work-detail-3096.html` (`#detailView`) for
 * the left column, `assign-packing-work.html` for the Packer card, and the
 * order page's own modules for the rest of the right column.
 *
 * ## Admin and operator only (#3096, F-9)
 *
 * `GET /fulfillment/works/:workId` is `@Roles('admin', 'operator')` — exactly
 * who holds `orders:write`. The page is gated on that permission and renders
 * an access-denied state for anyone else, so the read is never sent only to be
 * refused, and a 403 that still arrives (a role changed mid-session) renders
 * the same state rather than "Could not load … [Retry]".
 *
 * ## Five states, none impersonating another
 *
 * Loading renders the page's card skeleton, a FAILED read renders an error
 * with a retry, an id matching nothing renders a distinct not-found, and a 403
 * renders access-denied with no retry. The 404 is a fact about the URL; the
 * error is a fact about the request; the 403 is a fact about the role.
 *
 * ## The title is the ORDER, and there is a way back to it
 *
 * An operator opening this from a ticket is looking for an order, so the title
 * is the source's own reference (`formatOrderRef`, the orders lists'
 * shortening), falling back to the shortened internal id only when the order
 * carries none — and an "Open order" action goes there, because nothing on
 * this page used to.
 *
 * ## The back link carries the assign board's own state
 *
 * Filters, paging and `?groupBy=` live in the `/fulfillment` screen's search
 * params. `fulfillmentWorklistPath` / `fulfillmentWorkDetailPath` share one
 * whitelist for both directions of this link, so this page never parses the
 * query string itself.
 *
 * ## This file carries no user-visible string literal
 *
 * `scripts/check-ui-vocabulary.mjs` does not scan `apps/web/src/pages` at all.
 * Every sentence comes from `FULFILLMENT_WORK_DETAIL_COPY`.
 *
 * ## The action wiring reuses the shared runner (#3257/#3101)
 *
 * Every rule about sending an action lives in `useFulfillmentTaskActionRunner`,
 * shared with the assign board and the order-detail panel; this page decides
 * what to render. Outcomes are reported through the global `useToast()` — no
 * page-local result banner, because a second place for an outcome is a second
 * place for it to drift.
 *
 * @module apps/web/src/pages/fulfillment
 */
import type { ReactElement } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import {
  FULFILLMENT_WORK_DETAIL_COPY,
  FulfillmentAccessDenied,
  FulfillmentTaskActionDialog,
  FulfillmentTaskActions,
  FulfillmentVsOrdersExplainer,
  FulfillmentWorkDetailBody,
  FulfillmentWorkDetailSkeleton,
  fulfillmentWorklistPath,
  useFulfillmentTaskActionRunner,
  useFulfillmentWorkQuery,
  type FulfillmentTask,
} from '../../features/fulfillment';
import { formatOrderRef } from '../../features/orders';
import { useDemoMode } from '../../features/system';
import { isAccessDeniedError } from '../../shared/api/access-denied-error';
import { ApiError } from '../../shared/api/api-error';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { AccessGate } from '../../shared/ui/access-gate';
import { Button } from '../../shared/ui/button';
import { DetailSection } from '../../shared/ui/detail-section';
import { shortenId } from '../../shared/ui/entity-label';
import { EmptyState, ErrorState } from '../../shared/ui/feedback-state';
import { PageLayout } from '../../shared/ui/page-layout';

const COPY = FULFILLMENT_WORK_DETAIL_COPY;

export function FulfillmentWorkDetailPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const backTo = {
    to: fulfillmentWorklistPath(searchParams),
    label: COPY.backToWorklist,
  };

  return (
    <AccessGate
      require="orders:write"
      fallback={
        <PageLayout eyebrow={COPY.eyebrow} title={COPY.titleFallback} backTo={backTo}>
          <FulfillmentAccessDenied copy={COPY.states.denied} />
        </PageLayout>
      }
    >
      <FulfillmentWorkDetail backTo={backTo} />
    </AccessGate>
  );
}

/** The order's reference when it has one; the shortened internal id otherwise. */
function orderTitle(task: FulfillmentTask): string {
  const reference = task.orderReference ? formatOrderRef(task.orderReference) : shortenId(task.orderId);
  return `${COPY.orderTitlePrefix} ${reference}`;
}

function FulfillmentWorkDetail({
  backTo,
}: {
  backTo: { to: string; label: string };
}): ReactElement {
  const { workId = '' } = useParams<{ workId: string }>();
  const query = useFulfillmentWorkQuery(workId);
  const demoMode = useDemoMode();
  // `@Roles('admin', 'operator')` is exactly who holds this permission.
  // Deliberately WITHOUT `useIsAdmin()` — the action route is not admin-only.
  const write = useWriteAccess('orders:write', demoMode);
  // Above the early returns, or the loading and failure branches would skip a
  // hook call and React would tear the render down on the next pass.
  const actions = useFulfillmentTaskActionRunner();

  if (query.isPending) {
    return (
      <PageLayout eyebrow={COPY.eyebrow} title={COPY.titleFallback} backTo={backTo}>
        <FulfillmentWorkDetailSkeleton />
      </PageLayout>
    );
  }

  if (query.error !== null) {
    const isNotFound = query.error instanceof ApiError && query.error.isNotFound();
    const isDenied = isAccessDeniedError(query.error);

    return (
      <PageLayout
        eyebrow={COPY.eyebrow}
        title={isNotFound ? COPY.states.notFound.title : COPY.titleFallback}
        backTo={backTo}
      >
        {isDenied ? (
          <FulfillmentAccessDenied copy={COPY.states.denied} />
        ) : isNotFound ? (
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
  const busy = actions.busyTaskId === task.id;

  const actionCard = (
    <DetailSection
      tone="actions"
      className="fulfilment-work-detail__actions-card fulfilment-work-detail__slot--actions"
      aria-label={COPY.sections.actions}
    >
      <span className="fulfilment-work-detail__actions-label">{COPY.sections.actions}</span>
      <div
        className="fulfilment-work-detail__actions"
        // The REGION, not the button: this page renders one task, so while an
        // action is in flight the whole write surface is what is updating.
        aria-busy={busy}
      >
        {/* `supportedActions` rendered as served — the server decides, and
            an action this build has no copy for still renders under the
            humanising fallback. */}
        <FulfillmentTaskActions
          task={task}
          size="md"
          visible={write.visible}
          readOnly={write.demoReadOnly}
          busy={busy}
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
        {/* Guarded on `write.visible` as well as on the action set: the bare
            length test would tell a read-only viewer this task is finished
            when what is true is that they cannot act on it. */}
        {write.visible && task.supportedActions.length === 0 ? (
          <p className="fulfilment-work-detail__actions-empty">{COPY.actions.nothingLeft}</p>
        ) : null}
      </div>
    </DetailSection>
  );

  return (
    <PageLayout
      eyebrow={COPY.eyebrow}
      title={orderTitle(task)}
      backTo={backTo}
      actions={
        <Link className="button button--secondary" to={`/orders/${encodeURIComponent(task.orderId)}`}>
          {COPY.openOrder}
        </Link>
      }
    >
      <FulfillmentVsOrdersExplainer />
      <FulfillmentWorkDetailBody
        task={task}
        actions={actionCard}
        canStaff={write.visible}
        readOnly={write.demoReadOnly}
      />

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
