/**
 * Fulfilment worklist (#2410, `W3a-20`, DESIGN §5.2)
 *
 * The operator's standalone view of the fulfilment tasks waiting to be worked,
 * grouped by where the goods are and how they leave, with the manual actions
 * the SERVER says are legal on each right now.
 *
 * ## Four states, and none of them is allowed to impersonate another
 *
 * A loading read renders a loading line, a FAILED read renders an error with a
 * retry, an empty page renders "no matches" when a filter is active and
 * "nothing to work" when none is. Collapsing any pair would have this page tell
 * an operator there is no work because a request timed out, or because they
 * typed an order id that matched nothing.
 *
 * ## The version sent is the version RENDERED
 *
 * `expectedVersion` is read off the task object the button was rendered from,
 * never re-read at click time. Substituting a fresher value would make
 * `version_conflict` unreachable and hand the last writer the win — the
 * double-ship the optimistic token exists to prevent.
 *
 * ## A `version_conflict` is never auto-retried
 *
 * The action mutation invalidates the whole feature (#2411), so the row
 * refreshes itself and re-renders the server's new action set. Re-posting on
 * the operator's behalf against state they have not seen is exactly what the
 * token guards against.
 *
 * ## This file carries no user-visible string literals
 *
 * Every one lives in `features/fulfillment/lib/fulfillment-worklist.copy.ts`,
 * because `scripts/check-ui-vocabulary.mjs` scans only under
 * `apps/web/src/features` — copy written here would be ungated.
 *
 * @module apps/web/src/pages/fulfillment
 */
import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  FULFILLMENT_WORKLIST_COPY,
  FULFILLMENT_WORKLIST_PAGE_SIZE,
  FulfillmentLaneSection,
  FulfillmentTaskActionDialog,
  FulfillmentTaskActions,
  clearFulfillmentFilters,
  describeFulfillmentActionError,
  fulfillmentActionLabel,
  groupTasksIntoLanes,
  hasActiveFulfillmentFilters,
  readFulfillmentConflict,
  readFulfillmentFilters,
  readFulfillmentOffset,
  setFulfillmentFilterParam,
  setFulfillmentOffsetParam,
  useFulfillmentTaskActionMutation,
  useFulfillmentTasksQuery,
  type ApplyFulfillmentTaskActionRequest,
  type FulfillmentTask,
  type FulfillmentTaskActionMode,
  type FulfillmentTaskHold,
} from '../../features/fulfillment';
import { useDemoMode } from '../../features/system';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState } from '../../shared/ui/feedback-state';
import { Input } from '../../shared/ui/input';
import { PageLayout } from '../../shared/ui/page-layout';
import { useToast } from '../../shared/ui/toast-provider';

interface PendingForm {
  mode: FulfillmentTaskActionMode;
  task: FulfillmentTask;
  hold?: FulfillmentTaskHold;
  /** This form's own submit failure, scoped so a dismissed one cannot reappear. */
  error?: unknown;
}

