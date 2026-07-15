/**
 * User Status Type Definitions
 *
 * Defines the lifecycle status values for a user account. New registrations
 * land as `pending` until an admin approves them. Admins can deactivate
 * active accounts to revoke login access without deleting the record.
 *
 * @module libs/core/src/users/domain/types
 */

/**
 * Valid user status values.
 *
 * - `pending`: Self-registered, awaiting admin approval; cannot log in.
 * - `pending_confirmation`: Self-registered (demo signup), awaiting the user
 *   to confirm ownership of their email address via the single-use
 *   confirmation link (#1624); cannot log in until confirmed.
 * - `active`: Approved (or self-confirmed) and able to log in.
 * - `deactivated`: Previously active; login access revoked by an admin.
 */
export const UserStatusValues = ['pending', 'pending_confirmation', 'active', 'deactivated'] as const;

/**
 * Union type derived from UserStatusValues.
 */
export type UserStatus = (typeof UserStatusValues)[number];
