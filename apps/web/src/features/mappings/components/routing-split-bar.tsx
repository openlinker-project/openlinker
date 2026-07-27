/**
 * RoutingSplitBar (#1739)
 *
 * Segmented proportion bar for the Fulfillment tab: shows how many delivery
 * methods route to each fulfillment processor, including the default bucket
 * (methods with no rule). A pure derived view — the panel recomputes buckets
 * from its unsaved selections, so the bar moves before "Save routing".
 *
 * Accessibility: the bar itself is decorative (`aria-hidden`); the legend
 * carries every label + count as text.
 *
 * @module apps/web/src/features/mappings/components
 */

import type { ReactElement } from 'react';
import { tokens } from '../../../shared/theme/tokens';

export interface RoutingSplitBucket {
  /** Stable bucket key (processor selection key or the default sentinel). */
  key: string;
  /** Legend label (connection name; the default bucket uses the panel's default label). */
  label: string;
  /** How many delivery methods currently route to this bucket. */
  count: number;
  /** True for the "no rule → default OMP" bucket — rendered in the muted series colour. */
  isDefault?: boolean;
}

const SERIES_TOKENS = [
  tokens['viz-cat-1'],
  tokens['viz-cat-2'],
  tokens['viz-cat-3'],
  tokens['viz-cat-4'],
] as const;

/** Series colour per bucket: muted for the default bucket, cycling palette otherwise. */
function bucketColor(bucket: RoutingSplitBucket, seriesIndex: number): string {
  if (bucket.isDefault) {
    return tokens['viz-cat-muted'];
  }
  return SERIES_TOKENS[seriesIndex % SERIES_TOKENS.length];
}

interface RoutingSplitBarProps {
  buckets: RoutingSplitBucket[];
}

export function RoutingSplitBar({ buckets }: RoutingSplitBarProps): ReactElement | null {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) {
    return null;
  }

  // Colour is assigned by position among non-default buckets so it stays
  // stable when counts change (a bucket dropping to 0 keeps its slot).
  let seriesIndex = -1;
  const coloured = buckets.map((bucket) => {
    if (!bucket.isDefault) {
      seriesIndex += 1;
    }
    return { bucket, color: bucketColor(bucket, Math.max(seriesIndex, 0)) };
  });

  return (
    <div className="routing-split">
      <div className="routing-split__bar" aria-hidden="true">
        {coloured
          .filter(({ bucket }) => bucket.count > 0)
          .map(({ bucket, color }) => (
            <div
              key={bucket.key}
              className="routing-split__seg"
              style={{ flexGrow: bucket.count, background: color }}
            />
          ))}
      </div>
      <div className="routing-split__legend" aria-label="Delivery methods per fulfillment processor">
        {coloured.map(({ bucket, color }) => (
          <span key={bucket.key} className="routing-split__key">
            <span className="routing-split__swatch" style={{ background: color }} aria-hidden="true" />
            {bucket.label} <span className="routing-split__count">{bucket.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
