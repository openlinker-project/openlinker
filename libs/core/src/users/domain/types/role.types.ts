/**
 * Role and Permission Type Definitions
 *
 * Defines the role-based access control types for OpenLinker. Roles are
 * assigned to users and map to a set of permissions. Permissions follow
 * the `resource:action` convention (e.g., `connections:read`).
 *
 * @module libs/core/src/users/domain/types
 */

/**
 * Valid user role values.
 *
 * - `admin`: Full access to all endpoints, including administrative surfaces
 *   (connections, webhooks, AI provider settings, user management).
 * - `operator`: Day-to-day operational access — orders, listings, inventory,
 *   shipments. Cannot touch administrative surfaces.
 * - `viewer`: Read-only access to operational data.
 */
export const UserRoleValues = ['admin', 'operator', 'viewer'] as const;

/**
 * Union type derived from UserRoleValues.
 */
export type UserRole = (typeof UserRoleValues)[number];

/**
 * Valid permission values following `resource:action` convention.
 */
export const PermissionValues = [
  'connections:read',
  'connections:write',
  'sync:read',
  'sync:write',
  'integrations:read',
  'integrations:write',
  'adapters:read',
  'orders:read',
  'orders:write',
  'products:read',
  'products:write',
  'inventory:read',
  'inventory:write',
  'listings:read',
  'listings:write',
  'users:read',
  'users:write',
  'customers:read',
  'shipments:read',
  'invoices:read',
  'webhooks:read',
  'ai:suggest',
] as const;

/**
 * Union type derived from PermissionValues.
 */
export type Permission = (typeof PermissionValues)[number];

/**
 * Maps each role to its granted permissions.
 * Permissions are derived at response time, not stored in the database.
 *
 * This map drives the `permissions[]` array on GET /me (frontend reads it via
 * usePermission to control UI visibility). Backend endpoint authorization is
 * enforced separately via @Roles('admin') guards — adding a permission here
 * does NOT open a backend endpoint; the controller guard must also be updated.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: PermissionValues,
  operator: [
    'connections:read',
    'sync:read',
    'integrations:read',
    'adapters:read',
    'orders:read',
    'orders:write',
    'products:read',
    'inventory:read',
    'inventory:write',
    'listings:read',
    'listings:write',
    'customers:read',
    'shipments:read',
    'invoices:read',
    'webhooks:read',
  ],
  viewer: [
    'connections:read',
    'sync:read',
    'integrations:read',
    'adapters:read',
    'orders:read',
    'products:read',
    'inventory:read',
    'listings:read',
    'customers:read',
    'shipments:read',
    'invoices:read',
    'webhooks:read',
  ],
} as const;
