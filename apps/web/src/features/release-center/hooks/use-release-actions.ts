/**
 * Release panel actions (#4148)
 *
 * Every action the panel offers, each with the toast (and Undo where the change
 * is reversible) the design asks for. User-scope actions (archive, delete,
 * read, snooze) are open to every role that may read; installation actions
 * (done, not applicable, reopen, mark all) are admin-only, and for anyone else
 * the underlying mutation resolves without a request.
 *
 * @module features/release-center/hooks
 */
import { createElement, useCallback, useMemo } from 'react';
import { useMessages } from '../../../shared/i18n';
import { useToast, type ToastAction } from '../../../shared/ui/toast-provider';
import { ReleaseIcon } from '../components/release-icon';
import type {
  InstallationReleaseItemChange,
  UserReleaseItemChange,
} from '../api/release-state.types';
import { SNOOZE_DAYS, type StepInstance } from '../lib/release-notifications';
import { useReleaseItemStatesMutation } from './use-release-item-states-mutation';
import { useReleaseStepsMutation } from './use-release-steps-mutation';

const undoIcon = createElement(ReleaseIcon, { name: 'undo', size: 12 });

export interface ReleaseActions {
  archive: (itemKey: string) => void;
  restore: (itemKey: string) => void;
  remove: (itemKey: string) => void;
  markRead: (itemKeys: readonly string[]) => void;
  snoozeStep: (itemKey: string) => void;
  markStep: (itemKey: string, status: 'done' | 'not_applicable') => void;
  reopenStep: (itemKey: string) => void;
  markAllDone: (instances: readonly StepInstance[]) => void;
}

export function useReleaseActions(): ReleaseActions {
  const items = useReleaseItemStatesMutation();
  const steps = useReleaseStepsMutation();
  const { showToast } = useToast();
  // The confirmation toast of the approved mockup: it stays 6s when it offers
  // Undo and 3.2s when it only informs.
  const note = useCallback(
    (description: string, action?: ToastAction): void =>
      showToast({
        tone: 'info',
        variant: 'inverse',
        description,
        action,
        durationMs: action ? 6000 : 3200,
      }),
    [showToast]
  );
  const copy = useMessages('release-center').panel;
  const writeItems = items.mutate;
  const writeSteps = steps.mutate;

  const user = useCallback(
    (
      changes: readonly UserReleaseItemChange[],
      undo: readonly UserReleaseItemChange[] | null,
      message: string
    ): void => {
      writeItems(changes, {
        onError: () => showToast({ tone: 'error', description: copy.toastFailed }),
      });
      note(message, undo ? { label: copy.undo, onClick: () => writeItems(undo), icon: undoIcon } : undefined);
    },
    [writeItems, showToast, copy, note]
  );

  const installation = useCallback(
    (
      changes: readonly InstallationReleaseItemChange[],
      undo: readonly InstallationReleaseItemChange[],
      message: string
    ): void => {
      writeSteps(changes, {
        onError: () => showToast({ tone: 'error', description: copy.toastFailed }),
      });
      note(message, { label: copy.undo, onClick: () => writeSteps(undo), icon: undoIcon });
    },
    [writeSteps, showToast, copy, note]
  );

  return useMemo<ReleaseActions>(
    () => ({
      archive: (key) =>
        user(
          [{ itemKey: key, status: 'archived' }],
          [{ itemKey: key, status: 'open' }],
          copy.toastArchived
        ),
      restore: (key) => writeItems([{ itemKey: key, status: 'open' }]),
      remove: (key) =>
        user(
          [{ itemKey: key, status: 'deleted' }],
          [{ itemKey: key, status: 'open' }],
          copy.toastDeleted
        ),
      markRead: (keys) => {
        if (keys.length === 0) return;
        user(
          keys.map((itemKey) => ({ itemKey, status: 'open' as const })),
          null,
          copy.toastMarkedRead
        );
      },
      snoozeStep: (key) =>
        user(
          [
            {
              itemKey: key,
              status: 'snoozed',
              snoozedUntil: new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString(),
            },
          ],
          [{ itemKey: key, status: 'open', snoozedUntil: null }],
          copy.toastReminded
        ),
      markStep: (key, status) =>
        installation(
          [{ itemKey: key, status, doneVia: 'manual' }],
          [{ itemKey: key, status: 'open', doneVia: null }],
          status === 'done' ? copy.toastStaysAsIs : copy.toastNotApplicable
        ),
      reopenStep: (key) => {
        writeSteps([{ itemKey: key, status: 'open', doneVia: null }]);
        note(copy.toastReopened);
      },
      markAllDone: (instances) => {
        const keys = instances.map((instance) => instance.itemKey);
        if (keys.length === 0) return;
        installation(
          keys.map((itemKey) => ({ itemKey, status: 'done' as const, doneVia: 'manual' as const })),
          keys.map((itemKey) => ({ itemKey, status: 'open' as const, doneVia: null })),
          copy.toastAllDone
        );
      },
    }),
    [user, installation, writeItems, writeSteps, showToast, copy]
  );
}
