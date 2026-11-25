/**
 * Release Cursor Repository Port
 *
 * @module libs/core/src/release-center/domain/ports
 */
import type { UserReleaseState } from '../entities/release-center.entity';
import type { ParsedReleaseVersion } from '../types/release-center.types';

export interface AdvanceReleaseCursorResult {
  /** False when the stored version was already equal or newer. */
  applied: boolean;
  state: UserReleaseState;
}

export interface ReleaseCursorRepositoryPort {
  findByUserId(userId: string): Promise<UserReleaseState | null>;

  /**
   * Create the row if absent, then move the cursor only when the new
   * `(major, minor, patch, rank)` tuple is greater, in one atomic statement.
   * A rejected write is a normal result (`applied: false`), not an error.
   */
  advanceCursor(userId: string, version: ParsedReleaseVersion): Promise<AdvanceReleaseCursorResult>;

  setSkipDialog(userId: string, skipDialog: boolean): Promise<UserReleaseState>;
}
