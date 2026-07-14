/**
 * ErliBulkRowSection
 *
 * Per-product (per-row) Erli section for the bulk Review edit modal (#1096,
 * #1531). Lets the operator override the dispatch time and the responsible
 * producer for a single product instead of only batch-wide, each behind a
 * toggle: OFF (default) ⇒ the row inherits the batch value (the submit
 * deep-merges shared `platformParams` under per-row); ON ⇒ a custom value is
 * written to the row's `platformParams`.
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
import { ErliProducerField } from './erli-producer-field';
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

  // Producer override (#1531). An absent `producer` key ⇒ this row inherits the
  // batch-default producer; a present string ⇒ this product overrides it. The
  // per-row value wins over the batch default at submit (per-row deep-merged
  // over the shared `platformParams`).
  const producerOverridden = typeof platformParams.producer === 'string';
  const producer = producerOverridden ? (platformParams.producer as string) : '';

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

  function toggleProducer(on: boolean): void {
    if (on) {
      // Start empty; the operator picks a producer for this product only.
      onChange({ ...platformParams, producer: '' });
    } else {
      // Drop the key so the row inherits the batch-default producer at submit.
      const next = { ...platformParams };
      delete next.producer;
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

      <label
        className="checkbox-row"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}
      >
        <input
          type="checkbox"
          checked={producerOverridden}
          onChange={(e) => { toggleProducer(e.target.checked); }}
        />
        <span>
          <strong>Custom producer for this product</strong>
          <small style={{ display: 'block', color: 'var(--text-muted)' }}>
            Off — this product uses the batch default producer.
          </small>
        </span>
      </label>

      {producerOverridden ? (
        <>
          <ErliProducerField
            connectionId={connection.id}
            value={producer}
            onChange={(next) => { onChange({ ...platformParams, producer: next }); }}
          />
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => { toggleProducer(false); }}
          >
            Reset to batch default
          </button>
        </>
      ) : null}
    </div>
  );
}
