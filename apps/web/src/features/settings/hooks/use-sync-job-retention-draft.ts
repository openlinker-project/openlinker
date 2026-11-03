/**
 * Sync Job Retention Draft (#2946, D16)
 *
 * The local draft for the two retention windows, and their own save.
 *
 * Retention is a hygiene setting, not a pacing one: it has no catalogue-size
 * projection and no confirmation step, so it never joins `SyncPacingValues` /
 * `diffSyncPacing`. It is lifted out of its card into this hook only so the
 * page's summary rail can show it and offer its save beside the pacing one.
 *
 * The mutation is its OWN instance, separate from the pacing form's, so a
 * refused retention value never surfaces as a pacing error and vice versa.
 *
 * @module apps/web/src/features/settings/hooks
 */
import { useEffect, useState } from 'react';
import { useToast } from '../../../shared/ui/toast-provider';
import type { OperationalSettingsView } from '../api/operational-settings.types';
import {
  mapOperationalSettingsErrors,
  NO_OPERATIONAL_SETTINGS_ERRORS,
  type OperationalSettingsErrors,
} from '../lib/map-operational-settings-errors';
import { useUpdateOperationalSettingsMutation } from './use-update-operational-settings-mutation';

export interface RetentionValues {
  readonly syncJobRetentionDays: number;
  readonly syncJobDeadRetentionDays: number;
}

export interface SyncJobRetentionDraft {
  /** `null` until the settings have loaded. */
  readonly draft: RetentionValues | null;
  readonly saved: RetentionValues | null;
  /** How many of the two windows differ from what is saved. */
  readonly changeCount: number;
  readonly saving: boolean;
  readonly errors: OperationalSettingsErrors;
  setDraft: (next: RetentionValues) => void;
  reset: () => void;
  save: () => void;
}

function toRetentionValues(view: OperationalSettingsView): RetentionValues {
  return {
    syncJobRetentionDays: view.syncJobRetentionDays.value,
    syncJobDeadRetentionDays: view.syncJobDeadRetentionDays.value,
  };
}

export function useSyncJobRetentionDraft(
  view: OperationalSettingsView | null
): SyncJobRetentionDraft {
  const mutation = useUpdateOperationalSettingsMutation();
  const { showToast } = useToast();
  const [draft, setDraft] = useState<RetentionValues | null>(null);

  const saved = view === null ? null : toRetentionValues(view);
  const savedStamp =
    view === null
      ? null
      : `${String(view.syncJobRetentionDays.value)}:${view.syncJobRetentionDays.source}:${String(
          view.syncJobDeadRetentionDays.value
        )}:${view.syncJobDeadRetentionDays.source}`;

  // Adopt the server's values once, and again whenever the saved row changes
  // underneath us — keyed on the retention fields themselves, so a refetch
  // that changed nothing (or a pacing save) never discards an edit here.
  useEffect(() => {
    if (view !== null) {
      setDraft(toRetentionValues(view));
    }
    // Dependency list is deliberately just the saved stamp; `view` is read
    // inside and must not re-trigger this.
  }, [savedStamp]);

  const changeCount =
    draft === null || saved === null
      ? 0
      : Number(draft.syncJobRetentionDays !== saved.syncJobRetentionDays) +
        Number(draft.syncJobDeadRetentionDays !== saved.syncJobDeadRetentionDays);

  return {
    draft,
    saved,
    changeCount,
    saving: mutation.isPending,
    errors: mutation.error
      ? mapOperationalSettingsErrors(mutation.error)
      : NO_OPERATIONAL_SETTINGS_ERRORS,
    setDraft,
    reset: (): void => {
      if (saved !== null) {
        setDraft(saved);
      }
    },
    save: (): void => {
      if (draft === null) {
        return;
      }
      // Both windows travel together, as they always have: the server
      // validates them as a pair and a half-saved pair is not a state anyone
      // chose.
      mutation.mutate(
        {
          syncJobRetentionDays: draft.syncJobRetentionDays,
          syncJobDeadRetentionDays: draft.syncJobDeadRetentionDays,
        },
        {
          onSuccess: () => {
            showToast({
              tone: 'success',
              title: 'Job retention saved',
              description: 'The next clean-up uses the new windows.',
            });
          },
        }
      );
    },
  };
}
