/**
 * nav-registry — Unit Tests
 *
 * Covers the demo-mode / role matrix of `buildNavGroups` (#1379): role-gated
 * groups (AI, Administration) are hidden for non-admins in normal mode, live
 * for admins, and rendered as `restricted` (visible-but-locked) for everyone
 * in demo mode.
 */
import { describe, expect, it } from 'vitest';
import { BASE_NAV_GROUPS, buildNavGroups, isNavItemVisible, navRoleOf } from './nav-registry';
import { RoleValues } from './nav-registry.types';
import type { LiveNavGroup, NavGroup } from './nav-registry.types';
import { NAV_DEMO_RESTRICTED_MESSAGE } from '../shared/config/demo-mode';
import { ANONYMOUS_SESSION } from '../shared/auth/session.types';
import type { Session } from '../shared/auth/session.types';

const byLabel = (groups: NavGroup[], label: string): NavGroup | undefined =>
  groups.find((g) => g.label === label);

const itemLabels = (group: NavGroup | undefined): string[] =>
  group?.kind === 'live' ? (group as LiveNavGroup).items.map((i) => i.label) : [];

describe('buildNavGroups', () => {
  describe('normal mode (demoMode: false)', () => {
    it('hides AI and Administration for non-admins', () => {
      const groups = buildNavGroups({ isAdmin: false, demoMode: false });
      expect(byLabel(groups, 'AI')).toBeUndefined();
      expect(byLabel(groups, 'Administration')).toBeUndefined();
    });

    it('shows AI and Administration as live groups for admins', () => {
      const groups = buildNavGroups({ isAdmin: true, demoMode: false });
      expect(byLabel(groups, 'AI')?.kind).toBe('live');
      expect(byLabel(groups, 'Administration')?.kind).toBe('live');
    });
  });

  describe('demo mode (demoMode: true)', () => {
    it('renders AI and Administration as restricted for a non-admin', () => {
      const groups = buildNavGroups({ isAdmin: false, demoMode: true });

      const ai = byLabel(groups, 'AI');
      const admin = byLabel(groups, 'Administration');

      expect(ai?.kind).toBe('restricted');
      expect(admin?.kind).toBe('restricted');

      if (ai?.kind !== 'restricted' || admin?.kind !== 'restricted') {
        throw new Error('expected restricted groups');
      }
      expect(ai.reason).toBe(NAV_DEMO_RESTRICTED_MESSAGE);
      expect(admin.reason).toBe(NAV_DEMO_RESTRICTED_MESSAGE);
      // Item labels are preserved so the operator still sees what exists.
      expect(admin.items.map((i) => i.label)).toContain('Users');
    });

    it('keeps AI and Administration live for an admin (admins retain access in demo)', () => {
      const groups = buildNavGroups({ isAdmin: true, demoMode: true });
      expect(byLabel(groups, 'AI')?.kind).toBe('live');
      expect(byLabel(groups, 'Administration')?.kind).toBe('live');
    });

    it('keeps the always-live Operations group live in demo mode', () => {
      const groups = buildNavGroups({ isAdmin: false, demoMode: true });
      expect(byLabel(groups, 'Operations')?.kind).toBe('live');
    });
  });

  describe('per-item requiresRole gate (#3076)', () => {
    const diagnosticsItems = (isAdmin: boolean): string[] => {
      const groups = buildNavGroups({ isAdmin, demoMode: false, role: isAdmin ? 'admin' : 'operator' });
      const diagnostics = byLabel(groups, 'Diagnostics');
      if (diagnostics?.kind !== 'live') throw new Error('expected a live Diagnostics group');
      return diagnostics.items.map((i) => i.label);
    };

    it('hides "Duplicate stock positions" for a non-admin', () => {
      expect(diagnosticsItems(false)).not.toContain('Duplicate stock positions');
    });

    it('shows "Duplicate stock positions" for an admin, alongside its siblings', () => {
      const items = diagnosticsItems(true);
      expect(items).toContain('Duplicate stock positions');
      expect(items).toContain('Jobs & Logs');
      expect(items).toContain('Webhooks');
      expect(items).toContain('Cursors');
    });

    it('never drops the sibling items for a non-admin', () => {
      const items = diagnosticsItems(false);
      expect(items).toContain('Jobs & Logs');
      expect(items).toContain('Webhooks');
      expect(items).toContain('Cursors');
    });
  });

  // #3107 — the FE chrome's own role union widened to include `packer`
  // (narrower than `operator`, ADR-071/#2413). No behavioural change is
  // expected from the widening alone; #3108 adds the first actual consumer,
  // the "Pack bench" item-level `requiresRole` gate.
  describe('packer role (#3107)', () => {
    it('is a member of RoleValues', () => {
      expect(RoleValues).toContain('packer');
    });

    // Replaces a `does not crash buildNavGroups when no role is passed` test
    // that could not fail for the reason it named (#3107 review): at this point
    // in the stack `buildNavGroups` does not read a role at all, so it passed
    // identically before the widening.
    //
    // This one can. The GROUP-level gate is `requiresRole === 'admin'` and
    // nothing else, so a group declaring any other role is an inert, fail-OPEN
    // gate — visible to everyone. `GroupRoleGate` makes that a compile error
    // for new declarations; this pins the same fact about the data that ships,
    // so a value smuggled past the type (a cast, a widening of
    // `GroupRoleGate` without its gate) fails here rather than silently
    // exposing a group.
    it('declares no group role gate other than admin, which is the only one honoured', () => {
      const declared = BASE_NAV_GROUPS.filter(
        (group): group is Extract<typeof group, { requiresRole?: unknown }> =>
          'requiresRole' in group && group.requiresRole !== undefined,
      ).map((group) => group.requiresRole);

      expect(declared.length).toBeGreaterThan(0);
      expect(declared.every((role) => role === 'admin')).toBe(true);
    });
  });

  // #3439/#3204 review — "Pack bench" is visible to every role the bench
  // API itself accepts (`@Roles('admin', 'operator', 'packer')`) and hidden
  // from any other role (today, only `viewer`). Gated on `bench:write`
  // (held by exactly those three roles, guarded against the bench
  // controllers' own `@Roles` lists by `check-bench-write-roles.mjs`) rather
  // than an item-level `requiresRole` array — a `Permission` gate is
  // preferred whenever one exists, and #3439 minted this one for exactly
  // this purpose.
  describe('"Pack bench" permission gate (#3439)', () => {
    it.each(['admin', 'operator', 'packer'])('is visible to a %s session holding bench:write', (role) => {
      const groups = buildNavGroups({
        isAdmin: role === 'admin',
        demoMode: false,
        role,
        permissions: ['bench:write'],
      });
      expect(itemLabels(byLabel(groups, 'Operations'))).toContain('Pack bench');
    });

    it('is hidden from a viewer session, which holds no bench:write', () => {
      const groups = buildNavGroups({ isAdmin: false, demoMode: false, role: 'viewer', permissions: [] });
      expect(itemLabels(byLabel(groups, 'Operations'))).not.toContain('Pack bench');
    });

    it('is hidden when no permissions are known yet (session not resolved)', () => {
      const groups = buildNavGroups({ isAdmin: false, demoMode: false });
      expect(itemLabels(byLabel(groups, 'Operations'))).not.toContain('Pack bench');
    });

    it('does not drop its sibling items in the same group for a permission-gated absence', () => {
      const groups = buildNavGroups({ isAdmin: false, demoMode: false, role: 'viewer', permissions: [] });
      const labels = itemLabels(byLabel(groups, 'Operations'));
      expect(labels).toContain('Orders');
      expect(labels).toContain('Analytics');
    });
  });

  // #3221 — a packer sees Operations nav entries whose primary API read
  // 403s. Five entries (Analytics, Insights, Orders, Customers, Sales
  // documents) had their reads gated `@Roles('admin', 'operator', 'viewer')`
  // and no item-level `requiresRole` to hide the affordance; the item-level
  // gate #3108 built for "Pack bench" is applied to those five here.
  // `Fulfilment` 403s a packer too, but stays gated on its own pre-existing
  // `requiresPermission: 'orders:write'` (#3340/#3368), which already
  // excludes `packer` as a side effect — no `requiresRole` was needed there.
  describe('packer role-gated Operations entries (#3221)', () => {
    // Named explicitly rather than as a count, per the issue's own
    // acceptance criterion — a count would still pass if the WRONG five
    // items were visible.
    const PACKER_VISIBLE_OPERATIONS_ITEMS = [
      'Products',
      'Listings',
      'Shipments',
      'Returns',
      'Pack bench',
    ];
    const PACKER_HIDDEN_OPERATIONS_ITEMS = [
      'Analytics',
      'Insights',
      'Orders',
      'Customers',
      // Hidden via its pre-existing `requiresPermission: 'orders:write'`
      // gate (#3340/#3368), not a #3221 `requiresRole` addition.
      'Fulfilment',
      'Sales documents',
      // Already hidden pre-#3221 via the permission gate (#2358 review I5) —
      // included here so this test is a complete inventory of the group.
      'Automations',
    ];

    it('sees exactly the unblocked Operations entries', () => {
      // `permissions: ['bench:write']` matches a real packer session
      // (`ROLE_PERMISSIONS.packer`) — without it "Pack bench" would also be
      // hidden, for the unrelated reason that its permission gate (#3439)
      // never received one.
      const groups = buildNavGroups({
        isAdmin: false,
        demoMode: false,
        role: 'packer',
        permissions: ['bench:write'],
      });
      const labels = itemLabels(byLabel(groups, 'Operations'));

      for (const label of PACKER_VISIBLE_OPERATIONS_ITEMS) {
        expect(labels).toContain(label);
      }
      for (const label of PACKER_HIDDEN_OPERATIONS_ITEMS) {
        expect(labels).not.toContain(label);
      }
    });

    // Every one of the five newly `requiresRole`-gated items admits
    // `admin`/`operator`/`viewer` — no item is hidden from a role that could
    // already open it, the acceptance criterion's own wording. `Fulfilment`
    // is deliberately excluded here: it is gated by permission, not role, and
    // `viewer` does not hold `orders:write` — asserting it visible to viewer
    // would fail against pre-existing, unrelated-to-#3221 behaviour.
    it.each(['Analytics', 'Insights', 'Orders', 'Customers', 'Sales documents'])(
      '%s is visible to admin, operator, and viewer',
      (label) => {
        for (const role of ['admin', 'operator', 'viewer']) {
          const groups = buildNavGroups({ isAdmin: role === 'admin', demoMode: false, role });
          expect(itemLabels(byLabel(groups, 'Operations'))).toContain(label);
        }
      },
    );

    // The pre-existing items (never role-gated by #3221) are unaffected —
    // pinned separately from the "visible to packer" set above, which
    // already asserts them, so a regression there fails at the right test.
    it.each(['Products', 'Listings', 'Shipments', 'Returns'])(
      '%s is unaffected — still visible to every authenticated role',
      (label) => {
        for (const role of ['admin', 'operator', 'viewer', 'packer']) {
          const groups = buildNavGroups({ isAdmin: role === 'admin', demoMode: false, role });
          expect(itemLabels(byLabel(groups, 'Operations'))).toContain(label);
        }
      },
    );
  });

  // #3108 review — the visibility RULE was shared but its INPUT was spelled
  // twice, and not identically: the shell had an extra `isReady &&` the palette
  // did not. `navRoleOf` is the one derivation both now call.
  describe('navRoleOf', () => {
    const authenticated = (role: string): Session => ({
      status: 'authenticated',
      accessToken: 'token',
      user: { id: 'u1', username: 'u', email: null, role, permissions: [] },
    });

    it('returns the role of an authenticated session', () => {
      expect(navRoleOf(authenticated('packer'))).toBe('packer');
    });

    // The unresolved-session case, which is why no `isReady` parameter is
    // needed: the provider starts at ANONYMOUS_SESSION, so "not resolved yet"
    // already reaches `isNavItemVisible` as `undefined` and fails CLOSED.
    it('returns undefined for the anonymous session the provider starts at', () => {
      expect(navRoleOf(ANONYMOUS_SESSION)).toBeUndefined();
      expect(isNavItemVisible({ to: '/bench', label: 'Pack bench', requiresRole: ['packer'] }, {
        role: navRoleOf(ANONYMOUS_SESSION),
      })).toBe(false);
    });

    it('returns undefined when an authenticated session carries no user', () => {
      expect(navRoleOf({ status: 'authenticated', accessToken: 't', user: null })).toBeUndefined();
    });
  });

  describe('isNavItemVisible', () => {
    const item = { to: '/bench', label: 'Pack bench', requiresRole: ['admin', 'operator', 'packer'] } as const;

    it('is visible when the role matches', () => {
      expect(isNavItemVisible(item, { role: 'packer' })).toBe(true);
    });

    it('is hidden when the role does not match', () => {
      expect(isNavItemVisible(item, { role: 'viewer' })).toBe(false);
    });

    it('is hidden when no role is supplied at all', () => {
      expect(isNavItemVisible(item, {})).toBe(false);
    });

    it('an item declaring neither gate is always visible', () => {
      expect(isNavItemVisible({ to: '/orders', label: 'Orders' }, {})).toBe(true);
    });

    it('an item declaring both gates must satisfy both', () => {
      const both = {
        to: '/automations',
        label: 'Automations',
        requiresPermission: 'automations:read',
        requiresRole: ['admin'],
      } as const;
      expect(isNavItemVisible(both, { permissions: ['automations:read'], role: 'operator' })).toBe(false);
      expect(isNavItemVisible(both, { permissions: [], role: 'admin' })).toBe(false);
      expect(isNavItemVisible(both, { permissions: ['automations:read'], role: 'admin' })).toBe(true);
    });
  });
});
