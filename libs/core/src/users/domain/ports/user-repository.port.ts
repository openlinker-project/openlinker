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
  countByRole(role: UserRole): Promise<number>;
  save(user: Pick<User, 'username' | 'email' | 'passwordHash' | 'role' | 'status'>): Promise<User>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  updateStatus(userId: string, status: UserStatus): Promise<void>;
  updateRole(userId: string, role: UserRole): Promise<void>;
  approveUser(userId: string, role: UserRole): Promise<void>;
  deleteById(userId: string): Promise<void>;

  /**
   * Atomically deactivates an admin user only when 2+ admins remain active.
   * The admin-count check and status update occur in a single SQL statement,
   * eliminating the check-then-act race that a separate guardLastAdmin() call
   * would introduce. Throws LastAdminException when the conditional update
   * matches 0 rows (i.e., this admin is the last active one).
   */
  deactivateIfNotLastAdmin(userId: string): Promise<void>;

  /**
   * Atomically demotes an admin to a non-admin role only when 2+ admins remain.
   * See deactivateIfNotLastAdmin for the race-condition rationale.
   * Throws LastAdminException if this admin is the only one.
   */
  updateRoleIfNotLastAdmin(userId: string, role: UserRole): Promise<void>;

  /**
   * Atomically deletes an admin user only when 2+ admins exist.
   * See deactivateIfNotLastAdmin for the race-condition rationale.
   * Throws LastAdminException if this admin is the only one.
   */
  deleteIfNotLastAdmin(userId: string): Promise<void>;
}
