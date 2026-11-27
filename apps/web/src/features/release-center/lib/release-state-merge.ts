/**
 * Pure helpers for optimistic release-state updates and step item keys (#4146)
 *
 * @module features/release-center
 */
import type {
  InstallationReleaseItemChange,
  ReleaseItemState,
  ReleaseState,
  UserReleaseItemChange,
} from '../api/release-state.types';

/**
 * Item key of a step. A connection-scoped step is one item per connection, so
 * completing the step for account A never completes it for account B; an
 * installation step is just its id. Matches the API's `RELEASE_ITEM_KEY_PATTERN`
 * (`[a-z0-9][a-z0-9:-]{0,127}`) as long as ids are kebab-case and connection ids
 * are UUIDs, which lower-casing guarantees.
 */
export function releaseStepItemKey(stepId: string, connectionId: string | null): string {
  return connectionId ? `${stepId}:${connectionId}`.toLowerCase() : stepId;
}

function upsert(
  rows: readonly ReleaseItemState[],
  changes: readonly { itemKey: string; status: string; doneVia?: 'auto' | 'manual' | null; snoozedUntil?: string | null }[],
  scope: 'user' | 'installation',
  now: string
): ReleaseItemState[] {
  const next = new Map(rows.map((row) => [row.itemKey, row]));
  for (const change of changes) {
    const prev = next.get(change.itemKey);
    next.set(change.itemKey, {
      itemKey: change.itemKey,
      scope: prev?.scope ?? scope,
      status: change.status,
      doneVia: change.doneVia ?? null,
      snoozedUntil: change.snoozedUntil ?? null,
      updatedAt: now,
      actedByUserId: prev?.actedByUserId ?? null,
    });
  }
  return [...next.values()];
}

export function applyUserChanges(
  state: ReleaseState,
  changes: readonly UserReleaseItemChange[],
  now: string
): ReleaseState {
  return { ...state, user: upsert(state.user, changes, 'user', now) };
}

export function applyInstallationChanges(
  state: ReleaseState,
  changes: readonly InstallationReleaseItemChange[],
  now: string
): ReleaseState {
  return { ...state, installation: upsert(state.installation, changes, 'installation', now) };
}

/** Installation status of an item key, or `open` when nothing is stored. */
export function installationStatusOf(state: ReleaseState | undefined, itemKey: string): string {
  return state?.installation.find((row) => row.itemKey === itemKey)?.status ?? 'open';
}
