/**
 * User role and status labels
 *
 * The words an operator reads for a role or a status, from the `users`
 * namespace. A value the API sends that this build does not know yet is
 * shown as it is, never as a blank.
 *
 * @module features/users/lib
 */
import type { Messages, ResolvedCopy } from '../../../shared/i18n';
import type { UserRole, UserStatus } from '../api/users.types';

type UsersCopy = ResolvedCopy<Messages['users']>;

/** Every role an admin can assign, in the order the role pickers list them. */
export const ASSIGNABLE_ROLES: readonly UserRole[] = ['viewer', 'operator', 'packer', 'admin'];

export function userRoleLabel(role: string, copy: UsersCopy): string {
  return Object.prototype.hasOwnProperty.call(copy.roles, role)
    ? copy.roles[role as UserRole]
    : role;
}

export function userStatusLabel(status: string, copy: UsersCopy): string {
  return Object.prototype.hasOwnProperty.call(copy.statuses, status)
    ? copy.statuses[status as UserStatus]
    : status;
}
