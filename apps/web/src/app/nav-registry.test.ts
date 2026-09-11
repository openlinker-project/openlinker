/**
 * nav-registry — Unit Tests
 *
 * Covers the demo-mode / role matrix of `buildNavGroups` (#1379): role-gated
 * groups (AI, Administration) are hidden for non-admins in normal mode, live
 * for admins, and rendered as `restricted` (visible-but-locked) for everyone
 * in demo mode.
 */
import { describe, expect, it } from 'vitest';
import { buildNavGroups, isNavItemVisible } from './nav-registry';
import { RoleValues } from './nav-registry.types';
import type { LiveNavGroup, NavGroup } from './nav-registry.types';
import { NAV_DEMO_RESTRICTED_MESSAGE } from '../shared/config/demo-mode';

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

  // #3107 — the FE chrome's own role union widened to include `packer`
  // (narrower than `operator`, ADR-071/#2413). No behavioural change is
  // expected from the widening alone (#3108 adds the first actual consumer,
  // the "Pack bench" item-level `requiresRole` gate) — this just pins that
  // the value exists and that an unrecognised/absent role doesn't crash the
  // builder.
  describe('packer role (#3107)', () => {
    it('is a member of RoleValues', () => {
      expect(RoleValues).toContain('packer');
    });

    it('does not crash buildNavGroups when no role is passed', () => {
      const groups = buildNavGroups({ isAdmin: false, demoMode: false });
      expect(byLabel(groups, 'Operations')?.kind).toBe('live');
    });
  });

  // #3108 — "Pack bench" is visible to every role the bench API itself
  // accepts (`@Roles('admin', 'operator', 'packer')`) and hidden from any
  // other role (today, only `viewer`).
  describe('"Pack bench" item-level role gate (#3108)', () => {
    it.each(['admin', 'operator', 'packer'])('is visible to a %s session', (role) => {
      const groups = buildNavGroups({ isAdmin: role === 'admin', demoMode: false, role });
      expect(itemLabels(byLabel(groups, 'Operations'))).toContain('Pack bench');
    });

    it('is hidden from a viewer session', () => {
      const groups = buildNavGroups({ isAdmin: false, demoMode: false, role: 'viewer' });
      expect(itemLabels(byLabel(groups, 'Operations'))).not.toContain('Pack bench');
    });

    it('is hidden when no role is known yet (session not resolved)', () => {
      const groups = buildNavGroups({ isAdmin: false, demoMode: false });
      expect(itemLabels(byLabel(groups, 'Operations'))).not.toContain('Pack bench');
    });

    it('does not drop its sibling items in the same group for a role-gated absence', () => {
      const groups = buildNavGroups({ isAdmin: false, demoMode: false, role: 'viewer' });
      const labels = itemLabels(byLabel(groups, 'Operations'));
      expect(labels).toContain('Orders');
      expect(labels).toContain('Analytics');
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
