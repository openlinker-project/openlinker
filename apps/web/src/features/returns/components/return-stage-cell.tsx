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
import { RETURN_RESTOCK_BLOCKED_COPY } from '../lib/restock-blocked.copy';
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
      {/* #2381 — the § 5.4 badge, BESIDE the stage rather than replacing it:
          they answer different questions ("how far along is this return" vs
          "does it need me"), and a blocked restock does not move the stage.
          Rendered only on an explicit `true`: `null` means the read did not
          report it, and a badge there would invent an alarm — while `false`
          means it genuinely has none. The title text comes from the shared
          module so this badge and the per-line notice cannot drift. */}
      {item.restockBlocked === true ? (
        <StatusBadge tone="error" compact>
          {RETURN_RESTOCK_BLOCKED_COPY.badge}
        </StatusBadge>
      ) : null}
      <span className="returns-stage-cell__counters">{returnCounterLine(item.counters)}</span>
    </div>
  );
}
