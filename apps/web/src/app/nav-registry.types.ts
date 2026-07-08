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
import type { NavCounts } from './hooks/use-nav-counts';

/**
 * Roles that the FE chrome gates against. Runtime array + derived union
 * follows the `as const` pattern from engineering standards § "Union Types".
 *
 * `'operator'` is included so nav groups can declare `requiresRole: 'operator'`
 * for operator-only sections without any further type changes.
 */
export const RoleValues = ['admin', 'operator'] as const;
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
