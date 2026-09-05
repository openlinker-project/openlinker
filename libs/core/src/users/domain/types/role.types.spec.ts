/**
 * Role and Permission Types — Unit Tests
 *
 * Validates the operator permission set introduced in #1126 and the invariants
 * that hold across the three-rung role ladder (admin / operator / viewer).
 *
 * @module libs/core/src/users/domain/types
 */
import { ROLE_PERMISSIONS, PermissionValues, UserRoleValues } from './role.types';

describe('ROLE_PERMISSIONS', () => {
  describe('operator', () => {
    it('should contain orders:write', () => {
      expect(ROLE_PERMISSIONS.operator).toContain('orders:write');
    });

    it('should contain inventory:write', () => {
      expect(ROLE_PERMISSIONS.operator).toContain('inventory:write');
    });

    it('should contain listings:write', () => {
      expect(ROLE_PERMISSIONS.operator).toContain('listings:write');
    });

    it('should NOT contain connections:write', () => {
      expect(ROLE_PERMISSIONS.operator).not.toContain('connections:write');
    });

    it('should NOT contain sync:write', () => {
      expect(ROLE_PERMISSIONS.operator).not.toContain('sync:write');
    });

    it('should NOT contain integrations:write', () => {
      expect(ROLE_PERMISSIONS.operator).not.toContain('integrations:write');
    });

    it('should NOT contain products:write', () => {
      expect(ROLE_PERMISSIONS.operator).not.toContain('products:write');
    });

    it('should NOT contain users:read', () => {
      expect(ROLE_PERMISSIONS.operator).not.toContain('users:read');
    });

    it('should NOT contain users:write', () => {
      expect(ROLE_PERMISSIONS.operator).not.toContain('users:write');
    });

    it('should be a subset of admin permissions', () => {
      const adminSet = new Set(ROLE_PERMISSIONS.admin);
      for (const p of ROLE_PERMISSIONS.operator) {
        expect(adminSet.has(p)).toBe(true);
      }
    });

    it('should be a strict superset of viewer permissions', () => {
      const operatorSet = new Set(ROLE_PERMISSIONS.operator);
      for (const p of ROLE_PERMISSIONS.viewer) {
        expect(operatorSet.has(p)).toBe(true);
      }
      expect(ROLE_PERMISSIONS.operator.length).toBeGreaterThan(ROLE_PERMISSIONS.viewer.length);
    });
  });

  describe('UserRoleValues', () => {
    it('should include admin, operator, and viewer', () => {
      expect(UserRoleValues).toContain('admin');
      expect(UserRoleValues).toContain('operator');
      expect(UserRoleValues).toContain('viewer');
    });

    it('should have an entry in ROLE_PERMISSIONS for every role', () => {
      for (const role of UserRoleValues) {
        expect(ROLE_PERMISSIONS[role]).toBeDefined();
      }
    });

    /**
     * The non-emptiness assertion used to run over EVERY role. `packer` (#2413,
     * ADR-071) is deliberately empty — `PermissionValues` has no member
     * describing packing, and granting one merely to populate the Record would
     * light up an FE surface for a role whose whole purpose is to be narrower
     * (see the docblock on `ROLE_PERMISSIONS.packer`).
     *
     * So the loop is NARROWED and the exception is asserted POSITIVELY rather
     * than the assertion being deleted: an empty set for any other role stays a
     * failure, and `packer` becoming non-empty by accident is one too. A
     * `pack:*` permission arriving with #2416/#2418 is a deliberate edit here.
     */
    it('gives every role except `packer` at least one permission', () => {
      for (const role of UserRoleValues) {
        if (role === 'packer') continue;
        expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
      }
    });

    it('gives `packer` no permissions, deliberately', () => {
      expect(ROLE_PERMISSIONS.packer).toEqual([]);
    });
  });

  describe('admin', () => {
    it('should have all permissions', () => {
      expect([...ROLE_PERMISSIONS.admin].sort()).toEqual([...PermissionValues].sort());
    });
  });

  describe('viewer (#1357)', () => {
    it('should contain customers:read, shipments:read, invoices:read, webhooks:read', () => {
      expect(ROLE_PERMISSIONS.viewer).toContain('customers:read');
      expect(ROLE_PERMISSIONS.viewer).toContain('shipments:read');
      expect(ROLE_PERMISSIONS.viewer).toContain('invoices:read');
      expect(ROLE_PERMISSIONS.viewer).toContain('webhooks:read');
    });
  });

  describe('ai:suggest (#1379 re-scope)', () => {
    it('should be admin-only — operator and viewer must not hold it', () => {
      expect(ROLE_PERMISSIONS.admin).toContain('ai:suggest');
      expect(ROLE_PERMISSIONS.operator).not.toContain('ai:suggest');
      expect(ROLE_PERMISSIONS.viewer).not.toContain('ai:suggest');
    });
  });

  describe('content:write (#1873)', () => {
    it('should be held by admin and operator, but not viewer', () => {
      expect(ROLE_PERMISSIONS.admin).toContain('content:write');
      expect(ROLE_PERMISSIONS.operator).toContain('content:write');
      expect(ROLE_PERMISSIONS.viewer).not.toContain('content:write');
    });
  });

  describe('shipments:write (#1826)', () => {
    it('should be held by admin and operator, but not viewer', () => {
      expect(ROLE_PERMISSIONS.admin).toContain('shipments:write');
      expect(ROLE_PERMISSIONS.operator).toContain('shipments:write');
      expect(ROLE_PERMISSIONS.viewer).not.toContain('shipments:write');
    });
  });
});
