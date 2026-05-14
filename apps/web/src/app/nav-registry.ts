/**
 * Nav registry
 *
 * Static data + builder helper for the FE chrome's sidebar nav. Previously
 * lived inside `app-shell.tsx` as an inline `buildNavGroups()` function;
 * extracted in #610 so plugins can contribute admin-only items via
 * `NavContribution.requiresRole` and so future extension points (a third
 * role, a different group ordering) can grow without touching the shell.
 *
 * Plugin nav contributions are still merged via
 * `mergePluginNavContributions` from `plugins/merge-nav-contributions.ts`;
 * the only change is that this module now owns the base groups and the
 * role-gate filter that runs before merging.
 *
 * @module app
 * @see nav-registry.types.ts — the type and guard exports
 * @see plugins/merge-nav-contributions.ts — plugin contribution merge logic
 */
import { mergePluginNavContributions } from '../plugins/merge-nav-contributions';
import { plugins } from '../plugins';
import type { NavGroup, NavRegistryGroup } from './nav-registry.types';

/**
 * Canonical sidebar composition. The shell consumes whatever this builder
 * resolves at render time after filtering by session role and folding plugin
 * contributions in.
 */
export const BASE_NAV_GROUPS: readonly NavRegistryGroup[] = [
  {
    kind: 'live',
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/orders', label: 'Orders', countKey: 'orders' },
      { to: '/products', label: 'Products' },
      { to: '/inventory', label: 'Inventory', countKey: 'inventory' },
      { to: '/customers', label: 'Customers', countKey: 'customers' },
      { to: '/listings', label: 'Listings', countKey: 'listings' },
    ],
  },
  {
    kind: 'live',
    label: 'Diagnostics',
    items: [
      { to: '/jobs-logs', label: 'Jobs & Logs', countKey: 'jobsFailed' },
      { to: '/webhook-deliveries', label: 'Webhooks', countKey: 'webhooksFailed' },
      { to: '/cursors', label: 'Cursors' },
    ],
  },
  {
    kind: 'live',
    label: 'Platform',
    items: [
      { to: '/connections', label: 'Connections', countKey: 'connections' },
      { to: '/adapters', label: 'Adapters' },
      { to: '/settings', label: 'Settings' },
    ],
  },
  {
    kind: 'live',
    label: 'AI',
    requiresRole: 'admin',
    items: [
      { to: '/ai/prompt-templates', label: 'Prompt templates' },
      { to: '/ai/provider-settings', label: 'Provider settings' },
    ],
  },
  {
    kind: 'planned',
    label: 'Planned',
    items: [
      { label: 'Automations', reason: 'Coming in a future release' },
      { label: 'Shipping', reason: 'Coming in a future release' },
      { label: 'Invoices', reason: 'Coming in a future release' },
    ],
  },
];

export interface BuildNavGroupsInput {
  isAdmin: boolean;
}

/**
 * Build the sidebar nav composition for the current session.
 *
 * Filters the static `BASE_NAV_GROUPS` against the session role, then folds
 * in plugin contributions via the existing `mergePluginNavContributions`
 * helper. Admin-only items contributed by plugins are also filtered out for
 * non-admin sessions — no client-side permission filtering at render.
 */
export function buildNavGroups({ isAdmin }: BuildNavGroupsInput): NavGroup[] {
  // `mergePluginNavContributions` already deep-clones each group before
  // mutating it, so we can pass the readonly array directly without an
  // intermediate spread.
  const baseGroups: NavGroup[] = BASE_NAV_GROUPS.filter((group) => {
    if (group.kind === 'live' && group.requiresRole === 'admin' && !isAdmin) {
      return false;
    }
    return true;
  });

  const contributions = plugins.flatMap((plugin) => plugin.build?.navItems ?? []);
  return mergePluginNavContributions(baseGroups, contributions, { isAdmin });
}
