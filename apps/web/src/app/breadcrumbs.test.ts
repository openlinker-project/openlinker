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

import { getMessages } from '../shared/i18n';
import { resolveCrumbFromMatches } from './breadcrumbs';

const DEFAULT_CRUMB = { group: 'OpenLinker', title: '' };

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
      match('orders', { crumb: { group: 'operations', page: 'orders' } }),
      match('order-detail', { crumb: { group: 'operations', page: 'order' } }),
    ];

    expect(resolveCrumbFromMatches(matches)).toEqual({
      group: 'Operations',
      title: 'Order',
    });
  });

  it('walks past matches without a handle to find a deeper one', () => {
    const matches: Match[] = [
      match('root', undefined),
      match('parent', { crumb: { group: 'platform', page: 'connections' } }),
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
      match('root', { crumb: { group: 'operations', title: 'Dashboard' } }),
      match('child', 'bogus-handle'),
    ];

    expect(resolveCrumbFromMatches(matches)).toEqual({
      group: 'Operations',
      title: 'Dashboard',
    });
  });

  it('should keep a plugin crumb title as written when the crumb names no core page', () => {
    const matches: Match[] = [match('setup', { crumb: { group: 'platform', title: 'Connect Allegro' } })];

    expect(resolveCrumbFromMatches(matches)).toEqual({ group: 'Platform', title: 'Connect Allegro' });
  });

  it('should show the group and page as written when they are not keys of the app namespace', () => {
    const matches: Match[] = [
      match('legacy', { crumb: { group: 'Platform', page: 'Connect Shopify' } }),
    ];

    expect(resolveCrumbFromMatches(matches)).toEqual({ group: 'Platform', title: 'Connect Shopify' });
  });

  it('should not resolve an inherited object property as a crumb label', () => {
    const matches: Match[] = [match('proto', { crumb: { group: 'toString', title: 'X' } })];

    expect(resolveCrumbFromMatches(matches)).toEqual({ group: 'toString', title: 'X' });
  });

  it('should read the section and page from the copy it is given', () => {
    const app = getMessages('app');
    const copy = {
      ...app,
      sections: { ...app.sections, operations: 'Operacje' },
      pages: { ...app.pages, orders: 'Zamówienia' },
    };
    const matches: Match[] = [match('orders', { crumb: { group: 'operations', page: 'orders' } })];

    expect(resolveCrumbFromMatches(matches, copy)).toEqual({ group: 'Operacje', title: 'Zamówienia' });
  });

  it('returns a fresh object on every call', () => {
    const first = resolveCrumbFromMatches([]);
    const second = resolveCrumbFromMatches([]);

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
