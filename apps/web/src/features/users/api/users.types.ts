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
  /**
   * This user's own free-text bench/printer label (#3404), e.g.
   * "Zebra ZD420 / Bench 3", or `null` if unset. Operator configuration set
   * by an admin — see `PATCH /users/:id/pack-station-label`.
   */
  packStationLabel: string | null;
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

/**
 * Minimal roster entry from `GET /users/packers` (#3340; `online` /
 * `stationLabel` added #3424) — NOT a narrowed `UserSummary`: that endpoint
 * is reachable by `operator` as well as `admin`, so its response
 * deliberately carries no email/status/createdAt.
 */
export interface PackerSummary {
  id: string;
  username: string;
  /**
   * Server-derived presence, already thresholded — render it, never
   * recompute it from anything else this app holds.
   */
  online: boolean;
  /** Operator-typed free text, e.g. "Bench 3 / Zebra ZD420". `null` = unset. */
  stationLabel: string | null;
}

export interface PackerListResponse {
  packers: PackerSummary[];
}

/**
 * Mirrors `PACK_STATION_LABEL_MAX_LENGTH` in
 * `apps/api/src/users/dto/update-pack-station-label.dto.ts`. `apps/web`
 * cannot import from `apps/api` (#591's rule applied one package over), so
 * this is a hand-kept copy — extend both in the same change.
 */
export const PACK_STATION_LABEL_MAX_LENGTH = 120;

/**
 * `PATCH /users/:id/pack-station-label` request body. `null` is an explicit
 * CLEAR, which is why the field is nullable rather than optional — see the
 * dialog schema for the `''` (form) → `null` (wire) mapping.
 */
export interface UpdatePackStationLabelInput {
  packStationLabel: string | null;
}
