/**
 * User Management Service Interface
 *
 * Contract for admin operations on users: listing, approval, role assignment,
 * deactivation, and deletion.
 *
 * actorId is the authenticated admin's own user id. The service enforces that
 * an admin cannot deactivate, demote, or delete their own account, and that
 * the last admin cannot be removed.
 *
 * @module apps/api/src/users
 */
import type { User } from '@openlinker/core/users';
import type { UserRole, UserStatus } from '@openlinker/core/users';

export interface IUserManagementService {
  listUsers(opts?: { status?: UserStatus; page?: number; pageSize?: number }): Promise<{ users: User[]; total: number }>;
  approveUser(userId: string, role: UserRole): Promise<void>;
  rejectUser(userId: string): Promise<void>;
  updateRole(userId: string, role: UserRole, actorId: string): Promise<void>;
  deactivateUser(userId: string, actorId: string): Promise<void>;
  reactivateUser(userId: string): Promise<void>;
  deleteUser(userId: string, actorId: string): Promise<void>;
}

export const USER_MANAGEMENT_SERVICE_TOKEN = Symbol('IUserManagementService');
