/**
 * Return Activity Timeline (#2646, returns spec § 5)
 *
 * The panel the spec's panel order names and that was never built. #2383 built
 * the returns→ORDER path; this is the same acts re-projected at the RETURN
 * grain, which is what an orphan needs — an orphan has no `internalOrderId`, so
 * the order-scoped read cannot serve it at all.
 *
 * Four properties are load-bearing.
 *
 * **It reuses #2383's mapper and its `by` table verbatim.** One event
 * vocabulary, one attribution rule — a second mapper is how the order timeline
 * and this one come to describe the same act two ways.
 *
 * **An unknown actor renders no eyebrow and does NOT suppress the entry.**
 * That is the mapper's rule (`resolveBy` returns `undefined`); this component
 * simply does not re-derive one. A guessed actor is a claim; a missing title is
 * a dropped fact, and both are worse than a bare row.
 *
 * **A failed read is a failure, never an empty history.** The three states are
 * distinguishable and only the confirmed-empty one asserts anything about the
 * return. A 403 is included in that failure arm and stated as such — a `packer`
 * can reach a return detail but not this read (the entries carry refund money),
 * so the panel says the activity is not available to this account rather than
 * that nothing happened.
 *
 * **The rows are rendered by the orders feature's `ActivityTimelineList`**, so
 * the two timelines cannot drift into two looks. The cross-feature import goes
 * through the orders barrel, an edge this feature already holds.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { ActivityTimelineList } from '../../orders';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { Button } from '../../../shared/ui/button';
import { ApiError } from '../../../shared/api/api-error';
import { useSession } from '../../../shared/auth/use-session';
import { useReturnEventsQuery } from '../hooks/use-return-events-query';
import { mapReturnEventsToTimeline } from '../lib/return-timeline-events';
import { RETURN_ACTIVITY_COPY as COPY } from '../lib/return-activity.copy';

interface ReturnActivityTimelineProps {
  returnId: string;
}

export function ReturnActivityTimeline({ returnId }: ReturnActivityTimelineProps): ReactElement {
  const query = useReturnEventsQuery(returnId);
  const { session } = useSession();
  // The you-vs-another-operator distinction is the whole point of the eyebrow,
  // and the mapper is pure — so the session id is passed IN rather than read
  // there.
  const sessionUserId = session?.user?.id ?? null;

  const entries = query.data ?? null;
  const events = useMemo(
    () => (entries === null ? [] : mapReturnEventsToTimeline(entries, sessionUserId)),
    [entries, sessionUserId],
  );

  return (
    <section className="returns-detail__activity">
      <h2 className="section-title">{COPY.sectionTitle}</h2>
      {renderBody()}
    </section>
  );

  function renderBody(): ReactElement {
    if (query.isLoading) {
      return <LoadingState liveRegion="off" title={COPY.loading} message={COPY.loadingMessage} />;
    }

    if (query.error !== null || entries === null) {
      const forbidden = query.error instanceof ApiError && query.error.status === 403;
      return (
        <ErrorState
          title={forbidden ? COPY.forbiddenTitle : COPY.errorTitle}
          message={forbidden ? COPY.forbiddenMessage : COPY.errorMessage}
          action={
            forbidden ? undefined : (
              <Button
                onClick={() => {
                  void query.refetch();
                }}
              >
                {COPY.retry}
              </Button>
            )
          }
        />
      );
    }

    if (events.length === 0) {
      // The read succeeded and answered zero. The only positive claim here.
      return <EmptyState liveRegion="off" title={COPY.emptyTitle} message={COPY.emptyMessage} />;
    }

    return <ActivityTimelineList events={events} ariaLabel={COPY.ariaLabel} />;
  }
}
