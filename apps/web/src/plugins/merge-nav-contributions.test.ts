/**
 * mergePluginNavContributions tests
 *
 * Pins the merge semantics: append to matching live group; create a new
 * group at the end when no match; preserve `planned` groups untouched.
 *
 * @module plugins
 */
import { describe, expect, it } from 'vitest';

import type { NavGroup } from '../app/nav-registry.types';
import { mergePluginNavContributions } from './merge-nav-contributions';
import type { NavContribution } from '../shared/plugins';

function baseGroups(): NavGroup[] {
  return [
    {
      kind: 'live',
      label: 'Operations',
      items: [{ to: '/', label: 'Dashboard', end: true }],
    },
    {
      kind: 'live',
      label: 'Platform',
      items: [{ to: '/connections', label: 'Connections' }],
    },
    {
      kind: 'planned',
      label: 'Planned',
      items: [{ label: 'Automations', reason: 'Coming soon' }],
    },
  ];
}

describe('mergePluginNavContributions', () => {
  it('returns the same array reference when there are no contributions', () => {
    const groups = baseGroups();
    expect(mergePluginNavContributions(groups, [])).toBe(groups);
  });

  it('appends a contribution to a matching live group', () => {
    const contribution: NavContribution = {
      groupLabel: 'Platform',
      to: '/connections/new/shopify',
      label: 'Connect Shopify',
    };

    const result = mergePluginNavContributions(baseGroups(), [contribution]);

    const platform = result.find((g) => g.label === 'Platform');
    expect(platform?.kind).toBe('live');
    expect(platform?.kind === 'live' && platform.items).toEqual([
      { to: '/connections', label: 'Connections' },
      { to: '/connections/new/shopify', label: 'Connect Shopify', end: undefined },
    ]);
  });

  it('creates a new live group at the end when groupLabel is unknown', () => {
    const contribution: NavContribution = {
      groupLabel: 'Reporting',
      to: '/reports/sales',
      label: 'Sales',
    };

    const result = mergePluginNavContributions(baseGroups(), [contribution]);

    expect(result).toHaveLength(4);
    const last = result.at(-1);
    expect(last).toMatchObject({
      kind: 'live',
      label: 'Reporting',
      items: [{ to: '/reports/sales', label: 'Sales', end: undefined }],
    });
  });

  it('does not mutate the input groups array or its items', () => {
    const groups = baseGroups();
    const snapshot = JSON.parse(JSON.stringify(groups)) as NavGroup[];

    mergePluginNavContributions(groups, [
      { groupLabel: 'Operations', to: '/x', label: 'X' },
    ]);

    expect(groups).toEqual(snapshot);
  });

  it('appends multiple contributions in registry order within the same group', () => {
    const contributions: NavContribution[] = [
      { groupLabel: 'Platform', to: '/a', label: 'A' },
      { groupLabel: 'Platform', to: '/b', label: 'B' },
    ];

    const result = mergePluginNavContributions(baseGroups(), contributions);
    const platform = result.find((g) => g.label === 'Platform');
    expect(platform?.kind === 'live' && platform.items.map((i) => i.label)).toEqual([
      'Connections',
      'A',
      'B',
    ]);
  });

  it('drops admin-only contributions for non-admin sessions', () => {
    const contributions: NavContribution[] = [
      { groupLabel: 'Platform', to: '/secret', label: 'Secret', requiresRole: 'admin' },
    ];

    const result = mergePluginNavContributions(baseGroups(), contributions, { isAdmin: false });

    const platform = result.find((g) => g.label === 'Platform');
    expect(platform?.kind === 'live' && platform.items.map((i) => i.label)).toEqual(['Connections']);
  });

  it('keeps admin-only contributions for admin sessions', () => {
    const contributions: NavContribution[] = [
      { groupLabel: 'Platform', to: '/secret', label: 'Secret', requiresRole: 'admin' },
    ];

    const result = mergePluginNavContributions(baseGroups(), contributions, { isAdmin: true });

    const platform = result.find((g) => g.label === 'Platform');
    expect(platform?.kind === 'live' && platform.items.map((i) => i.label)).toEqual([
      'Connections',
      'Secret',
    ]);
  });

  it('defaults to non-admin when isAdmin is omitted', () => {
    const contributions: NavContribution[] = [
      { groupLabel: 'Platform', to: '/secret', label: 'Secret', requiresRole: 'admin' },
    ];

    // No third arg — admin contributions must be hidden by default.
    const result = mergePluginNavContributions(baseGroups(), contributions);

    const platform = result.find((g) => g.label === 'Platform');
    expect(platform?.kind === 'live' && platform.items.map((i) => i.label)).toEqual(['Connections']);
  });
});
