/**
 * Release Cursor Service Interface
 *
 * @module libs/core/src/release-center/application/services
 */
import type { UserReleaseState } from '../../domain/entities/release-center.entity';

export interface ReleaseCursorUpdate {
  applied: boolean;
  state: UserReleaseState;
}

export interface IReleaseCursorService {
  /** Null when this user has no row yet. */
  getState(userId: string): Promise<UserReleaseState | null>;

  /**
   * Move the cursor forward. A regression or equal version is not an error:
   * it returns `applied: false` with the current state. Throws
   * `InvalidReleaseVersionError` for an unparseable version.
   */
  advance(userId: string, version: string): Promise<ReleaseCursorUpdate>;

  setSkipDialog(userId: string, skipDialog: boolean): Promise<UserReleaseState>;
}
