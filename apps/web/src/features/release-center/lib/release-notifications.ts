/**
 * Release notifications and the bell count (#4148, ADR-086)
 *
 * Pure derivation of what the bell and the panel show, from the release state
 * and the step catalog. Nothing here reads the clock on its own: `now` is
 * passed in, so a snoozed step reappearing after seven days is testable.
 *
 * Release items are derived from the catalog (one per minor that ships a step
 * or highlights), never stored: only the per-user state of each item is. The
 * panel has no source of "attention" items today (the old static "Alerts" had
 * none), so it ships release items only.
 *
 * @module features/release-center
 */
import type {
  ReleaseShowcaseEntry,
  ReleaseStepEntry,
  ReleaseStepImportance,
} from '../catalog/release-step.types';
import type { ReleaseItemState, ReleaseState } from '../api/release-state.types';
import { compareVersions, isValidVersion } from './compare-versions';
import { visibleSteps } from './visible-steps';
import { releaseStepItemKey } from './release-state-merge';

export const SNOOZE_DAYS = 7;

/** `minor` of the card that collects steps which belong to no release. */
export const GENERAL_MINOR = 'general';

export interface StepInstance {
  step: ReleaseStepEntry;
  connectionId: string | null;
  connectionName: string | null;
  itemKey: string;
  importance: ReleaseStepImportance;
}

/** A tour-only item: one per showcase, never per connection. */
export interface ShowcaseInstance {
  showcase: ReleaseShowcaseEntry;
  itemKey: string;
}

export type StepStatus = 'open' | 'done' | 'not_applicable' | 'snoozed';

export interface ReleaseNotification {
  /** `release-<major>-<minor>`: dots are not allowed in an item key. */
  itemKey: string;
  /** `major.minor`. */
  minor: string;
  /** Version shown on the badge. */
  version: string;
  stepKeys: readonly string[];
  /** Showcase items of this release; kept apart so "N steps" never counts them. */
  showcaseKeys: readonly string[];
}

/** Item key of a release notification. */
export function releaseNotificationKey(minor: string): string {
  return `release-${minor.replace('.', '-')}`;
}

function minorOf(version: string): string | null {
  const match = /^(\d+)\.(\d+)\./.exec(version);
  return match ? `${match[1]}.${match[2]}` : null;
}

/**
 * One notification per minor that ships a step, newest first, never newer than
 * the running build. Steps are matched by `introducedIn`.
 */
export function buildReleaseNotifications(
  instances: readonly StepInstance[],
  highlightMinors: readonly string[],
  appVersion: string,
  showcases: readonly ShowcaseInstance[] = []
): ReleaseNotification[] {
  if (!isValidVersion(appVersion)) return [];
  const byMinor = new Map<string, { version: string; keys: string[]; showcaseKeys: string[] }>();
  const touch = (
    minor: string,
    version: string
  ): { version: string; keys: string[]; showcaseKeys: string[] } => {
    const existing = byMinor.get(minor);
    if (existing) return existing;
    const created = { version, keys: [] as string[], showcaseKeys: [] as string[] };
    byMinor.set(minor, created);
    return created;
  };
  for (const minor of highlightMinors) {
    const version = `${minor}.0`;
    if (isValidVersion(version) && compareVersions(version, appVersion) <= 0) touch(minor, version);
  }
  for (const instance of instances) {
    // A step with no release goes to the one general card.
    if (instance.step.introducedIn === undefined) {
      touch(GENERAL_MINOR, '').keys.push(instance.itemKey);
      continue;
    }
    const minor = minorOf(instance.step.introducedIn);
    if (!minor) continue;
    touch(minor, instance.step.introducedIn).keys.push(instance.itemKey);
  }
  for (const instance of showcases) {
    // A standalone tour belongs to no release, so no release notification lists it.
    const introducedIn = instance.showcase.introducedIn;
    const minor = introducedIn ? minorOf(introducedIn) : null;
    if (!introducedIn || !minor) continue;
    touch(minor, introducedIn).showcaseKeys.push(instance.itemKey);
  }
  return [...byMinor.entries()]
    .map(([minor, value]) => ({
      itemKey: releaseNotificationKey(minor),
      minor,
      version: value.version,
      stepKeys: value.keys,
      showcaseKeys: value.showcaseKeys,
    }))
    .sort((a, b) => {
      // The general card, which has no version, always comes last.
      if (a.minor === GENERAL_MINOR || b.minor === GENERAL_MINOR) {
        return a.minor === b.minor ? 0 : a.minor === GENERAL_MINOR ? 1 : -1;
      }
      return compareVersions(b.version, a.version);
    });
}

