/**
 * Tour steps for a request (#4150)
 *
 * Turns a "show me" request from the bell, the panel or the dialog into the
 * steps the tour walks: the still-open step instances, starting at the asked
 * one. Pure so the ordering rule is testable without a router.
 *
 * @module features/release-center/tour
 */
import type { ReleaseState } from '../api/release-state.types';
import { installationStatusOf } from '../lib/release-state-merge';
import type { StepInstance } from '../lib/release-notifications';
import type { TourRequest } from '../lib/release-center-requests';
import type { TourStepInput } from './tour-context';

export function tourStepsForRequest(
  instances: readonly StepInstance[],
  state: ReleaseState | undefined,
  request: TourRequest
): TourStepInput[] {
  const open = instances.filter((i) => installationStatusOf(state, i.itemKey) === 'open');
  const startAt = request.stepId
    ? open.findIndex(
        (i) =>
          i.step.id === request.stepId &&
          (request.connectionId === undefined || i.connectionId === request.connectionId)
      )
    : 0;
  // An unknown or already finished step falls back to the whole open list.
  const from = startAt < 0 ? 0 : startAt;
  return open.slice(from).map((i) => ({
    stepId: i.step.id,
    connectionId: i.connectionId,
    importance: i.importance,
  }));
}
