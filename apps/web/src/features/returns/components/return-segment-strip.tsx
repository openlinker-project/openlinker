/**
 * Return Segment Strip (#2378, `W2-41`, spec § 4.1)
 *
 * The worklist strip: *"what is stopping my day?"*, ordered by what stops it.
 *
 * **SEVEN cards.** `All returns` clears `segment` and is the default; the six
 * segments sit beside it, `All open` among them. `All open` is a **filter**, not
 * a clear — its predicate is "still needing something on either rail", so
 * rendering it as the clear card would label closed, fully-refunded returns as
 * open work. That is the distinction the orders-list precedent hides, because
 * *its* `All orders` card genuinely is the cleared state.
 *
 * **Segments overlap**, so the six counts do not sum to `All returns` — and
 * nothing here suggests they should.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { MetricCard } from '../../../shared/ui/metric-card';
import {
  RETURN_SEGMENT_LABELS,
  RETURN_SEGMENT_TONES,
  RETURN_SEGMENT_VALUES,
  type ReturnSegment,
  type ReturnSegmentCounts,
} from '../lib/return-segments';
import { RETURNS_SEGMENT_COPY } from '../lib/returns-list.copy';

interface ReturnSegmentStripProps {
  counts: ReturnSegmentCounts | null;
  /** `null` = no segment selected, i.e. the `All returns` card is active. */
  selected: ReturnSegment | null;
  onSelect: (segment: ReturnSegment | null) => void;
}

export function ReturnSegmentStrip({
  counts,
  selected,
  onSelect,
}: ReturnSegmentStripProps): ReactElement {
  const value = (segment: ReturnSegment): string =>
    counts ? String(counts.bySegment[segment]) : '—';

  return (
    <div className="returns-segments" role="group" aria-label={RETURNS_SEGMENT_COPY.stripLabel}>
      <button
        type="button"
        className={['returns-segment', selected === null ? 'returns-segment--active' : '']
          .filter(Boolean)
          .join(' ')}
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
      >
        <MetricCard
          label={RETURNS_SEGMENT_COPY.allReturnsLabel}
          value={counts ? String(counts.total) : '—'}
        />
      </button>

      {RETURN_SEGMENT_VALUES.map((segment) => (
        <button
          key={segment}
          type="button"
          className={['returns-segment', selected === segment ? 'returns-segment--active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-pressed={selected === segment}
          onClick={() => onSelect(selected === segment ? null : segment)}
        >
          <MetricCard
            label={RETURN_SEGMENT_LABELS[segment]}
            tone={RETURN_SEGMENT_TONES[segment]}
            value={value(segment)}
          />
        </button>
      ))}
    </div>
  );
}
