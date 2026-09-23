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
  findAll(opts?: {
    status?: UserStatus;
    /** #3340 — the packer-roster read filters by this. */
    role?: UserRole;
    page?: number;
    pageSize?: number;
  }): Promise<{ users: User[]; total: number }>;
  save(
    user: Pick<User, 'username' | 'email' | 'passwordHash' | 'role' | 'status'> &
      // Optional so non-registration callers (e.g. bootstrap admin) don't have
      // to set it; the repository defaults it to false (opt-in) when omitted.
      Partial<Pick<User, 'analyticsConsent'>>
  ): Promise<User>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  updateStatus(userId: string, status: UserStatus): Promise<void>;
  updateRole(userId: string, role: UserRole): Promise<void>;
  /**
   * Self-service update of the account's demo-analytics opt-in (#1882).
   * Separate from `save` because it is the one user-owned field a viewer may
   * change on their own account after registration.
   */
  updateAnalyticsConsent(userId: string, analyticsConsent: boolean): Promise<void>;
  /**
   * The packer's own bench/printer label (#3424). Its own narrow write rather
   * than a field on `save`, because `save` round-trips a whole user read
   * elsewhere and would let a stale read revert a label a peer just set.
   *
   * An empty or whitespace-only label is stored as `null` by the caller, not
   * as `''`: "no label" has one spelling, so a reader never has to test two.
   */
  updatePackStationLabel(userId: string, packStationLabel: string | null): Promise<void>;

  /**
   * Stamp `lastActiveAt` to the DATABASE's clock (#3424).
   *
   * Takes no instant, deliberately. The board renders an online/offline
   * verdict by comparing this against `now()`, so a worker running a few
   * seconds ahead would make a packer read as active into the future - the
   * same reason `inventory_items.updatedAt` became database-stamped in #2071.
   *
   * Best-effort by contract: it is called from the bench's hot paths and must
   * never be the reason a pack action fails, so callers swallow its errors.
   */
  touchLastActive(userId: string): Promise<void>;

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
