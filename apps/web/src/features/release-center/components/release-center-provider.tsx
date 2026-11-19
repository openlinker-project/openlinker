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
import { useSession } from '../../../shared/auth/use-session';
import { useMessages } from '../../../shared/i18n';
import { interpolate } from '../../../shared/i18n';
import { APP_VERSION } from '../../../shared/config/app-version';
import { useToast } from '../../../shared/ui/toast-provider';
import type { ReleaseState } from '../api/release-state.types';
import { RELEASE_HIGHLIGHTS } from '../catalog/release-highlights';
import { RELEASE_SHOWCASES } from '../catalog/release-showcases';
import { RELEASE_STEPS } from '../catalog/release-steps';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { useReleaseCenterEnabled, useReleaseStateQuery } from '../hooks/use-release-state-query';
import { useNotificationMessages } from '../hooks/use-notification-messages';
import { useNotificationDemo } from '../hooks/notification-demo';
import { useNotificationRules } from '../hooks/use-notification-rules';
import { useReleaseStepsMutation } from '../hooks/use-release-steps-mutation';
import {
  bindNotificationsToUser,
  onNotificationArrival,
  type MessageNotification,
} from '../lib/notification-store';
import {
  buildReleaseNotifications,
  buildShowcaseInstances,
  buildStepInstances,
  summarizeBell,
  type BellSummary,
  type ReleaseNotification,
  type ShowcaseInstance,
  type StepInstance,
} from '../lib/release-notifications';

export interface ReleaseCenterView {
  state: ReleaseState;
  instances: readonly StepInstance[];
  /** Tour-only items; never part of the bell count or the setup tally. */
  showcases: readonly ShowcaseInstance[];
  notifications: readonly ReleaseNotification[];
  /** Plain messages published by features, newest first. */
  messages: readonly MessageNotification[];
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
  // `enabled` is the update switch: the window, the release cards and the guides that belong to a release.
  // The bell and its messages do not depend on it, only on being allowed to read.
  const enabled = useReleaseCenterEnabled();
  const { canRead, canWriteSteps } = useReleaseCenterAccess();
  const stateQuery = useReleaseStateQuery();
  const connectionsQuery = useConnectionsQuery(undefined, { enabled: canRead && stateQuery.data !== undefined });
  const stepsMutation = useReleaseStepsMutation();
  const { showToast } = useToast();
  const copy = useMessages('release-center');
  const state = stateQuery.data ?? EMPTY_STATE;

  const instances = useMemo(
    () => {
      const all = buildStepInstances(
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
      );
      // With the switch off only what belongs to no release is left (a recommended first setup).
      return enabled ? all : all.filter((instance) => instance.step.introducedIn === undefined);
    },
    [connectionsQuery.data, enabled]
  );
  const showcases = useMemo(() => {
    const all = buildShowcaseInstances(RELEASE_SHOWCASES, APP_VERSION);
    return enabled ? all : all.filter((instance) => instance.showcase.introducedIn === undefined);
  }, [enabled]);
  const notifications = useMemo(
    () =>
      buildReleaseNotifications(
        instances,
        enabled ? Object.keys(RELEASE_HIGHLIGHTS) : [],
        APP_VERSION,
        showcases
      ),
    [instances, showcases, enabled]
  );
  const now = useMemo(() => Date.now(), [state]);
  const { session } = useSession();
  const userId = session.user?.id ?? null;
  const ready = canRead && stateQuery.data !== undefined;
  const active = ready;
  useEffect(() => {
    bindNotificationsToUser(active ? userId : null);
  }, [active, userId]);
  useNotificationRules();
  useNotificationDemo(active, userId);
  const messages = useNotificationMessages();
  // An unread warning or error counts toward the badge; a plain info or success only shows its dot.
  const summary = useMemo(() => {
    const base = summarizeBell(instances, state, now);
    const alerts = messages.filter((message) => {
      if (message.severity !== 'warning' && message.severity !== 'error') return false;
      const row = state.user.find((entry) => entry.itemKey === message.itemKey);
      return !row;
    }).length;
    const count = base.count + alerts;
    return { ...base, count, showDot: count === 0 && base.optionalLeft > 0 };
  }, [instances, state, now, messages]);

  // Ring when the count goes up or a new notification appears, never on first load.
  const [ringSignal, setRingSignal] = useState(0);
  const previous = useRef<{ count: number; notifications: number; doneKeys: Set<string> } | null>(
    null
  );
  useEffect(
    () => onNotificationArrival(() => setRingSignal((value) => value + 1)),
    []
  );
  useEffect(() => {
    if (!ready) return;
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
  }, [state, ready]);

  const value = useMemo<ReleaseCenterView | null>(
    () =>
      // The bell stays while something can be in it: release content, or at least one message.
      ready && (enabled || notifications.length > 0 || messages.length > 0)
        ? { state, instances, showcases, notifications, messages, summary, ringSignal, now }
        : null,
    [ready, enabled, state, instances, showcases, notifications, messages, summary, ringSignal, now]
  );

  return <ReleaseCenterContext.Provider value={value}>{children}</ReleaseCenterContext.Provider>;
}
