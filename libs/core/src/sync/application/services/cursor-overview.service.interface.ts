/**
 * Cursor Overview Service Interface (#4023)
 *
 * @module libs/core/src/sync/application/services
 */
import type {
  CursorOverview,
  CursorRewindInput,
  CursorRewindResult,
} from '../../domain/types/cursor-overview.types';

export interface ICursorOverviewService {
  /**
   * Every cursor grouped by connection, each with its last run; write marks
   * summarised. Pass a connection to read only its cursors - the way to see
   * all of one connection's bookmarks when the full overview is truncated.
   */
  getOverview(filter?: { connectionId?: string }): Promise<CursorOverview>;

  /**
   * Move one cursor back to a named target. Only catalogue-approved
   * `(key, target)` pairs are accepted; free-text values never are.
   *
   * @throws CursorRewindRefusedError
   */
  rewind(input: CursorRewindInput): Promise<CursorRewindResult>;
}
