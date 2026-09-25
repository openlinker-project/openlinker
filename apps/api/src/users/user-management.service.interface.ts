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

/** Input for {@link IUserManagementService.createUser} (#3456). */
export interface CreateUserInput {
  readonly displayName: string;
  readonly username: string;
  readonly email: string | null;
  readonly role: UserRole;
}

/**
 * The created account and its one-time password (#3456). The password is
 * returned to the caller exactly once and exists nowhere else in plain text.
 */
export interface CreatedUser {
  readonly id: string;
  readonly temporaryPassword: string;
}

export interface IUserManagementService {
  listUsers(opts?: {
    status?: UserStatus;
    /** #3340 — the packer-roster read filters by this. */
    role?: UserRole;
    page?: number;
    pageSize?: number;
  }): Promise<{ users: User[]; total: number }>;
  /**
   * Create an ACTIVE account directly, with a server-generated one-time
   * password it must replace at first sign-in (#3456). The admin path for a
   * packer who has no work email and cannot self-register.
   *
   * Throws `UserAlreadyExistsException` with `field` set when the username or
   * email is taken — including by a concurrent create that won the race.
   */
  createUser(input: CreateUserInput): Promise<CreatedUser>;
  approveUser(userId: string, role: UserRole): Promise<void>;
  rejectUser(userId: string): Promise<void>;
  updateRole(userId: string, role: UserRole, actorId: string): Promise<void>;
  deactivateUser(userId: string, actorId: string): Promise<void>;
  reactivateUser(userId: string): Promise<void>;
  deleteUser(userId: string, actorId: string): Promise<void>;

  /**
   * Transitions a user from `pending_confirmation` to `active` after a valid
   * single-use email confirmation token was consumed (#1624). Throws
   * UserNotPendingConfirmationException if the account isn't awaiting
   * confirmation (e.g. already confirmed).
   */
  /**
   * Set (or clear) a packer's own bench/printer label (#3424).
   *
   * A blank or whitespace-only value is stored as `null`, never `''`: "no
   * label" gets one spelling, so no reader has to test two.
   *
   * Operator CONFIG, not identity - ADR-071 refuses a station principal, so
   * this value authenticates nothing and is displayed exactly like a
   * connection's operator-authored name.
   */
  setPackStationLabel(userId: string, packStationLabel: string | null): Promise<void>;

  /**
   * Record that this user just did something AT A BENCH (#3424) - scanned a
   * unit, claimed a parcel, closed one, or had one open while the presence
   * ping fired.
   *
   * Never called on login or on a session refresh, which is the whole point:
   * an account that signed in this morning and has not touched a bench since
   * must read as offline, or the board reports the warehouse as staffed by
   * everyone who happens to be logged in.
   *
   * BEST-EFFORT by contract. It is on the bench's hot paths and resolves
   * `void` whatever happens: a failed heartbeat must never be the reason a
   * scan or a parcel close fails, because the consequence of losing it is a
   * swimlane that reads offline for a few minutes, and the consequence of
   * throwing is a packer who cannot pack.
   */
  recordBenchActivity(userId: string): Promise<void>;

  confirmEmail(userId: string): Promise<void>;
}

export const USER_MANAGEMENT_SERVICE_TOKEN = Symbol('IUserManagementService');
