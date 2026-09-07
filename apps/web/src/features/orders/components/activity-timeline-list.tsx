/**
 * Activity Timeline List (#2646)
 *
 * The presentational `<ol>` behind every activity timeline — extracted verbatim
 * from `OrderActivityTimeline` when the return detail became its second
 * consumer, so the two surfaces cannot drift into two timeline *looks*.
 *
 * Three properties are load-bearing.
 *
 * **`ariaLabel` is a REQUIRED prop, never a default.** The markup it replaced
 * hardcoded `"Order activity timeline"`; extracted with that string intact, the
 * return-detail timeline would announce itself to a screen reader as the
 * ORDER's — a false statement, and the only label an assistive-technology user
 * ever gets. A required prop makes the wrong answer unspellable.
 *
 * **The markup and class names are byte-identical to what they replaced**, down
 * to `.order-activity__dot--*`. 27 assertions in
 * `order-activity-timeline.test.tsx` read this DOM; the move is transparent
 * only while it stays so. The `order-activity` prefix now styles a returns
 * surface too, which reads oddly — it is kept deliberately rather than renamed,
 * because renaming means touching ~40 CSS rules and the assertions above in a
 * change whose subject is neither.
 *
 * **It renders rows and nothing else.** The order timeline's caption (attempt
 * caps) and its empty state stay with the order timeline: they are statements
 * about `sync_jobs`, which the return detail has nothing to do with. A caller
 * with no events renders its own empty state.
 *
 * `TimelineEvent` stays owned by `features/orders` — the type is the timeline's,
 * and the timeline is here.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { TimelineEvent } from './order-activity-timeline';

const TONE_CLASS: Record<TimelineEvent['tone'], string> = {
  default: 'order-activity__dot--default',
  success: 'order-activity__dot--success',
  error: 'order-activity__dot--error',
  warning: 'order-activity__dot--warning',
  conflict: 'order-activity__dot--conflict',
};

interface ActivityTimelineListProps {
  events: TimelineEvent[];
  /** Required — see the module docblock. */
  ariaLabel: string;
}

export function ActivityTimelineList({
  events,
  ariaLabel,
}: ActivityTimelineListProps): ReactElement {
  return (
    <ol className="order-activity" aria-label={ariaLabel}>
      {events.map((event) => (
        <li key={event.id} className="order-activity__item">
          <span className={`order-activity__dot ${TONE_CLASS[event.tone]}`} aria-hidden="true" />
          <div className="order-activity__body">
            <p className="order-activity__title">
              {event.title}
              {event.by ? <span className="order-activity__by">{event.by}</span> : null}
            </p>
            {event.description ? (
              <p className="order-activity__description">{event.description}</p>
            ) : null}
            {event.footer ? <p className="order-activity__footer">{event.footer}</p> : null}
          </div>
          {event.timestamp ? (
            <time className="order-activity__time" dateTime={event.timestamp}>
              <TimeDisplay iso={event.timestamp} format="datetime" />
            </time>
          ) : (
            <span className="order-activity__time" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}
