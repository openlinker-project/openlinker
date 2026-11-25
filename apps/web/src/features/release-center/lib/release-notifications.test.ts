import { describe, expect, it } from 'vitest';
import type { ReleaseStepEntry } from '../catalog/release-step.types';
import type { ReleaseState } from '../api/release-state.types';
import {
  buildReleaseNotifications,
  notificationStatusOf,
  releaseNotificationKey,
  stepStatusOf,
  summarizeBell,
  type StepInstance,
} from './release-notifications';

const NOW = Date.parse('2026-11-17T10:00:00Z');

function instance(itemKey: string, importance: 'required' | 'optional'): StepInstance {
  return {
    step: { id: itemKey, introducedIn: '0.20.0' } as ReleaseStepEntry,
    connectionId: null,
    connectionName: null,
    itemKey,
    importance,
  };
}

function row(itemKey: string, scope: string, status: string, extra: object = {}): ReleaseState['user'][number] {
  return {
    itemKey,
    scope,
    status,
    doneVia: null,
    snoozedUntil: null,
    updatedAt: '2026-11-17T09:00:00Z',
    actedByUserId: null,
    ...extra,
  };
}

const empty: ReleaseState = { enabled: true, cursor: null, user: [], installation: [] };

describe('release notifications', () => {
  it('should key a release by its minor without dots', () => {
    expect(releaseNotificationKey('0.20')).toBe('release-0-20');
  });

  it('should hide releases newer than the running build', () => {
    const result = buildReleaseNotifications([], ['0.19', '0.20'], '0.19.0');
    expect(result.map((entry) => entry.minor)).toEqual(['0.19']);
  });

  it('should count only required steps and show a dot for optional-only', () => {
    const steps = [instance('a', 'required'), instance('b', 'optional')];
    expect(summarizeBell(steps, empty, NOW)).toMatchObject({ count: 1, showDot: false });
    const done: ReleaseState = { ...empty, installation: [row('a', 'installation', 'done')] };
    expect(summarizeBell(steps, done, NOW)).toMatchObject({ count: 0, showDot: true });
  });

  it('should exclude a snoozed step until the snooze expires', () => {
    const steps = [instance('a', 'required')];
    const snoozed: ReleaseState = {
      ...empty,
      user: [row('a', 'user', 'snoozed', { snoozedUntil: '2026-11-24T10:00:00Z' })],
    };
    expect(stepStatusOf(snoozed, 'a', NOW).status).toBe('snoozed');
    expect(summarizeBell(steps, snoozed, NOW).count).toBe(0);
    expect(summarizeBell(steps, snoozed, Date.parse('2026-11-25T00:00:00Z')).count).toBe(1);
  });

  it('should treat a notification without a user row as unread', () => {
    expect(notificationStatusOf(empty, 'release-0-20')).toEqual({ status: 'active', unread: true });
    const archived: ReleaseState = { ...empty, user: [row('release-0-20', 'user', 'archived')] };
    expect(notificationStatusOf(archived, 'release-0-20').status).toBe('archived');
  });
});
