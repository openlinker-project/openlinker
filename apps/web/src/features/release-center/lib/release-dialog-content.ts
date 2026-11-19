/**
 * Update dialog content (#4147, ADR-085)
 *
 * Pure selection of what the dialog shows: the curated highlights of the
 * releases the user has not seen (capped at four), how many changes stay in the
 * full changelog, and the step rows of this update. Kept free of React so the
 * "never empty, never a wall of text" rules are testable on their own.
 *
 * @module features/release-center
 */
import type { ChangelogEntry, ChangelogRelease } from '../../../build-time/changelog-parser';
import type { ReleaseStepConnection, ReleaseStepEntry } from '../catalog/release-step.types';
import type { ReleaseState } from '../api/release-state.types';
import { compareVersions, isValidVersion } from './compare-versions';
import { installationStatusOf, releaseStepItemKey } from './release-state-merge';
import { visibleSteps } from './visible-steps';

export const DIALOG_HIGHLIGHT_LIMIT = 4;

export interface DialogHighlights {
  highlights: ChangelogEntry[];
  /** Changes of the same range that stay in the full changelog. */
  overflow: number;
}

function majorMinor(version: string): string {
  const [major, minor] = version.split('.');
  return `${major}.${minor}`;
}

function matchesCommit(entry: ChangelogEntry, hash: string): boolean {
  return entry.commits.some((c) => c.startsWith(hash) || hash.startsWith(c));
}

export function releasesInRange<T extends Pick<ChangelogRelease, 'version'>>(
  releases: readonly T[],
  cursor: string,
  appVersion: string
): T[] {
  return releases.filter(
    (r) =>
      isValidVersion(r.version) &&
      compareVersions(r.version, cursor) > 0 &&
      compareVersions(r.version, appVersion) <= 0
  );
}

export function buildDialogHighlights(
  releases: readonly ChangelogRelease[],
  cursor: string,
  appVersion: string,
  curatedFor: (majorMinor: string) => readonly string[],
  limit: number = DIALOG_HIGHLIGHT_LIMIT
): DialogHighlights {
  const inRange = releasesInRange(releases, cursor, appVersion);
  const all = inRange.flatMap((r) => r.groups.flatMap((g) => g.entries));
  const picked: ChangelogEntry[] = [];
  for (const release of inRange) {
    const entries = release.groups.flatMap((g) => g.entries);
    for (const hash of curatedFor(majorMinor(release.version))) {
      const hit = entries.find((entry) => matchesCommit(entry, hash));
      if (hit && !picked.includes(hit)) picked.push(hit);
    }
  }
  // A release whose curated hashes matched nothing must still show something.
  const source = picked.length > 0 ? picked : all;
  const highlights = source.slice(0, limit);
  return { highlights, overflow: Math.max(0, all.length - highlights.length) };
}

export type ReleaseStepImportanceValue = 'required' | 'optional';

export interface ReleaseStepRow {
  key: string;
  step: ReleaseStepEntry;
  connection: { id: string; name: string } | null;
  itemKey: string;
  importance: ReleaseStepImportanceValue;
  done: boolean;
}

export interface NamedStepConnection extends ReleaseStepConnection {
  name: string;
}

/**
 * One row per step, and per connection for a connection-scoped step. The count
 * of carrier-named methods that still go through the shop is not known to the
 * browser here, so importance comes from the catalog with that count at zero;
 * a step whose rule needs it stays optional rather than claiming a requirement
 * the page cannot back.
 */
export function buildStepRows(
  steps: readonly ReleaseStepEntry[],
  connections: readonly NamedStepConnection[],
  state: ReleaseState | undefined,
  appVersion: string,
  introducedAfter: string | null = null
): ReleaseStepRow[] {
  const rows: ReleaseStepRow[] = [];
  const inScope = visibleSteps(steps, appVersion).filter(
    (step) =>
      step.introducedIn !== undefined &&
      (!introducedAfter || compareVersions(step.introducedIn, introducedAfter) > 0)
  );
  for (const step of inScope) {
    const targets: (NamedStepConnection | null)[] =
      step.scope === 'connection' ? [...connections] : [null];
    for (const connection of targets) {
      const ctx = { connection, unassignedCarrierMethods: 0 };
      if (!step.appliesWhen(ctx)) continue;
      const itemKey = releaseStepItemKey(step.id, connection?.id ?? null);
      rows.push({
        key: itemKey,
        step,
        connection: connection ? { id: connection.id, name: connection.name } : null,
        itemKey,
        importance: step.importance(ctx),
        done: installationStatusOf(state, itemKey) !== 'open',
      });
    }
  }
  return rows.sort(
    (a, b) => Number(a.importance === 'optional') - Number(b.importance === 'optional')
  );
}
