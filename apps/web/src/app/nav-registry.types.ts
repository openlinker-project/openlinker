/**
 * Nav registry types
 *
 * Type definitions for the FE chrome's nav-group registry and route-colocated
 * breadcrumb metadata. Plugins consume these types when declaring nav
 * contributions (`NavContribution.requiresRole`) and routes when declaring
 * crumb metadata (`route.handle = { crumb: { group, title } }`).
 *
 * Lives in a `*.types.ts` sibling of `nav-registry.ts` per the engineering-
 * standards rule on separating type definitions from implementations.
 *
 * @module app
 * @see nav-registry.ts — `BASE_NAV_GROUPS` data + `buildNavGroups` helper
 * @see breadcrumbs.ts — `resolveCrumbFromMatches` consumes `isCrumbHandle`
 */
import type { Permission } from '../shared/auth/session.types';
import type { NavCounts } from './hooks/use-nav-counts';

/**
 * Roles that the FE chrome gates against. Runtime array + derived union
 * follows the `as const` pattern from engineering standards § "Union Types".
 *
 * `'operator'` is included so nav groups can declare `requiresRole: 'operator'`
 * for operator-only sections without any further type changes.
 *
 * `'packer'` (#3107, ADR-071/#2413) is narrower still than `'operator'` and
 * deliberately carries an EMPTY `ROLE_PERMISSIONS` grant on the backend — a
 * packer's access is enforced purely route-by-route via `@Roles(...)`, not
 * via any `Permission`. That is exactly why the item-level
 * `LiveNavItem.requiresRole` gate exists (#3108): `requiresPermission` has
 * nothing to check a packer session against, so "packer may see this item"
 * can only be expressed as a role check.
 *
 * The backend's `UserRoleValues` also carries `'viewer'`, deliberately absent
 * here — nothing in the FE chrome's nav gating needs to name a viewer
 * specifically today (viewer-only UI behaviour is resolved elsewhere, e.g.
 * `app-shell.tsx`'s own `isViewerOnly` check against `session.user.role`
 * directly). Add it here only when a nav gate actually needs to name it.
 */
export const RoleValues = ['admin', 'operator', 'packer'] as const;
export type Role = (typeof RoleValues)[number];

export type NavCountKey = keyof NavCounts;

/**
 * One leaf nav item under a live nav group. Mirrors the existing shape that
 * `app-shell.tsx` consumed inline before #610.
 */
export interface LiveNavItem {
  countKey?: NavCountKey;
  end?: boolean;
  label: string;
  /**
   * Declarative PERMISSION gate for a single item (#2358 review I5).
   *
   * `requiresRole` on a group cannot express this case: `/automations` lives in
   * the ungated `Operations` group alongside nine items every role may open, and
   * its own API is `@Roles('admin', 'operator')` — so a `viewer` was shown a nav
   * entry that 403s on the first request it makes. A permission is also the
   * right axis rather than a role list: `ROLE_PERMISSIONS` on the backend is the
   * single place the role→capability map lives, and `automations:read` is
   * exactly the fact this gate needs (see `usePermission`, which every other
   * affordance in the app already resolves through).
   *
   * An item declaring nothing is visible to every authenticated session, which
   * is the pre-existing behaviour of all other items.
   */
  requiresPermission?: Permission;
  /**
   * Declarative ROLE gate for a single item (#3108) — item visible only to a
   * session whose role is one of these. Distinct from `requiresPermission`:
   * `packer` (#3107, ADR-071/#2413) carries a deliberately EMPTY
   * `ROLE_PERMISSIONS` grant on the backend, so no `Permission` exists to gate
   * on — the only axis a packer-only (or packer-inclusive) item can be gated
   * by is the role itself.
   *
   * An array, not a single `Role`, because "Pack bench" needs to admit every
   * role the bench API itself accepts (`@Roles('admin', 'operator', 'packer')`
   * on `BenchWorkController` et al.) — i.e. everyone except `viewer` — and a
   * single-value gate can't express "any of these".
   *
   * An item declaring nothing is visible to every authenticated session
   * (unchanged pre-existing behaviour); an item declaring both
   * `requiresPermission` and `requiresRole` must satisfy both.
   */
  requiresRole?: readonly Role[];
  to: string;
}

export interface PlannedNavItem {
  label: string;
  reason?: string;
}

export interface LiveNavGroup {
  items: LiveNavItem[];
  kind: 'live';
  label: string;
  /** Declarative role gate — admin-only groups are filtered out for non-admin sessions. */
  requiresRole?: Role;
}

export interface PlannedNavGroup {
  items: PlannedNavItem[];
  kind: 'planned';
  label: string;
}

/**
 * A group that exists but is not usable in the current runtime context —
 * today, an admin area locked while the deployment runs in demo mode (#1379).
 * Rendered greyed-out and non-clickable with a group-level tooltip `reason`
 * (distinct from `planned`, whose items carry their own "coming soon" reason).
 * Produced only at build time by `buildNavGroups`; never authored directly in
 * `BASE_NAV_GROUPS`.
 */
export interface RestrictedNavItem {
  label: string;
}

export interface RestrictedNavGroup {
  items: RestrictedNavItem[];
  kind: 'restricted';
  label: string;
  /** Tooltip explaining why the whole group is locked. */
  reason: string;
}

export type NavGroup = LiveNavGroup | PlannedNavGroup | RestrictedNavGroup;

/**
 * Registry-shaped variant of `NavGroup`. Mirrors the runtime shape but
 * carries the optional `requiresRole` gate on every variant; the gate is
 * applied during `buildNavGroups` and stripped before reaching the shell.
 */
export type NavRegistryGroup = LiveNavGroup | PlannedNavGroup;
export type NavRegistryItem = LiveNavItem | PlannedNavItem;

/**
 * Route-colocated breadcrumb metadata. Each route module sets
 * `handle: { crumb: { group, title } } satisfies RouteCrumbHandle` and the
 * shell's `resolveCrumbFromMatches` walks `useMatches()` deepest-first to
 * find the active crumb.
 */
export interface RouteCrumbHandle {
  crumb: { group: string; title: string };
}

/**
 * Type guard for `RouteObject.handle` — React Router types `handle` as
 * `unknown`, so consumers must narrow before reading `.crumb`.
 */
export function isCrumbHandle(handle: unknown): handle is RouteCrumbHandle {
  if (!handle || typeof handle !== 'object') return false;
  const crumb = (handle as { crumb?: unknown }).crumb;
  if (!crumb || typeof crumb !== 'object') return false;
  const { group, title } = crumb as { group?: unknown; title?: unknown };
  return typeof group === 'string' && typeof title === 'string';
}
