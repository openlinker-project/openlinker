/**
 * nav-registry — Unit Tests
 *
 * Covers the demo-mode / role matrix of `buildNavGroups` (#1379): role-gated
 * groups (AI, Administration) are hidden for non-admins in normal mode, live
 * for admins, and rendered as `restricted` (visible-but-locked) for everyone
 * in demo mode.
 */
import { describe, expect, it } from 'vitest';
import { buildNavGroups } from './nav-registry';
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
});
