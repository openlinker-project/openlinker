/**
 * Sync Job Retention Section (#2946, D16)
 *
 * How long a finished sync job's row is kept — a hygiene setting, not a
 * pacing one, so it is deliberately a SEPARATE, self-contained panel rather
 * than woven into `SyncPacingValues` / `diffSyncPacing` / `projectSyncPacing`:
 * those exist to project a value against the CATALOGUE (how long does a full
 * pass take), and a retention window in days has no such relationship. This
 * section carries its own local draft state and its own immediate save,
 * mounted once on the settings page.
 *
 * `useOperationalSettingsQuery()` / `useUpdateOperationalSettingsMutation()`
 * are the SAME hooks the sweep-pacing form uses — React Query dedups the
 * identical query key, so mounting them a second time here costs no extra
 * request, and a save from either section invalidates the same cache entry
 * so the other section picks up the fresh `source` on its next render.
 *
 * @module apps/web/src/features/settings/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { Button } from '../../../shared/ui/button';
import { useOperationalSettingsQuery } from '../hooks/use-operational-settings-query';
import { useUpdateOperationalSettingsMutation } from '../hooks/use-update-operational-settings-mutation';
import { mapOperationalSettingsErrors, NO_OPERATIONAL_SETTINGS_ERRORS } from '../lib/map-operational-settings-errors';
import { limitsFor } from '../lib/resolve-value-limits';
import { PacingValueField } from './pacing-value-field';

interface RetentionDraft {
  readonly syncJobRetentionDays: number;
  readonly syncJobDeadRetentionDays: number;
}

export function SyncJobRetentionSection(): ReactElement | null {
  const query = useOperationalSettingsQuery();
  const mutation = useUpdateOperationalSettingsMutation();

  const [draft, setDraft] = useState<RetentionDraft | null>(null);

  const view = query.data ?? null;
  const savedStamp =
    view === null
      ? null
      : `${String(view.syncJobRetentionDays.value)}:${view.syncJobRetentionDays.source}:${String(
          view.syncJobDeadRetentionDays.value,
        )}:${view.syncJobDeadRetentionDays.source}`;

  // Adopt the server's values once, and again whenever the saved row changes
  // underneath us — the same "keyed on the saved stamp, not on `view`" shape
  // the sweep-pacing form uses, so a background refetch that changed nothing
  // never discards an edit in progress.
  useEffect(() => {
    if (view !== null) {
      setDraft({
        syncJobRetentionDays: view.syncJobRetentionDays.value,
        syncJobDeadRetentionDays: view.syncJobDeadRetentionDays.value,
      });
    }
    // Dependency list is deliberately just the saved stamp; `view` is read
    // inside and must not re-trigger this (the sweep-pacing form's own
    // `useEffect` above follows the identical shape for the identical reason).
  }, [savedStamp]);

  if (query.isLoading) {
    return <LoadingState title="Job retention" message="Loading job retention settings…" />;
  }
  if (query.isError || view === null || draft === null) {
    return (
      <ErrorState title="Job retention" message="Could not load job retention settings." />
    );
  }

  const errors = mutation.error
    ? mapOperationalSettingsErrors(mutation.error)
    : NO_OPERATIONAL_SETTINGS_ERRORS;

  const changed =
    draft.syncJobRetentionDays !== view.syncJobRetentionDays.value ||
    draft.syncJobDeadRetentionDays !== view.syncJobDeadRetentionDays.value;

  const handleSave = (): void => {
    mutation.mutate({
      syncJobRetentionDays: draft.syncJobRetentionDays,
      syncJobDeadRetentionDays: draft.syncJobDeadRetentionDays,
    });
  };

  return (
    <article className="panel">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Housekeeping</p>
          <h3 className="section-title">Job retention</h3>
        </div>
      </div>

      <div className="field-stack">
        <PacingValueField
          label="Completed jobs kept for"
          ariaLabel="Days a completed sync job is kept"
          description="How long a finished (succeeded) sync job's record is kept for troubleshooting, and to keep it from being re-run twice by accident. Bounded 30-365 days."
          value={draft.syncJobRetentionDays}
          limits={limitsFor(view, 'syncJobRetentionDays')}
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
            setDraft({ ...draft, syncJobRetentionDays: value });
          }}
        />

        <PacingValueField
          label="Failed jobs kept for"
          ariaLabel="Days a permanently-failed sync job is kept"
          description="How long a job that ran out of retries is kept. It is the only record that the work was lost, so the default is longer than a completed job's. Bounded 30-365 days."
          value={draft.syncJobDeadRetentionDays}
          limits={limitsFor(view, 'syncJobDeadRetentionDays')}
          savedValue={view.syncJobDeadRetentionDays.value}
          savedSource={view.syncJobDeadRetentionDays.source}
          savedAboveRecommended={false}
          acknowledged={true}
          onAcknowledgedChange={() => {}}
          error={errors.fieldErrors.syncJobDeadRetentionDays}
          onChange={(value) => {
            setDraft({ ...draft, syncJobDeadRetentionDays: value });
          }}
        />
      </div>

      {errors.formErrors.length > 0 ? (
        <p className="form-field__error" role="alert">
          {errors.formErrors.join(' ')}
        </p>
      ) : null}

      <div className="form-actions">
        <Button
          disabled={!changed || mutation.isPending}
          onClick={handleSave}
        >
          Save retention
        </Button>
        <Button
          tone="secondary"
          disabled={!changed}
          onClick={() => {
            setDraft({
              syncJobRetentionDays: view.syncJobRetentionDays.value,
              syncJobDeadRetentionDays: view.syncJobDeadRetentionDays.value,
            });
          }}
        >
          Undo my edits
        </Button>
      </div>
    </article>
  );
}
