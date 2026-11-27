/**
 * Release Center Entities
 *
 * @module libs/core/src/release-center/domain/entities
 */
import type {
  ParsedReleaseVersion,
  ReleaseDoneVia,
  ReleaseItemScope,
  ReleaseItemStatus,
} from '../types/release-center.types';

/** One row per user: the version cursor and the dialog preference. */
export class UserReleaseState {
  constructor(
    public readonly userId: string,
    /** Null until the first load sets it to the running version. */
    public readonly version: ParsedReleaseVersion | null,
    public readonly skipDialog: boolean,
    public readonly updatedAt: Date
  ) {}
}

export class ReleaseItemState {
  constructor(
    public readonly id: string,
    public readonly scope: ReleaseItemScope,
    /** Present exactly when `scope === 'user'`. */
    public readonly userId: string | null,
    public readonly itemKey: string,
    public readonly status: ReleaseItemStatus,
    public readonly doneVia: ReleaseDoneVia | null,
    public readonly actedByUserId: string | null,
    public readonly snoozedUntil: Date | null,
    public readonly updatedAt: Date
  ) {}
}
