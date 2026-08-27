/**
 * Return Stage Cell (#2377, `W2-40`, spec § 3.2)
 *
 * The one glanceable signal per row, with the counters themselves adjacent.
 *
 * Replaces the Wave-1c `ReturnStatusCell`, whose own docblock handed the stage
 * to this issue — it could render only `Declined`, because the list projection
 * carried no counters to derive anything else from. It does now.
 *
 * The stage is DERIVED here rather than read off the wire: the row already holds
 * the counters, so asking the server for a string it can compute would be a
 * round trip for nothing — and a `stage` field on the wire would leave nothing
 * for `scripts/check-return-stage-mirror.mjs` to pin against the SQL twin.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { ReturnListItem } from '../api/returns.types';
import {
  RETURN_STAGE_LABELS,
  RETURN_STAGE_TONES,
  deriveReturnStage,
  returnCounterLine,
} from '../lib/return-row';

interface ReturnStageCellProps {
  item: ReturnListItem;
}

export function ReturnStageCell({ item }: ReturnStageCellProps): ReactElement {
  const stage = deriveReturnStage(item);

  return (
    <div className="returns-stage-cell">
      <StatusBadge tone={RETURN_STAGE_TONES[stage]} compact>
        {RETURN_STAGE_LABELS[stage]}
      </StatusBadge>
      <span className="returns-stage-cell__counters">{returnCounterLine(item.counters)}</span>
    </div>
  );
}
