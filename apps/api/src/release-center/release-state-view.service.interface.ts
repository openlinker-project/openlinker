/**
 * Release State View Service Interface
 *
 * @module apps/api/src/release-center
 */
import type {
  ReleaseItemState,
  ReleaseItemStateChange,
  UserReleaseState,
} from '@openlinker/core/release-center';

export interface ReleaseStateView {
  enabled: boolean;
  cursor: UserReleaseState | null;
  user: ReleaseItemState[];
  installation: ReleaseItemState[];
}

export interface IReleaseStateViewService {
  /** Always resolves; a disabled feature answers without touching the tables. */
  getView(userId: string): Promise<ReleaseStateView>;
  advanceCursor(
    userId: string,
    update: { version?: string; skipDialog?: boolean }
  ): Promise<{ applied: boolean; cursor: UserReleaseState | null }>;
  applyUserStates(
    userId: string,
    changes: readonly ReleaseItemStateChange[]
  ): Promise<ReleaseItemState[]>;
  applyInstallationStates(
    actedByUserId: string,
    changes: readonly ReleaseItemStateChange[]
  ): Promise<ReleaseItemState[]>;
}

export const RELEASE_STATE_VIEW_SERVICE_TOKEN = Symbol('IReleaseStateViewService');
