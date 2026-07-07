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
        expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
      }
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
});
