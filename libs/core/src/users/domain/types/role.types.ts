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
  // DISPLAY-ONLY (#1826): gates carrier-message disclosure on the shipments
  // read paths plus the FE's write affordances. It authorizes no mutation — the
  // shipping mutations are `@Roles('admin', 'operator')`-gated and no
  // permission-based guard exists. Keep the roles holding this permission
  // identical to those `@Roles` lists (asserted in `shipment.controller.spec.ts`).
  'shipments:write',
  'invoices:read',
  'invoices:write',
  'webhooks:read',
  'ai:suggest',
  'content:write',
  // Automation v1 (#2364). The roles holding these MUST stay identical to the
  // `@Roles` lists on `AutomationsController`: every read and the dry run are
  // `admin` + `operator`, every write is `admin`. Arming a rule is a standing,
  // uncounted grant of authority to act for the operator — one rule can buy a
  // thousand labels — so the write stays admin-only, matching that controller's
  // own reasoning. Same discipline as `shipments:write` above.
  'automations:read',
  'automations:write',
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
    'shipments:write',
    'invoices:read',
    'webhooks:read',
    'content:write',
    'automations:read',
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
