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
 * - `admin`: Full access to all endpoints
 * - `viewer`: Read-only access to operational data
 */
export const UserRoleValues = ['admin', 'viewer'] as const;

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
] as const;

/**
 * Union type derived from PermissionValues.
 */
export type Permission = (typeof PermissionValues)[number];

/**
 * Maps each role to its granted permissions.
 * Permissions are derived at response time, not stored in the database.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: PermissionValues,
  viewer: ['connections:read', 'sync:read', 'integrations:read', 'adapters:read'],
} as const;
