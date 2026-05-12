/**
 * Breadcrumb resolver tests
 *
 * Pin the deepest-match-wins semantics of `resolveCrumbFromMatches`. Feeds
 * synthetic `useMatches()` results and asserts the resolved crumb; covers
 * deepest-wins, missing handle → fallback, and non-crumb-shaped handles
 * (e.g. arbitrary strings) being ignored by the guard.
 *
 * @module app
 */
import type { UIMatch } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CRUMB, resolveCrumbFromMatches } from './breadcrumbs';

type Match = UIMatch<unknown, unknown>;

function match(id: string, handle: unknown): Match {
  return {
    id,
    pathname: '/' + id,
    params: {},
    data: undefined,
    handle,
    loaderData: undefined,
  };
}

describe('resolveCrumbFromMatches', () => {
  it('returns the default crumb when no match carries a handle', () => {
    expect(resolveCrumbFromMatches([])).toEqual(DEFAULT_CRUMB);
  });

  it('returns the deepest match that carries a crumb-shaped handle', () => {
    const matches: Match[] = [
      match('root', undefined),
      match('orders', { crumb: { group: 'Operations', title: 'Orders' } }),
      match('order-detail', { crumb: { group: 'Operations', title: 'Order' } }),
    ];

    expect(resolveCrumbFromMatches(matches)).toEqual({
      group: 'Operations',
      title: 'Order',
    });
  });

  it('walks past matches without a handle to find a deeper one', () => {
    const matches: Match[] = [
      match('root', undefined),
      match('parent', { crumb: { group: 'Platform', title: 'Connections' } }),
      match('child', undefined),
    ];

    // Deepest with a handle wins.
    expect(resolveCrumbFromMatches(matches)).toEqual({
      group: 'Platform',
      title: 'Connections',
    });
  });

  it('falls back to the default when only non-crumb-shaped handles are present', () => {
    const matches: Match[] = [
      match('root', 'just-a-string'),
      match('child', { somethingElse: true }),
    ];

    expect(resolveCrumbFromMatches(matches)).toEqual(DEFAULT_CRUMB);
  });

  it('skips a non-crumb handle deeper in the chain and uses a valid one above', () => {
    const matches: Match[] = [
      match('root', { crumb: { group: 'Operations', title: 'Dashboard' } }),
      match('child', 'bogus-handle'),
    ];

    expect(resolveCrumbFromMatches(matches)).toEqual({
      group: 'Operations',
      title: 'Dashboard',
    });
  });

  it('returns a fresh object so callers cannot mutate the DEFAULT_CRUMB constant', () => {
    const first = resolveCrumbFromMatches([]);
    const second = resolveCrumbFromMatches([]);

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
