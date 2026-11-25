import { describe, expect, it } from 'vitest';
import type { ReleaseShowcaseEntry } from '../catalog/release-step.types';
import type { ReleaseState } from '../api/release-state.types';
import {
  buildReleaseNotifications,
  buildShowcaseInstances,
  showcaseItemKey,
  showcaseSeenOf,
  showcaseTally,
  summarizeBell,
} from './release-notifications';

const showcase = (id: string, introducedIn: string, stops: number): ReleaseShowcaseEntry => ({
  id,
  introducedIn,
  appliesWhen: () => true,
  stops: Array.from({ length: stops }, () => ({ routePattern: 'orders', target: 't' })),
});

const emptyState: ReleaseState = { enabled: true, cursor: null, user: [], installation: [] };
const seenState = (key: string): ReleaseState => ({
  ...emptyState,
  user: [
    { itemKey: key, scope: 'user', status: 'archived', doneVia: null, snoozedUntil: null, updatedAt: '', actedByUserId: null },
  ],
});

describe('showcase items', () => {
  it('should hide a showcase newer than the running build', () => {
    const list = buildShowcaseInstances([showcase('a', '0.20.0', 2), showcase('b', '0.21.0', 1)], '0.20.1');
    expect(list.map((i) => i.itemKey)).toEqual([showcaseItemKey('a')]);
  });

  it('should read a showcase as seen only from the archived user row', () => {
    expect(showcaseSeenOf(emptyState, 'showcase-a')).toBe(false);
    expect(showcaseSeenOf(seenState('showcase-a'), 'showcase-a')).toBe(true);
  });

  it('should count stops of seen showcases in the tally', () => {
    const list = buildShowcaseInstances([showcase('a', '0.20.0', 3), showcase('b', '0.20.0', 2)], '0.20.1');
    expect(showcaseTally(list, seenState('showcase-a'))).toEqual({ viewed: 3, total: 5 });
  });

  it('should give a showcase-only release a notification without steps and no bell count', () => {
    const list = buildShowcaseInstances([showcase('a', '0.20.0', 3)], '0.20.1');
    const notifications = buildReleaseNotifications([], [], '0.20.1', list);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].stepKeys).toEqual([]);
    expect(notifications[0].showcaseKeys).toEqual(['showcase-a']);
    expect(summarizeBell([], emptyState, 0)).toMatchObject({ count: 0, showDot: false });
  });
});
