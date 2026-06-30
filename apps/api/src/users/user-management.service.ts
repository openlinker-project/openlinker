/**
 * User Management Service
 *
 * Implements admin operations on users: listing with optional status filter,
 * approving pending registrations with role assignment, rejecting/deleting
 * pending users, role changes, and deactivate/reactivate lifecycle transitions.
 *
 * Self-protection: an admin cannot deactivate, demote (updateRole to non-admin),
 * or delete their own account (CannotSelfModifyException).
 * Last-admin guard: operations that would remove or deactivate the sole admin
 * are rejected (LastAdminException).
 *
 * @module apps/api/src/users
 * @implements {IUserManagementService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  CannotSelfModifyException,
  LastAdminException,
  UserNotFoundException,
  UserNotActiveException,
  UserNotDeactivatedException,
  UserNotPendingException,
  UserRepositoryPort,
  USER_REPOSITORY_TOKEN,
} from '@openlinker/core/users';
import type { User, UserRole, UserStatus } from '@openlinker/core/users';
import type { IUserManagementService } from './user-management.service.interface';

@Injectable()
export class UserManagementService implements IUserManagementService {
  private readonly logger = new Logger(UserManagementService.name);

  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort
  ) {}

  async listUsers(opts?: {
    status?: UserStatus;
    page?: number;
    pageSize?: number;
  }): Promise<{ users: User[]; total: number }> {
    return this.userRepository.findAll(opts);
  }

  async approveUser(userId: string, role: UserRole): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.status !== 'pending') {
      throw new UserNotPendingException(userId);
    }
    await this.userRepository.approveUser(userId, role);
    this.logger.log(`User approved: ${userId} with role ${role}`);
  }

  async rejectUser(userId: string): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.status !== 'pending') {
      throw new UserNotPendingException(userId);
    }
    await this.userRepository.deleteById(userId);
    this.logger.log(`Pending user rejected and deleted: ${userId}`);
  }

  async updateRole(userId: string, role: UserRole, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new CannotSelfModifyException();
    }
    const user = await this.requireUser(userId);
    if (user.role === 'admin' && role !== 'admin') {
      // Atomic: count check + role update in one statement (TOCTOU guard).
      const { updated } = await this.userRepository.updateAdminRoleAtomically(userId, role);
      if (!updated) throw new LastAdminException();
    } else {
      await this.userRepository.updateRole(userId, role);
    }
    this.logger.log(`User role updated: ${userId} → ${role}`);
  }

  async deactivateUser(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new CannotSelfModifyException();
    }
    const user = await this.requireUser(userId);
    if (user.status !== 'active') {
      throw new UserNotActiveException(userId);
    }
    if (user.role === 'admin') {
      // Atomic: count check + deactivation in one statement (TOCTOU guard).
      const { updated } = await this.userRepository.deactivateAdminAtomically(userId);
      if (!updated) throw new LastAdminException();
    } else {
      await this.userRepository.updateStatus(userId, 'deactivated');
    }
    this.logger.log(`User deactivated: ${userId}`);
  }

  async reactivateUser(userId: string): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.status !== 'deactivated') {
      throw new UserNotDeactivatedException(userId);
    }
    await this.userRepository.updateStatus(userId, 'active');
    this.logger.log(`User reactivated: ${userId}`);
  }

  async deleteUser(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new CannotSelfModifyException();
    }
    const user = await this.requireUser(userId);
    if (user.role === 'admin') {
      // Atomic: count check + delete in one statement (TOCTOU guard).
      const { deleted } = await this.userRepository.deleteAdminAtomically(userId);
      if (!deleted) throw new LastAdminException();
    } else {
      await this.userRepository.deleteById(userId);
    }
    this.logger.log(`User deleted: ${userId}`);
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UserNotFoundException(userId);
    }
    return user;
  }
}
