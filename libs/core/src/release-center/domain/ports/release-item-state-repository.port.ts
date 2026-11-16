/**
 * Release Item State Repository Port
 *
 * @module libs/core/src/release-center/domain/ports
 */
import type { ReleaseItemState } from '../entities/release-center.entity';
import type { ReleaseItemStateChange } from '../types/release-center.types';

export interface ReleaseItemStateRepositoryPort {
  listInstallation(): Promise<ReleaseItemState[]>;
  listForUser(userId: string): Promise<ReleaseItemState[]>;

  /**
   * Upsert user-scope rows in one transaction, keys already in a fixed order.
   * The implementation locks the user's state row, enforces `limit` (evicting
   * the oldest `deleted` rows first) and throws `ReleaseStateLimitExceededError`
   * when that is not enough.
   */
  upsertUserStates(
    userId: string,
    changes: readonly ReleaseItemStateChange[],
    limit: number
  ): Promise<ReleaseItemState[]>;

  /** Same contract for installation scope, stamping `actedByUserId`. */
  upsertInstallationStates(
    actedByUserId: string | null,
    changes: readonly ReleaseItemStateChange[],
    limit: number
  ): Promise<ReleaseItemState[]>;

  /**
   * Delete installation rows keyed `stepId:connectionId` whose connection is no
   * longer in `liveConnectionIds`. Returns the number removed.
   */
  pruneInstallationConnectionStates(liveConnectionIds: readonly string[]): Promise<number>;
}
