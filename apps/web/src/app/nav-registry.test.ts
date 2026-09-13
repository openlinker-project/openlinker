/**
 * nav-registry — Unit Tests
 *
 * Covers the demo-mode / role matrix of `buildNavGroups` (#1379): role-gated
 * groups (AI, Administration) are hidden for non-admins in normal mode, live
 * for admins, and rendered as `restricted` (visible-but-locked) for everyone
 * in demo mode.
 */
import { describe, expect, it } from 'vitest';
import { BASE_NAV_GROUPS, buildNavGroups } from './nav-registry';
import { RoleValues } from './nav-registry.types';
import type { NavGroup } from './nav-registry.types';
import { NAV_DEMO_RESTRICTED_MESSAGE } from '../shared/config/demo-mode';

const byLabel = (groups: NavGroup[], label: string): NavGroup | undefined =>
  groups.find((g) => g.label === label);

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
});
