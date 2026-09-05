export type UserStatus = 'pending' | 'active' | 'deactivated';
/**
 * Mirrors `UserRoleValues` in `@openlinker/core/users`. `apps/web` cannot
 * import from `@openlinker/core` (#591), so this union is a hand-kept copy —
 * extend it in the same change that adds a backend role, or an admin cannot
 * assign the role that was just created.
 *
 * `packer` (#2413, ADR-071): a pack-bench packer, deliberately NARROWER than
 * `operator`. Sign-in is a shift-boundary event at a shared, roaming terminal.
 */
export type UserRole = 'admin' | 'operator' | 'viewer' | 'packer';

export interface UserSummary {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export interface UserListResponse {
  users: UserSummary[];
  total: number;
}

export interface UserListFilters {
  status?: UserStatus;
  page?: number;
  pageSize?: number;
}

export interface ApproveUserInput {
  role: UserRole;
}
