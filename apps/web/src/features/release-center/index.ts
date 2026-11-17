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
export { ReleaseStepObserver } from './components/release-step-observer';
export { useReleaseCenterAccess, type ReleaseCenterAccess } from './hooks/use-release-center-access';
export { useReleaseStateQuery, useReleaseCenterEnabled } from './hooks/use-release-state-query';
export { useReleaseCursorMutation } from './hooks/use-release-cursor-mutation';
export { useRejectedCursorVersions } from './hooks/release-cursor-write-memory';
export { useReleaseItemStatesMutation } from './hooks/use-release-item-states-mutation';
export { useReleaseStepsMutation } from './hooks/use-release-steps-mutation';
export { releaseStepItemKey, installationStatusOf } from './lib/release-state-merge';
export { completedStepItemKeys } from './lib/completed-steps';
export { releaseStateQueryKeys } from './api/release-state.query-keys';
export type {
  InstallationReleaseItemChange,
  ReleaseCursor,
  ReleaseDoneVia,
  ReleaseItemState,
  ReleaseState,
  UserReleaseItemChange,
} from './api/release-state.types';
export { ReleaseBell } from './components/release-bell';
export { ReleaseCenterProvider, useReleaseCenterView } from './components/release-center-provider';
export {
  requestReleaseTour,
  requestWhatsNew,
  subscribeToTourRequests,
  subscribeToWhatsNewRequests,
  type TourRequest,
  type WhatsNewRequest,
} from './lib/release-center-requests';