/** Instances of every visible step: one per connection for a connection step. */
export function buildStepInstances(
  steps: readonly ReleaseStepEntry[],
  appVersion: string,
  connections: readonly {
    id: string;
    name: string;
    platformType: string;
    capabilities: readonly string[];
    config: Readonly<Record<string, unknown>>;
  }[],
  unassignedCarrierMethods: (connectionId: string) => number | null
): StepInstance[] {
  const out: StepInstance[] = [];
  for (const step of visibleSteps(steps, appVersion)) {
    if (step.scope === 'installation') {
      const ctx = { connection: null, unassignedCarrierMethods: null };
      if (!step.appliesWhen(ctx)) continue;
      out.push({
        step,
        connectionId: null,
        connectionName: null,
        itemKey: releaseStepItemKey(step.id, null),
        importance: step.importance(ctx),
      });
      continue;
    }
    for (const connection of connections) {
      const ctx = {
        connection: {
          id: connection.id,
          platformType: connection.platformType,
          capabilities: connection.capabilities,
          config: connection.config,
        },
        unassignedCarrierMethods: unassignedCarrierMethods(connection.id),
      };
      if (!step.appliesWhen(ctx)) continue;
      out.push({
        step,
        connectionId: connection.id,
        connectionName: connection.name,
        itemKey: releaseStepItemKey(step.id, connection.id),
        importance: step.importance(ctx),
      });
    }
  }
  return out;
}

function rowOf(rows: readonly ReleaseItemState[], itemKey: string): ReleaseItemState | undefined {
  return rows.find((row) => row.itemKey === itemKey);
}

/** Effective status of a step: a live snooze wins over an open installation status. */
export function stepStatusOf(
  state: ReleaseState,
  itemKey: string,
  now: number
): { status: StepStatus; doneVia: ReleaseItemState['doneVia'] } {
  const installation = rowOf(state.installation, itemKey);
  if (installation?.status === 'done') return { status: 'done', doneVia: installation.doneVia };
  if (installation?.status === 'not_applicable') {
    return { status: 'not_applicable', doneVia: installation.doneVia };
  }
  const user = rowOf(state.user, itemKey);
  if (user?.status === 'snoozed' && user.snoozedUntil && Date.parse(user.snoozedUntil) > now) {
    return { status: 'snoozed', doneVia: null };
  }
  return { status: 'open', doneVia: null };
}

export function stepsLeft(
  instances: readonly StepInstance[],
  state: ReleaseState,
  now: number
): { requiredLeft: number; optionalLeft: number } {
  let requiredLeft = 0;
  let optionalLeft = 0;
  for (const instance of instances) {
    if (stepStatusOf(state, instance.itemKey, now).status !== 'open') continue;
    if (instance.importance === 'required') requiredLeft += 1;
    else optionalLeft += 1;
  }
  return { requiredLeft, optionalLeft };
}

export type NotificationStatus = 'active' | 'archived' | 'deleted';

/** A notification with no user row is active and unread. */
export function notificationStatusOf(
  state: ReleaseState,
  itemKey: string
): { status: NotificationStatus; unread: boolean } {
  const row = rowOf(state.user, itemKey);
  if (!row) return { status: 'active', unread: true };
  if (row.status === 'archived') return { status: 'archived', unread: false };
  if (row.status === 'deleted') return { status: 'deleted', unread: false };
  return { status: 'active', unread: false };
}

export interface BellSummary {
  count: number;
  requiredLeft: number;
  optionalLeft: number;
  /** Grey dot: nothing is required but optional steps still wait. */
  showDot: boolean;
}

/**
 * Badge count = required steps left + unread attention items. Attention items
 * have no source yet, so the second term is always zero.
 */
export function summarizeBell(
  instances: readonly StepInstance[],
  state: ReleaseState,
  now: number,
  unreadAttentionItems = 0
): BellSummary {
  const { requiredLeft, optionalLeft } = stepsLeft(instances, state, now);
  const count = requiredLeft + unreadAttentionItems;
  return { count, requiredLeft, optionalLeft, showDot: count === 0 && optionalLeft > 0 };
}

/** Item key of a showcase; the prefix keeps it clear of every step key. */
export function showcaseItemKey(id: string): string {
  return `showcase-${id}`;
}

/** Visible showcases that apply to this installation. */
export function buildShowcaseInstances(
  showcases: readonly ReleaseShowcaseEntry[],
  appVersion: string
): ShowcaseInstance[] {
  const released = visibleSteps(
    showcases.filter((showcase): showcase is ReleaseShowcaseEntry & { introducedIn: string } =>
      Boolean(showcase.introducedIn)
    ),
    appVersion
  );
  const standalone = showcases.filter((showcase) => !showcase.introducedIn);
  return [...released, ...standalone]
    .filter((showcase) => showcase.appliesWhen())
    .map((showcase) => ({ showcase, itemKey: showcaseItemKey(showcase.id) }));
}

/**
 * A showcase is seen once its tour reached the last stop or was skipped. That is
 * stored as the caller's own archived row: a person sees a tour, so one admin
 * watching it must not hide it from everyone else, and every role may write it.
 */
export function showcaseSeenOf(state: ReleaseState, itemKey: string): boolean {
  return rowOf(state.user, itemKey)?.status === 'archived';
}

export interface ShowcaseTally {
  /** Stops of the showcases already seen. */
  viewed: number;
  /** Stops of every showcase in the list. */
  total: number;
}

export function showcaseTally(
  instances: readonly ShowcaseInstance[],
  state: ReleaseState
): ShowcaseTally {
  let viewed = 0;
  let total = 0;
  for (const instance of instances) {
    const stops = instance.showcase.stops.length;
    total += stops;
    if (showcaseSeenOf(state, instance.itemKey)) viewed += stops;
  }
  return { viewed, total };
}
