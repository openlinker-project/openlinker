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
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Logger } from '@openlinker/shared/logging';
import {
  CannotSelfModifyException,
  LastAdminException,
  UserNotFoundException,
  UserNotActiveException,
  UserNotDeactivatedException,
  UserNotPendingException,
  UserNotPendingConfirmationException,
  UserAlreadyExistsException,
  UserRepositoryPort,
  USER_REPOSITORY_TOKEN,
} from '@openlinker/core/users';
import type { User, UserRole, UserStatus } from '@openlinker/core/users';
import type {
  CreatedUser,
  CreateUserInput,
  IUserManagementService,
} from './user-management.service.interface';

// Same cost `RegistrationService` and `BootstrapAdminService` use.
const BCRYPT_COST = 10;

/**
 * Bytes of CSPRNG output behind a temporary password: 12 bytes is 16
 * base64url characters (96 bits) — far beyond guessing, and short enough to
 * read aloud or type from a note at a packing bench.
 */
const TEMPORARY_PASSWORD_BYTES = 12;

@Injectable()
export class UserManagementService implements IUserManagementService {
  private readonly logger = new Logger(UserManagementService.name);

  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepositoryPort
  ) {}

  async listUsers(opts?: {
    status?: UserStatus;
    role?: UserRole;
    page?: number;
    pageSize?: number;
  }): Promise<{ users: User[]; total: number }> {
    return this.userRepository.findAll(opts);
  }

  async createUser(input: CreateUserInput): Promise<CreatedUser> {
    // Pre-checks name the colliding field for the admin; the unique
    // constraints behind `save` stay the guarantee against a concurrent create.
    if (await this.userRepository.findByUsername(input.username)) {
      throw new UserAlreadyExistsException(input.username, 'username');
    }
    if (input.email !== null && (await this.userRepository.findByEmail(input.email))) {
      throw new UserAlreadyExistsException(input.email, 'email');
    }

    const temporaryPassword = randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);

    const user = await this.userRepository.save({
      username: input.username,
      email: input.email,
      passwordHash,
      role: input.role,
      status: 'active',
      displayName: input.displayName,
      mustChangePassword: true,
    });

    // Never the password, and never the email: an id and a role are enough to
    // trace the act.
    this.logger.log(`User created by admin: ${user.id} with role ${user.role}`);
    return { id: user.id, temporaryPassword };
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

  async setPackStationLabel(userId: string, packStationLabel: string | null): Promise<void> {
    await this.requireUser(userId);
    // One spelling for "no label": a blank or whitespace-only value collapses
    // to `null` here rather than reaching the column as `''`, so every reader
    // tests one thing.
    const trimmed = packStationLabel === null ? null : packStationLabel.trim();
    const normalised = trimmed === null || trimmed.length === 0 ? null : trimmed;
    await this.userRepository.updatePackStationLabel(userId, normalised);
    // The LABEL is logged, not the value's absence-vs-presence alone: it is
    // operator configuration, carries no authentication weight, and an
    // operator asking "why does bench 3 say the wrong printer" needs the
    // change to be findable.
    this.logger.log(`Pack station label set: ${userId} -> ${normalised ?? '(cleared)'}`);
  }

  async recordBenchActivity(userId: string): Promise<void> {
    // Best-effort, by the interface's own contract. No `requireUser` read
    // first: this runs on the bench's hot paths, the write is already
    // primary-key-scoped, and an id that names nobody simply updates no rows.
    try {
      await this.userRepository.touchLastActive(userId);
    } catch (error) {
      // Swallowed deliberately, and logged at `warn` rather than `error`: the
      // cost of losing a heartbeat is a swimlane that reads offline for a few
      // minutes, and the cost of rethrowing is a packer who cannot pack.
      this.logger.warn(
        `Bench activity heartbeat failed for ${userId}: ${(error as Error).message}`
      );
    }
  }

  async confirmEmail(userId: string): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.status !== 'pending_confirmation') {
      throw new UserNotPendingConfirmationException(userId);
    }
    await this.userRepository.updateStatus(userId, 'active');
    this.logger.log(`User email confirmed and activated: ${userId}`);
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UserNotFoundException(userId);
    }
    return user;
  }
}
