/**
 * Inventory Movement Retention Draft (#3565)
 *
 * The local draft for how long stock movement history is kept, and its own save.
 * Like the sync-job retention it is housekeeping, not pacing: no catalogue-size
 * projection and no confirmation step, and its mutation is a separate instance so
 * a refused value here never surfaces as a pacing error.
 *
 * Unlike the sync-job windows this knob has a RECOMMENDED ceiling below its
 * absolute one, so the draft also owns the operator's explicit acknowledgement.
 * It is never inferred from the value being high, and it is sent as
 * `acknowledgeAboveRecommended` only when the saved draft actually crosses.
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
import { isAboveRecommended, limitsFor } from '../lib/resolve-value-limits';
import { useUpdateOperationalSettingsMutation } from './use-update-operational-settings-mutation';

export interface InventoryMovementRetentionDraft {
  /** `null` until the settings have loaded, or when the API predates the knob. */
  readonly days: number | null;
  readonly savedDays: number | null;
  readonly acknowledged: boolean;
  /** True when the draft crosses the recommended ceiling and is not yet acknowledged. */
  readonly needsAcknowledgement: boolean;
  readonly changed: boolean;
  readonly saving: boolean;
  readonly errors: OperationalSettingsErrors;
  setDays: (next: number) => void;
  setAcknowledged: (next: boolean) => void;
  reset: () => void;
  save: () => void;
  /** Clears the stored value back to the env var, then the built-in default (`null`). */
  clear: () => void;
}

export function useInventoryMovementRetentionDraft(
  view: OperationalSettingsView | null
): InventoryMovementRetentionDraft {
  const mutation = useUpdateOperationalSettingsMutation();
  const { showToast } = useToast();
  const [days, setDaysState] = useState<number | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const setting = view?.inventoryMovementRetentionDays;
  const savedDays = setting?.value ?? null;
  const savedStamp = setting === undefined ? null : `${String(setting.value)}:${setting.source}`;

  // Adopt the server's value once, and again only when the saved row changes:
  // a refetch that changed nothing must never discard an edit, and a fresh saved
  // row is a fresh decision, so an acknowledgement does not carry over.
  useEffect(() => {
    setDaysState(savedDays);
    setAcknowledged(false);
    // Deliberately just the saved stamp.
  }, [savedStamp]);

  const limits = view !== null && setting !== undefined ? limitsFor(view, 'inventoryMovementRetentionDays') : null;
  const crossing = days !== null && limits !== null && isAboveRecommended(days, limits);

  return {
    days,
    savedDays,
    acknowledged,
    needsAcknowledgement: crossing && !acknowledged,
    changed: days !== null && savedDays !== null && days !== savedDays,
    saving: mutation.isPending,
    errors: mutation.error
      ? mapOperationalSettingsErrors(mutation.error)
      : NO_OPERATIONAL_SETTINGS_ERRORS,
    setDays: setDaysState,
    setAcknowledged,
    reset: (): void => {
      setDaysState(savedDays);
      setAcknowledged(false);
    },
    clear: (): void => {
      mutation.mutate(
        { inventoryMovementRetentionDays: null },
        {
          onSuccess: () => {
            showToast({
              tone: 'success',
              title: 'History retention reset',
              description: 'The default window applies from the next clean-up.',
            });
          },
        }
      );
    },
    save: (): void => {
      if (days === null) {
        return;
      }
      mutation.mutate(
        {
          inventoryMovementRetentionDays: days,
          // Set from the operator's explicit acknowledgement of a crossing only.
          ...(crossing && acknowledged ? { acknowledgeAboveRecommended: true } : {}),
        },
        {
          onSuccess: () => {
            showToast({
              tone: 'success',
              title: 'History retention saved',
              description: 'The next clean-up uses the new window.',
            });
          },
        }
      );
    },
  };
}
