/**
 * Release center provider (#4148, ADR-085)
 *
 * Derives, once, what the bell and the panel show: step instances (one per
 * connection for a connection step), release notifications, and the badge
 * summary. Mounted by `AuthenticatedAppLayout` around `AppShell`, after every
 * redirect (password change, consent, bench), so a session that will be
 * redirected never reaches it. The queries are gated on `canRead` (session
 * ready and a role the API admits), so nothing is requested before that.
 *
 * It also owns the two ambient reactions: a toast with Undo when a step is
 * detected as done, and the "ring" signal the bell animates on when something
 * new arrives. Both skip the first data load, so opening the app never toasts
 * or rings for state that was already there.
 *
 * @module features/release-center/components
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import { useConnectionsQuery } from '../../connections';
import { useMessages } from '../../../shared/i18n';
import { interpolate } from '../../../shared/i18n';
import { APP_VERSION } from '../../../shared/config/app-version';
import { useToast } from '../../../shared/ui/toast-provider';
import type { ReleaseState } from '../api/release-state.types';
import { RELEASE_HIGHLIGHTS } from '../catalog/release-highlights';
import { RELEASE_STEPS } from '../catalog/release-steps';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { useReleaseCenterEnabled, useReleaseStateQuery } from '../hooks/use-release-state-query';
import { useReleaseStepsMutation } from '../hooks/use-release-steps-mutation';
import {
  buildReleaseNotifications,
  buildStepInstances,
  summarizeBell,
  type BellSummary,
  type ReleaseNotification,
  type StepInstance,
} from '../lib/release-notifications';

export interface ReleaseCenterView {
  state: ReleaseState;
  instances: readonly StepInstance[];
  notifications: readonly ReleaseNotification[];
  summary: BellSummary;
  /** Increments when something new should draw the eye. */
  ringSignal: number;
  now: number;
}

const ReleaseCenterContext = createContext<ReleaseCenterView | null>(null);

/** `null` when the feature is off, the session may not read, or no provider is mounted. */
export function useReleaseCenterView(): ReleaseCenterView | null {
  return useContext(ReleaseCenterContext);
}

const EMPTY_STATE: ReleaseState = { enabled: false, cursor: null, user: [], installation: [] };

export function ReleaseCenterProvider({ children }: PropsWithChildren): ReactElement {
  const enabled = useReleaseCenterEnabled();
  const { canRead, canWriteSteps } = useReleaseCenterAccess();
  const stateQuery = useReleaseStateQuery();
  const connectionsQuery = useConnectionsQuery(undefined, { enabled: enabled });
  const stepsMutation = useReleaseStepsMutation();
  const { showToast } = useToast();
  const copy = useMessages('release-center');
  const state = stateQuery.data ?? EMPTY_STATE;

  const instances = useMemo(
    () =>
      buildStepInstances(
        RELEASE_STEPS,
        APP_VERSION,
        (connectionsQuery.data ?? [])
          .filter((connection) => connection.status === 'active')
          .map((connection) => ({
          id: connection.id,
          name: connection.name,
          platformType: connection.platformType,
          capabilities: connection.enabledCapabilities,
          config: connection.config,
        })),
        // The carrier-method count needs the mapping reads, which the bell does
        // not issue; a step that is required only because of it reads optional.
        () => 0
      ),
    [connectionsQuery.data]
  );
  const notifications = useMemo(
    () => buildReleaseNotifications(instances, Object.keys(RELEASE_HIGHLIGHTS), APP_VERSION),
    [instances]
  );
  const now = useMemo(() => Date.now(), [state]);
  const summary = useMemo(() => summarizeBell(instances, state, now), [instances, state, now]);

  // Ring when the count goes up or a new notification appears, never on first load.
  const [ringSignal, setRingSignal] = useState(0);
  const previous = useRef<{ count: number; notifications: number; doneKeys: Set<string> } | null>(
    null
  );
  useEffect(() => {
    if (!enabled || stateQuery.data === undefined) return;
    const doneKeys = new Set(
      state.installation.filter((row) => row.status === 'done').map((row) => row.itemKey)
    );
    const before = previous.current;
    previous.current = { count: summary.count, notifications: notifications.length, doneKeys };
    if (before === null) return;
    if (summary.count > before.count || notifications.length > before.notifications) {
      setRingSignal((value) => value + 1);
    }
    for (const row of state.installation) {
      if (row.status !== 'done' || row.doneVia !== 'auto' || before.doneKeys.has(row.itemKey)) {
        continue;
      }
      const instance = instances.find((candidate) => candidate.itemKey === row.itemKey);
      if (!instance) continue;
      const stepCopy = (copy.steps as unknown as Record<string, { title: string } | undefined>)[
        instance.step.id
      ];
      showToast({
        tone: 'success',
        description: interpolate(copy.panel.toastAutoDetected, {
          title: stepCopy?.title ?? instance.step.id,
        }),
        action: canWriteSteps
          ? {
              label: copy.panel.undo,
              onClick: () =>
                stepsMutation.mutate([{ itemKey: row.itemKey, status: 'open', doneVia: null }]),
            }
          : undefined,
      });
    }
    // Only the data should retrigger this; the helpers are stable per render.
  }, [state, enabled]);

  const value = useMemo<ReleaseCenterView | null>(
    () =>
      canRead && enabled
        ? { state, instances, notifications, summary, ringSignal, now }
        : null,
    [canRead, enabled, state, instances, notifications, summary, ringSignal, now]
  );

  return <ReleaseCenterContext.Provider value={value}>{children}</ReleaseCenterContext.Provider>;
}
