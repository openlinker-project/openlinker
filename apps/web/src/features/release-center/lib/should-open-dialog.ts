/**
 * Update dialog decision (#4145, ADR-085)
 *
 * Pure: opens only when the app moved to a higher minor or major than the
 * user's cursor AND there is something to show. A patch never opens it (its new
 * steps go to the bell), an empty or unreadable cursor is initialised to the
 * app version without a dialog (a fresh or pre-feature install must not be shown
 * a changelog it never lived through), and a downgrade leaves the cursor alone.
 *
 * @module features/release-center
 */

import type { ChangelogRelease } from '../../../build-time/changelog-parser';
import type { ReleaseStepEntry } from '../catalog/release-step.types';
import { compareVersions, isMinorOrMajorIncrease, isValidVersion } from './compare-versions';
import { visibleSteps } from './visible-steps';

export type DialogDecisionReason =
  | 'invalid-app-version'
  | 'no-cursor'
  | 'downgrade'
  | 'same-version'
  | 'patch-only'
  | 'nothing-to-show'
  | 'minor-or-major';

export interface DialogDecision {
  open: boolean;
  /** Version the cursor must be written to without opening anything, or null. */
  initialiseCursorTo: string | null;
  reason: DialogDecisionReason;
}

export function shouldOpenDialog(
  cursor: string | null | undefined,
  appVersion: string,
  releases: readonly Pick<ChangelogRelease, 'version' | 'groups'>[],
  steps: readonly Pick<ReleaseStepEntry, 'introducedIn'>[]
): DialogDecision {
  if (!isValidVersion(appVersion)) {
    return { open: false, initialiseCursorTo: null, reason: 'invalid-app-version' };
  }
  if (!cursor || !isValidVersion(cursor)) {
    return { open: false, initialiseCursorTo: appVersion, reason: 'no-cursor' };
  }
  const order = compareVersions(cursor, appVersion);
  if (order > 0) return { open: false, initialiseCursorTo: null, reason: 'downgrade' };
  if (order === 0) return { open: false, initialiseCursorTo: null, reason: 'same-version' };
  if (!isMinorOrMajorIncrease(cursor, appVersion)) {
    return { open: false, initialiseCursorTo: null, reason: 'patch-only' };
  }

  const inRange = (version: string): boolean =>
    isValidVersion(version) &&
    compareVersions(version, cursor) > 0 &&
    compareVersions(version, appVersion) <= 0;

  const hasEntries = releases.some(
    (release) => inRange(release.version) && release.groups.some((g) => g.entries.length > 0)
  );
  const hasSteps = visibleSteps(steps, appVersion).some((step) => inRange(step.introducedIn));
  if (!hasEntries && !hasSteps) {
    return { open: false, initialiseCursorTo: null, reason: 'nothing-to-show' };
  }
  return { open: true, initialiseCursorTo: null, reason: 'minor-or-major' };
}
