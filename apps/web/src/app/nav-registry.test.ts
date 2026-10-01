/**
 * nav-registry — Unit Tests
 *
 * Covers the demo-mode / role matrix of `buildNavGroups` (#1379): role-gated
 * groups (AI, Administration) are hidden for non-admins in normal mode, live
 * for admins, and rendered as `restricted` (visible-but-locked) for everyone
 * in demo mode.
 */
import { describe, expect, it } from 'vitest';
import { buildNavGroups, isOmsNavItemVisible, sessionNeedsOmsRouting } from './nav-registry';
import type { NavGroup } from './nav-registry.types';
import type { OmsRoutingState } from '../features/fulfillment-authority';
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

  describe('per-item requiresRole gate (#3076)', () => {
    const diagnosticsItems = (isAdmin: boolean): string[] => {
      const groups = buildNavGroups({ isAdmin, demoMode: false });
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

  describe('per-item requiresOms gate (#3505)', () => {
    const operationsItems = (omsRouting?: OmsRoutingState): string[] => {
      const groups = buildNavGroups({
        isAdmin: false,
        demoMode: false,
        permissions: ['orders:read', 'orders:write'],
        omsRouting,
      });
      const operations = byLabel(groups, 'Operations');
      if (operations?.kind !== 'live') throw new Error('expected a live Operations group');
      return operations.items.map((i) => i.label);
    };

    it('should show Fulfilment and Pack bench when routing is on', () => {
      const items = operationsItems('on');
      expect(items).toContain('Fulfilment');
      expect(items).toContain('Pack bench');
    });

    it('should hide Fulfilment and Pack bench when routing is off', () => {
      const items = operationsItems('off');
      expect(items).not.toContain('Fulfilment');
      expect(items).not.toContain('Pack bench');
      expect(items).toContain('Orders');
    });

    it('should hide them while the routing state is unknown, including by default', () => {
      expect(operationsItems('unknown')).not.toContain('Fulfilment');
      expect(operationsItems()).not.toContain('Pack bench');
    });

    it('should show them when the routing state could not be read', () => {
      const items = operationsItems('unreadable');
      expect(items).toContain('Fulfilment');
      expect(items).toContain('Pack bench');
    });

    it('should still apply the permission gate when routing is on', () => {
      const groups = buildNavGroups({
        isAdmin: false,
        demoMode: false,
        permissions: ['orders:read'],
        omsRouting: 'on',
      });
      const operations = byLabel(groups, 'Operations');
      if (operations?.kind !== 'live') throw new Error('expected a live Operations group');
      expect(operations.items.map((i) => i.label)).not.toContain('Fulfilment');
    });
  });

  describe('isOmsNavItemVisible', () => {
    it.each<[OmsRoutingState, boolean]>([
      ['on', true],
      ['unreadable', true],
      ['off', false],
      ['unknown', false],
    ])('should resolve a requiresOms item to %s → %s', (state, visible) => {
      expect(isOmsNavItemVisible({ to: '/x', label: 'X', requiresOms: true }, state)).toBe(visible);
    });

    it('should never hide an item that does not require OMS', () => {
      expect(isOmsNavItemVisible({ to: '/x', label: 'X' }, 'off')).toBe(true);
    });
  });

  describe('sessionNeedsOmsRouting', () => {
    it('should need the routing state for a session that holds orders:write', () => {
      expect(sessionNeedsOmsRouting(['orders:read', 'orders:write'])).toBe(true);
    });

    it('should not need it for a session that cannot see any routing-gated entry', () => {
      expect(sessionNeedsOmsRouting(['orders:read'])).toBe(false);
      expect(sessionNeedsOmsRouting(['bench:write'])).toBe(false);
      expect(sessionNeedsOmsRouting()).toBe(false);
    });
  });
});
