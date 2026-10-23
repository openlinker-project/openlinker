/**
 * Sync Job Retention Section (#2946, D16)
 *
 * How long a finished sync job's row is kept — a hygiene setting, not a
 * pacing one, so it is deliberately a SEPARATE panel rather than woven into
 * `SyncPacingValues` / `diffSyncPacing` / `projectSyncPacing`: those exist to
 * project a value against the CATALOGUE (how long does a full pass take), and
 * a retention window in days has no such relationship.
 *
 * Presentational: the draft and its save live in `useSyncJobRetentionDraft`,
 * owned by the page, so the summary rail can show the same draft and offer
 * its save beside the pacing one.
 *
 * @module apps/web/src/features/settings/components
 */
import type { ReactElement } from 'react';
import type { OperationalSettingsView } from '../api/operational-settings.types';
import type { RetentionValues } from '../hooks/use-sync-job-retention-draft';
import type { OperationalSettingsErrors } from '../lib/map-operational-settings-errors';
import { limitsFor } from '../lib/resolve-value-limits';
import { PacingValueField } from './pacing-value-field';

/**
 * Days are dragged in fives; any whole day can still be typed. Anchored at
 * zero, so 30 / 90 / 365 — the bounds and both defaults — sit on the grid.
 */
const RETENTION_STEP_DAYS = 5;

interface SyncJobRetentionSectionProps {
  view: OperationalSettingsView;
  draft: RetentionValues;
  errors: OperationalSettingsErrors;
  onChange: (next: RetentionValues) => void;
}

export function SyncJobRetentionSection({
  view,
  draft,
  errors,
  onChange,
}: SyncJobRetentionSectionProps): ReactElement {
  return (
    <section
      className="panel pacing-card"
      id="pacing-retention"
      aria-labelledby="pacing-retention-title"
    >
      <header className="pacing-card__header">
        <div>
          <p className="eyebrow">Housekeeping</p>
          <h3 className="section-title" id="pacing-retention-title">
            Job retention
          </h3>
        </div>
        <span className="panel__meta">saved on its own</span>
      </header>

      <div className="pacing-card__fields">
        <PacingValueField
          label="Completed jobs kept for"
          ariaLabel="Days a completed sync job is kept"
          description="How long a finished (succeeded) sync job's record is kept for troubleshooting, and to keep it from being re-run twice by accident. Bounded 30-365 days."
          value={draft.syncJobRetentionDays}
          limits={limitsFor(view, 'syncJobRetentionDays')}
          step={RETENTION_STEP_DAYS}
          unit="days"
          savedValue={view.syncJobRetentionDays.value}
          savedSource={view.syncJobRetentionDays.source}
          savedAboveRecommended={false}
          acknowledged={true}
          onAcknowledgedChange={() => {
            // No advisory ceiling on this knob (min === recommendedMax ===
            // absoluteMax by design, D16) — the checkbox never renders, so
            // this callback is unreachable, but the prop is required.
          }}
          error={errors.fieldErrors.syncJobRetentionDays}
          onChange={(value) => {
            onChange({ ...draft, syncJobRetentionDays: value });
          }}
        />

        <PacingValueField
          label="Failed jobs kept for"
          ariaLabel="Days a permanently-failed sync job is kept"
          description="How long a job that ran out of retries is kept. It is the only record that the work was lost, so the default is longer than a completed job's. Bounded 30-365 days."
          value={draft.syncJobDeadRetentionDays}
          limits={limitsFor(view, 'syncJobDeadRetentionDays')}
          step={RETENTION_STEP_DAYS}
          unit="days"
          savedValue={view.syncJobDeadRetentionDays.value}
          savedSource={view.syncJobDeadRetentionDays.source}
          savedAboveRecommended={false}
          acknowledged={true}
          onAcknowledgedChange={() => {}}
          error={errors.fieldErrors.syncJobDeadRetentionDays}
          onChange={(value) => {
            onChange({ ...draft, syncJobDeadRetentionDays: value });
          }}
        />
      </div>

      {errors.formErrors.length > 0 ? (
        <p className="form-field__error" role="alert">
          {errors.formErrors.join(' ')}
        </p>
      ) : null}
    </section>
  );
}
