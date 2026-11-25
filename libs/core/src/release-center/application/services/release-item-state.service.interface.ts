/**
 * Release Item State Service Interface
 *
 * The user id is always an argument taken from the token by the caller, never
 * read from a request body.
 *
 * @module libs/core/src/release-center/application/services
 */
import type { ReleaseItemState } from '../../domain/entities/release-center.entity';
import type { ReleaseItemStateChange } from '../../domain/types/release-center.types';

export interface ReleaseStateSnapshot {
  user: ReleaseItemState[];
  installation: ReleaseItemState[];
}

export interface IReleaseItemStateService {
  getSnapshot(userId: string): Promise<ReleaseStateSnapshot>;

  /** Throws `InvalidReleaseStateError` / `ReleaseStateLimitExceededError`. */
  applyUserStates(
    userId: string,
    changes: readonly ReleaseItemStateChange[]
  ): Promise<ReleaseItemState[]>;

  /** Admin-only at the interface layer; core has no roles. */
  applyInstallationStates(
    actedByUserId: string,
    changes: readonly ReleaseItemStateChange[]
  ): Promise<ReleaseItemState[]>;
}
