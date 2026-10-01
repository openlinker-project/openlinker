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
import type { Permission } from '../shared/auth/session.types';
import type { OmsRoutingState } from '../features/fulfillment-authority';
import type { LiveNavItem, NavGroup, NavRegistryGroup } from './nav-registry.types';

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
      { to: '/', label: 'Analytics', end: true },
      { to: '/insights', label: 'Insights' },
      { to: '/orders', label: 'Orders', countKey: 'orders' },
      { to: '/products', label: 'Products' },
      { to: '/customers', label: 'Customers', countKey: 'customers' },
      { to: '/listings', label: 'Listings', countKey: 'listings' },
      { to: '/shipments', label: 'Shipments' },
      // ONE entry, since the staffing board and the worklist merged into one
      // screen. No `countKey`: the #2406 read exposes no counts endpoint the
      // nav could read, and a badge is worse absent than wrong (the `/returns`
      // precedent below). Permission-gated (#3340, wording corrected at #3368):
      // neither `GET /users/packers` nor the assignment `PATCH` actually
      // requires `orders:write` — both are `@Roles('admin', 'operator')`.
      // `orders:write` is a deliberate PROXY for that role set, correct only
      // because `ROLE_PERMISSIONS` grants it to exactly admin + operator
      // today. There is no `fulfillment:*` permission a reader could go
      // looking for instead. A `viewer` shown this entry would 403 on the
      // first request the screen makes.
      //
      // `requiresOms` (#3505): with routing switched off no fulfilment task is
      // ever created, so the screen is empty by construction.
      {
        to: '/fulfillment',
        label: 'Fulfilment',
        requiresPermission: 'orders:write',
        requiresOms: true,
      },
      // The bench itself (#2413) had no way in but a typed URL. A packer still
      // reaches it that way — they get no sidebar at all, since `/bench` renders
      // outside `AuthenticatedAppLayout` on purpose — but an admin or operator
      // checking the floor had to know the path by heart.
      //
      // Gated on `orders:write`, held by exactly admin + operator, for the same
      // reason as the entry above: the bench's own routes are
      // `@Roles('admin', 'operator', 'packer')`, and `ROLE_PERMISSIONS.packer`
      // is `[]`, so no permission can name all three. A `viewer` shown this
      // entry would 403 on the first request the page makes. `requiresOms`
      // (#3505): the bench packs fulfilment tasks, which only routing creates.
      {
        to: '/bench',
        label: 'Pack bench',
        requiresPermission: 'orders:write',
        requiresOms: true,
      },
      // No `countKey`: the #2334 returns contract exposes no counts endpoint
      // the nav could read, and a badge is worse absent than wrong.
      { to: '/returns', label: 'Returns' },
      // No `countKey`: `GET /automations/summary` reports rule counts per
      // trigger, not an attention count — a badge showing how many rules exist
      // would read as how many need looking at.
      // Permission-gated (#2358 review I5): `AutomationsController` is
      // `@Roles('admin', 'operator')` on every route, so a `viewer` shown this
      // entry gets a 403 on the first request the page makes. `automations:read`
      // is held by exactly admin + operator in `ROLE_PERMISSIONS`.
      { to: '/automations', label: 'Automations', requiresPermission: 'automations:read' },
      { to: '/sales-documents', label: 'Sales documents' },
    ],
  },
  {
    kind: 'live',
    label: 'Diagnostics',
    items: [
      { to: '/jobs-logs', label: 'Jobs & Logs', countKey: 'jobsFailed' },
      { to: '/webhook-deliveries', label: 'Webhooks', countKey: 'webhooksFailed' },
      { to: '/cursors', label: 'Cursors' },
      {
        to: '/duplicate-positions',
        label: 'Duplicate stock positions',
        requiresRole: 'admin',
      },
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
  // The `Planned` group is gone: `Automations` was its only item and #2364
  // made it real. `PlannedNavGroup` and the shell's `kind: 'planned'` branch
  // stay — a plugin may still contribute one, and
  // `merge-nav-contributions.test.ts` exercises that path against its own
  // fixture — so neither is dead code.
];

export interface BuildNavGroupsInput {
  isAdmin: boolean;
  demoMode: boolean;
  /**
   * The session's permissions, from `GET /me`. Items declaring
   * `requiresPermission` are dropped when it is absent. Defaults to empty so an
   * anonymous / not-yet-resolved session sees no permission-gated item rather
   * than every one of them.
   */
  permissions?: readonly Permission[];
  /**
   * Whether fulfilment routing is on (#3505), for `requiresOms` items.
   * Defaults to `unknown`, which hides them — same "not resolved yet sees no
   * gated item" posture as `permissions`.
   */
  omsRouting?: OmsRoutingState;
}

/**
 * The `requiresOms` gate (#3505), shared by the sidebar and the command
 * palette so the two cannot disagree.
 *
 * `unreadable` SHOWS the item on purpose: the status read failing says nothing
 * about whether routing is on, and hiding the entry would cost an operator the
 * screen for as long as one endpoint is down. `unknown` (not answered yet)
 * hides it, so a routing-off install never flashes the entry while loading.
 */
export function isOmsNavItemVisible(item: LiveNavItem, omsRouting: OmsRoutingState): boolean {
  if (item.requiresOms !== true) return true;
  return omsRouting === 'on' || omsRouting === 'unreadable';
}

/**
 * Whether this session holds a permission that unlocks any `requiresOms`
 * item — i.e. whether the routing-state read is worth issuing at all. A
 * session that could not see those entries anyway (a packer, a viewer) skips
 * the request rather than making one the API may refuse.
 */
export function sessionNeedsOmsRouting(permissions: readonly Permission[] = []): boolean {
  return BASE_NAV_GROUPS.some(
    (group) =>
      group.kind === 'live' &&
      group.items.some(
        (item) =>
          item.requiresOms === true &&
          (item.requiresPermission === undefined || permissions.includes(item.requiresPermission)),
      ),
  );
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
export function buildNavGroups({
  isAdmin,
  demoMode,
  permissions = [],
  omsRouting = 'unknown',
}: BuildNavGroupsInput): NavGroup[] {
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
    if (group.kind === 'live') {
      // Per-ITEM permission + role gates. A live group whose every item is
      // gated away is dropped entirely — an empty group heading advertises a
      // section the session cannot reach.
      const items = group.items.filter(
        (item) =>
          (item.requiresPermission === undefined || permissions.includes(item.requiresPermission)) &&
          (item.requiresRole === undefined || (item.requiresRole === 'admin' && isAdmin)) &&
          isOmsNavItemVisible(item, omsRouting),
      );
      if (items.length === 0) continue;
      baseGroups.push(items.length === group.items.length ? group : { ...group, items });
      continue;
    }

    baseGroups.push(group);
  }

  const contributions = plugins.flatMap((plugin) => plugin.build?.navItems ?? []);
  return mergePluginNavContributions(baseGroups, contributions, { isAdmin });
}
