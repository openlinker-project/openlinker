/**
 * Step visibility (#4145, ADR-085)
 *
 * Staging and main build with the previous release's version, so a step whose
 * `introducedIn` is newer than `APP_VERSION` must never render there: an
 * unreleased step would light up for operators on software that cannot do it.
 * An unknown or invalid app version hides everything rather than guessing.
 *
 * @module features/release-center
 */

import type { ReleaseStepEntry } from '../catalog/release-step.types';
import { compareVersions, isValidVersion } from './compare-versions';

export function visibleSteps<T extends Pick<ReleaseStepEntry, 'introducedIn'>>(
  steps: readonly T[],
  appVersion: string
): T[] {
  if (!isValidVersion(appVersion)) return [];
  return steps.filter(
    (step) =>
      // A step with no release is always on offer.
      step.introducedIn === undefined ||
      (isValidVersion(step.introducedIn) && compareVersions(step.introducedIn, appVersion) <= 0)
  );
}
