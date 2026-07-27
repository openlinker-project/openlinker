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
import { NAV_DEMO_RESTRICTED_MESSAGE } from '../shared/config/demo-mode';
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
      { to: '/customers', label: 'Customers', countKey: 'customers' },
      { to: '/listings', label: 'Listings', countKey: 'listings' },
      { to: '/shipments', label: 'Shipments' },
      { to: '/invoices', label: 'Invoices' },
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
    kind: 'live',
    label: 'Administration',
    requiresRole: 'admin',
    items: [{ to: '/users', label: 'Users' }],
  },
  {
    kind: 'planned',
    label: 'Planned',
    items: [
      { label: 'Automations', reason: 'Coming in a future release' },
    ],
  },
];

export interface BuildNavGroupsInput {
  isAdmin: boolean;
  demoMode: boolean;
}

/**
 * Build the sidebar nav composition for the current session.
 *
 * Role-gated groups (`requiresRole: 'admin'`) are handled per context:
 * - **Admins** keep full live access in every mode, including demo — a demo
 *   admin still administers AI templates / users (#1379).
 * - **Non-admins in demo mode**: shown as a `restricted` group — visible,
 *   greyed-out, and locked with a tooltip — so the demo advertises that the
 *   feature exists but is off in the read-only demo.
 * - **Non-admins in normal mode**: filtered out entirely (unchanged; no
 *   client-side permission enforcement at render).
 *
 * Plugin contributions are then folded in via `mergePluginNavContributions`,
 * which applies the same `requiresRole` gate against the session role.
 */
export function buildNavGroups({ isAdmin, demoMode }: BuildNavGroupsInput): NavGroup[] {
  // `mergePluginNavContributions` deep-clones each live group before mutating,
  // so pushing the readonly BASE group objects by reference is safe.
  const baseGroups: NavGroup[] = [];
  for (const group of BASE_NAV_GROUPS) {
    if (group.kind === 'live' && group.requiresRole === 'admin' && !isAdmin) {
      // Non-admin: locked-but-visible in demo, hidden otherwise.
      if (demoMode) {
        baseGroups.push({
          kind: 'restricted',
          label: group.label,
          items: group.items.map((item) => ({ label: item.label })),
          reason: NAV_DEMO_RESTRICTED_MESSAGE,
        });
      }
      continue;
    }
    baseGroups.push(group);
  }

  const contributions = plugins.flatMap((plugin) => plugin.build?.navItems ?? []);
  return mergePluginNavContributions(baseGroups, contributions, { isAdmin });
}