export function FulfillmentWorklistPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => readFulfillmentFilters(searchParams), [searchParams]);
  const offset = readFulfillmentOffset(searchParams);
  const isFiltered = hasActiveFulfillmentFilters(filters);

  const query = useFulfillmentTasksQuery({
    ...filters,
    limit: FULFILLMENT_WORKLIST_PAGE_SIZE,
    offset,
  });
  const mutation = useFulfillmentTaskActionMutation();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  // The same permission the order-detail panel resolves (#2411): the action
  // route is `@Roles('admin','operator')`, exactly who holds `orders:write`.
  // Resolved ONCE here rather than inside a component rendered per row.
  const write = useWriteAccess('orders:write', demoMode);

  const [pendingForm, setPendingForm] = useState<PendingForm | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const setFilter = (key: 'orderId' | 'locationId', value: string): void => {
    setSearchParams(setFulfillmentFilterParam(searchParams, key, value));
  };
  const clearFilters = (): void => {
    setSearchParams(clearFulfillmentFilters(searchParams));
  };
  const goToOffset = (next: number): void => {
    setSearchParams(setFulfillmentOffsetParam(searchParams, next));
  };
  /**
   * Enter commits the filter, because a filter box that only reacts to blur
   * reads as broken to anyone who types and presses Enter.
   */
  const commitOnEnter = (
    event: KeyboardEvent<HTMLInputElement>,
    key: 'orderId' | 'locationId'
  ): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    setFilter(key, event.currentTarget.value.trim());
  };

  const run = (
    task: FulfillmentTask,
    action: string,
    body: Omit<ApplyFulfillmentTaskActionRequest, 'expectedVersion'>,
    onDone?: () => void,
    onFailure?: (error: unknown) => void
  ): void => {
    setBusyTaskId(task.id);
    mutation.mutate(
      {
        workId: task.id,
        action,
        orderId: task.orderId,
        // The token as RENDERED — see the module docblock.
        expectedVersion: task.version,
        ...body,
      },
      {
        onSuccess: () => {
          showToast({ tone: 'success', description: `${fulfillmentActionLabel(action)} applied.` });
          onDone?.();
        },
        onError: (error) => {
          const conflict = readFulfillmentConflict(error);
          // A conflict closes the form and lets the operator re-read: keeping it
          // open invites a resubmit carrying the same stale token.
          const closesTheForm = conflict !== null || onFailure === undefined;
          if (closesTheForm) {
            showToast({
              // A stale token is the guard working, not a fault.
              tone: conflict?.retryable === true ? 'warning' : 'error',
              description: describeFulfillmentActionError(
                error,
                `Could not ${fulfillmentActionLabel(action).toLowerCase()} this fulfilment task.`
              ),
            });
          }
          if (conflict) {
            onDone?.();
            return;
          }
          onFailure?.(error);
        },
        onSettled: () => {
          setBusyTaskId(null);
        },
      }
    );
  };

  const renderActions = (task: FulfillmentTask): ReactElement | null => (
    <FulfillmentTaskActions
      task={task}
      visible={write.visible}
      readOnly={write.demoReadOnly}
      busy={busyTaskId === task.id}
      onInvoke={(action) => {
        run(task, action, {});
      }}
      onHold={() => {
        setPendingForm({ mode: 'hold', task });
      }}
      onReleaseHold={(hold) => {
        setPendingForm({ mode: 'release_hold', task, hold });
      }}
      onForceCancel={() => {
        setPendingForm({ mode: 'force_cancel', task });
      }}
    />
  );

  const page = query.data;
  const tasks = page?.works ?? [];
  // Keyed on the query RESULT, which is stable per fetch — `tasks` is a fresh
  // `?? []` array on every render, so memoising on it never hits.
  const lanes = useMemo(() => groupTasksIntoLanes(page?.works ?? []), [page]);
  // The server clamps, so the pager reads what it APPLIED, never what we asked.
  const appliedLimit = page?.limit ?? FULFILLMENT_WORKLIST_PAGE_SIZE;
  const appliedOffset = page?.offset ?? offset;
  const total = page?.total ?? 0;

  const body = ((): ReactElement => {
    if (query.isPending) {
      // Never an empty-state sentence: an unresolved read says nothing yet.
      return <p className="text-muted">{FULFILLMENT_WORKLIST_COPY.loading.message}</p>;
    }
    if (query.isError) {
      return (
        <ErrorState
          title={FULFILLMENT_WORKLIST_COPY.error.title}
          message={FULFILLMENT_WORKLIST_COPY.error.message}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              {FULFILLMENT_WORKLIST_COPY.error.retry}
            </Button>
          }
        />
      );
    }
    if (tasks.length === 0) {
      // Paged past the end is a different situation from either empty state:
      // rows exist, this page is simply beyond them.
      if (appliedOffset > 0 && total > 0) {
        return (
          <EmptyState
            liveRegion="off"
            title={FULFILLMENT_WORKLIST_COPY.empty.pastEnd.title}
            message={FULFILLMENT_WORKLIST_COPY.empty.pastEnd.message}
            action={
              <Button
                onClick={() => {
                  goToOffset(0);
                }}
              >
                {FULFILLMENT_WORKLIST_COPY.empty.pastEnd.action}
              </Button>
            }
          />
        );
      }
      if (isFiltered) {
        return (
          <EmptyState
            liveRegion="off"
            title={FULFILLMENT_WORKLIST_COPY.empty.filtered.title}
            message={FULFILLMENT_WORKLIST_COPY.empty.filtered.message}
            action={
              <Button onClick={clearFilters}>{FULFILLMENT_WORKLIST_COPY.filter.clear}</Button>
            }
          />
        );
      }
      return (
        <EmptyState
          liveRegion="off"
          title={FULFILLMENT_WORKLIST_COPY.empty.none.title}
          message={FULFILLMENT_WORKLIST_COPY.empty.none.message}
        />
      );
    }

    return (
      <>
        {lanes.map((lane) => (
          <FulfillmentLaneSection key={lane.id} lane={lane} renderActions={renderActions} />
        ))}

        <div className="pagination">
          <span className="text-muted tabular">
            {FULFILLMENT_WORKLIST_COPY.pagination.range(
              appliedOffset + 1,
              Math.min(appliedOffset + appliedLimit, total),
              total
            )}
          </span>
          <div className="pagination__actions">
            <Button
              disabled={appliedOffset <= 0}
              onClick={() => {
                goToOffset(Math.max(0, appliedOffset - appliedLimit));
              }}
            >
              {FULFILLMENT_WORKLIST_COPY.pagination.previous}
            </Button>
            <Button
              disabled={appliedOffset + appliedLimit >= total}
              onClick={() => {
                goToOffset(appliedOffset + appliedLimit);
              }}
            >
              {FULFILLMENT_WORKLIST_COPY.pagination.next}
            </Button>
          </div>
        </div>
      </>
    );
  })();

  return (
    <PageLayout
      eyebrow={FULFILLMENT_WORKLIST_COPY.page.eyebrow}
      title={FULFILLMENT_WORKLIST_COPY.page.title}
      description={FULFILLMENT_WORKLIST_COPY.page.description}
    >
      <div className="toolbar" role="group" aria-label={FULFILLMENT_WORKLIST_COPY.filter.groupLabel}>
        {/* `key` is the URL's own value, so the box REMOUNTS whenever the filter
            changes from outside it — which is what makes `Clear filters` clear
            the text as well as the list. An uncontrolled input ignores a changed
            `defaultValue`, so without this the page shows a filter box reading
            `ol_order_7` over an unfiltered list and the remedy appears to do
            nothing. Typing is still uncontrolled (no re-render per keystroke);
            the key only moves when the committed value does. */}
        <Input
          key={`orderId:${filters.orderId ?? ''}`}
          aria-label={FULFILLMENT_WORKLIST_COPY.filter.orderLabel}
          placeholder={FULFILLMENT_WORKLIST_COPY.filter.orderPlaceholder}
          defaultValue={filters.orderId ?? ''}
          onBlur={(event) => {
            setFilter('orderId', event.target.value.trim());
          }}
          onKeyDown={(event) => {
            commitOnEnter(event, 'orderId');
          }}
        />
        <Input
          key={`locationId:${filters.locationId ?? ''}`}
          aria-label={FULFILLMENT_WORKLIST_COPY.filter.locationLabel}
          placeholder={FULFILLMENT_WORKLIST_COPY.filter.locationPlaceholder}
          defaultValue={filters.locationId ?? ''}
          onBlur={(event) => {
            setFilter('locationId', event.target.value.trim());
          }}
          onKeyDown={(event) => {
            commitOnEnter(event, 'locationId');
          }}
        />
        {isFiltered ? (
          <Button onClick={clearFilters}>{FULFILLMENT_WORKLIST_COPY.filter.clear}</Button>
        ) : null}
      </div>

      {body}

      {pendingForm ? (
        <FulfillmentTaskActionDialog
          // Remount per (task, mode, hold) so a draft never carries across.
          key={`${pendingForm.task.id}:${pendingForm.mode}:${pendingForm.hold?.id ?? ''}`}
          open
          mode={pendingForm.mode}
          holdId={pendingForm.hold?.id}
          submitting={busyTaskId === pendingForm.task.id}
          error={pendingForm.error ?? null}
          onOpenChange={(open) => {
            if (!open) setPendingForm(null);
          }}
          onSubmit={(actionBody) => {
            setPendingForm((current) => (current ? { ...current, error: undefined } : current));
            run(
              pendingForm.task,
              pendingForm.mode,
              actionBody,
              () => {
                setPendingForm(null);
              },
              (error) => {
                setPendingForm((current) => (current ? { ...current, error } : current));
              }
            );
          }}
        />
      ) : null}
    </PageLayout>
  );
}
