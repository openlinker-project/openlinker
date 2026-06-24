/**
 * ErliBulkRowSection
 *
 * Per-product (per-row) Erli section for the bulk Review edit modal (#1096).
 * Lets the operator override the dispatch time for a single product instead of
 * only batch-wide, behind a toggle: OFF (default) ⇒ the row inherits the batch
 * dispatch time (the submit deep-merges shared `platformParams` under per-row);
 * ON ⇒ a custom dispatch time is written to the row's `platformParams`.
 *
 * Controlled — the host (edit modal) owns the row's `platformParams` (seeded
 * from any existing per-row override) and persists `onChange` output into the
 * row override. Registered via the Erli plugin's `platform.bulkOfferRowSection`
 * slot and resolved by the host through `usePlatform('erli')`.
 *
 * @module features/listings/components/erli
 */
import { useMemo, type ReactElement } from 'react';

import type { BulkOfferRowSectionProps } from '../../../../shared/plugins';
import { ErliDispatchTimeField } from './erli-dispatch-time-field';
import {
  isValidDispatch,
  parseErliConnectionDispatchDefault,
  type ErliDispatchTimeParam,
} from './erli-offer-fields.schema';

export function ErliBulkRowSection({
  connection,
  platformParams,
  onChange,
}: BulkOfferRowSectionProps): ReactElement {
  const connectionDefault = useMemo<ErliDispatchTimeParam>(
    () => parseErliConnectionDispatchDefault(connection.config),
    [connection.config],
  );

  const overridden = isValidDispatch(platformParams.dispatchTime);
  const current: ErliDispatchTimeParam = overridden
    ? (platformParams.dispatchTime as ErliDispatchTimeParam)
    : connectionDefault;

  function toggle(on: boolean): void {
    if (on) {
      onChange({ ...platformParams, dispatchTime: current });
    } else {
      // Drop the key so the row inherits the batch-wide dispatch at submit.
      const next = { ...platformParams };
      delete next.dispatchTime;
      onChange(next);
    }
  }

  return (
    <div className="bulk-edit__platform-section">
      <label
        className="checkbox-row"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}
      >
        <input
          type="checkbox"
          checked={overridden}
          onChange={(e) => { toggle(e.target.checked); }}
        />
        <span>
          <strong>Custom dispatch time for this product</strong>
          <small style={{ display: 'block', color: 'var(--text-muted)' }}>
            Off — this product uses the batch dispatch time.
          </small>
        </span>
      </label>

      {overridden ? (
        <ErliDispatchTimeField
          value={current}
          connectionDefault={connectionDefault}
          onChange={(next) => { onChange({ ...platformParams, dispatchTime: next }); }}
        />
      ) : null}
    </div>
  );
}
