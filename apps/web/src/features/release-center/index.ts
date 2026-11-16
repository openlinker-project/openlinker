/**
 * Release center - public barrel (#4145)
 *
 * @module features/release-center
 */
export { RELEASE_STEPS } from './catalog/release-steps';
export { RELEASE_HIGHLIGHTS, highlightsForMinor } from './catalog/release-highlights';
export type {
  ReleaseStepContext,
  ReleaseStepEntry,
  ReleaseStepImportance,
  ReleaseStepScope,
} from './catalog/release-step.types';
export { compareVersions, isMinorOrMajorIncrease, isValidVersion } from './lib/compare-versions';
export { shouldOpenDialog, type DialogDecision } from './lib/should-open-dialog';
export { visibleSteps } from './lib/visible-steps';
