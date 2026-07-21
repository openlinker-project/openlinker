/**
 * User Repository Port
 *
 * Defines the contract for user persistence operations. Implemented by
 * UserRepository in the infrastructure layer.
 *
 * @module libs/core/src/users/domain/ports
 */
import type { User } from '../entities/user.entity';
import type { UserStatus } from '../types/user-status.types';
import type { UserRole } from '../types/role.types';

export interface UserRepositoryPort {
  findByUsername(username: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findAll(opts?: { status?: UserStatus; page?: number; pageSize?: number }): Promise<{ users: User[]; total: number }>;
  save(
    user: Pick<User, 'username' | 'email' | 'passwordHash' | 'role' | 'status'> &
      // Optional so non-registration callers (e.g. bootstrap admin) don't have
      // to opt in; the repository defaults it to true (default-on) when omitted.
      Partial<Pick<User, 'analyticsConsent'>>
  ): Promise<User>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  updateStatus(userId: string, status: UserStatus): Promise<void>;
  updateRole(userId: string, role: UserRole): Promise<void>;
  approveUser(userId: string, role: UserRole): Promise<void>;
  deleteById(userId: string): Promise<void>;

  /**
   * Viewer-role accounts in one of `statuses`, created before `olderThan` —
   * the self-registration shape (#1469's demo-account cleanup, widened by
   * #1624 to also sweep never-confirmed `pending_confirmation` signups so
   * they don't accumulate forever on a public demo deployment). Scoped to
   * `role: 'viewer'` because `RegistrationService.register` always creates
   * viewer accounts; an operator-created persistent viewer account is
   * indistinguishable from a demo one by this query (documented limitation).
   */
  findStaleViewerAccounts(olderThan: Date, statuses: UserStatus[]): Promise<User[]>;

  /**
   * Atomically deactivates an admin only when 2+ active admins exist.
   * Returns { updated: true } on success; { updated: false } when the user
   * is the sole active admin (guard fired). The caller decides the meaning.
   */
  deactivateAdminAtomically(userId: string): Promise<{ updated: boolean }>;

  /**
   * Atomically demotes an admin to a non-admin role only when 2+ active admins exist.
   * Returns { updated: true } on success; { updated: false } when the guard fired.
   */
  updateAdminRoleAtomically(userId: string, role: UserRole): Promise<{ updated: boolean }>;

  /**
   * Atomically deletes an admin only when 2+ active admins exist.
   * Returns { deleted: true } on success; { deleted: false } when the guard fired.
   */
  deleteAdminAtomically(userId: string): Promise<{ deleted: boolean }>;
}
