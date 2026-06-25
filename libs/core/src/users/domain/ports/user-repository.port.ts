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
}
