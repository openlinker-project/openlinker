/**
 * Release state wire types (#4146, ADR-085)
 *
 * Local mirror of `apps/api/src/release-center/http/dto/release-state.dto.ts`;
 * the browser cannot import `@openlinker/*` (#591), so the shapes live here and
 * the zod schema in `release-state.schema.ts` is the boundary that enforces them.
 *
 * @module features/release-center/api
 */

export type UserItemStatus = 'open' | 'archived' | 'snoozed' | 'deleted';
export type InstallationItemStatus = 'open' | 'done' | 'not_applicable';
export type ReleaseDoneVia = 'auto' | 'manual';

export interface ReleaseCursor {
  lastSeenVersion: string | null;
  skipDialog: boolean;
  updatedAt: string;
}

export interface ReleaseItemState {
  itemKey: string;
  scope: string;
  status: string;
  doneVia: ReleaseDoneVia | null;
  snoozedUntil: string | null;
  updatedAt: string;
  /** Present for admins only. */
  actedByUserId: string | null;
}

export interface ReleaseState {
  /** False when the feature is off or the endpoint is unavailable (404/5xx). */
  enabled: boolean;
  cursor: ReleaseCursor | null;
  user: ReleaseItemState[];
  installation: ReleaseItemState[];
}

export interface UpdateReleaseCursorInput {
  version?: string;
  skipDialog?: boolean;
}

export interface UpdateReleaseCursorResult {
  applied: boolean;
  cursor: ReleaseCursor | null;
}

export interface UserReleaseItemChange {
  itemKey: string;
  status: UserItemStatus;
  doneVia?: ReleaseDoneVia | null;
  snoozedUntil?: string | null;
}

export interface InstallationReleaseItemChange {
  itemKey: string;
  status: InstallationItemStatus;
  doneVia?: ReleaseDoneVia | null;
}
