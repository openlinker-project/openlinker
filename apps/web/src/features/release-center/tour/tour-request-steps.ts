/**
 * Tour steps for a request (#4150)
 *
 * Turns a "show me" request from the bell, the panel or the dialog into the
 * entries the tour walks. Setup steps come first (still-open ones), then the
 * showcases; a showcase expands into one entry per stop so the walk stays a flat
 * list and the reducer stays index based. Pure so the ordering rule is testable
 * without a router.
 *
 * @module features/release-center/tour
 */
import type { ReleaseState } from '../api/release-state.types';
import { installationStatusOf } from '../lib/release-state-merge';
import { showcaseSeenOf, type ShowcaseInstance, type StepInstance } from '../lib/release-notifications';
import type { TourRequest } from '../lib/release-center-requests';
import { compareVersions } from '../lib/compare-versions';
import type { TourStepInput } from './tour-context';
import { tourItemMinor } from './tour-stop';

export interface TourRequestWalk {
  steps: TourStepInput[];
  /** Where the walk opens; earlier steps stay in the list so the progress bar shows the whole run. */
  startIndex: number;
}

export function expandShowcase(instance: ShowcaseInstance): TourStepInput[] {
  const stopCount = instance.showcase.stops.length;
  return instance.showcase.stops.map((_, stopIndex) => ({
    stepId: instance.showcase.id,
    connectionId: null,
    importance: 'optional',
    showcase: { itemKey: instance.itemKey, stopIndex, stopCount },
  }));
}

const minorOf = (version: string): string => version.split('.').slice(0, 2).join('.');

export function tourStepsForRequest(
  instances: readonly StepInstance[],
  state: ReleaseState | undefined,
  request: TourRequest,
  showcases: readonly ShowcaseInstance[] = []
): TourRequestWalk {
  const seen = (instance: ShowcaseInstance): boolean =>
    state ? showcaseSeenOf(state, instance.itemKey) : false;

  // A replay walks exactly what the card lists, finished or not: the open list is empty by then.
  if (request.replaySteps) {
    const ids = new Set(request.replayShowcaseIds ?? []);
    const steps: TourStepInput[] = [
      ...request.replaySteps.map((r) => ({ stepId: r.stepId, connectionId: r.connectionId, importance: r.importance })),
      ...showcases.filter((s) => ids.has(s.showcase.id)).flatMap(expandShowcase),
    ];
    return { steps, startIndex: 0 };
  }
  // A showcase request never mixes in setup work: it is a replay or a "show me what is new".
  if (request.showcaseId) {
    const one = showcases.filter((s) => s.showcase.id === request.showcaseId);
    return { steps: one.flatMap(expandShowcase), startIndex: 0 };
  }
  if (request.showcaseMinor) {
    const ofMinor = showcases.filter((s) => s.showcase.introducedIn !== undefined && minorOf(s.showcase.introducedIn) === request.showcaseMinor);
    const steps = ofMinor.flatMap(expandShowcase);
    const firstUnseen = ofMinor.findIndex((s) => !seen(s));
    const startIndex =
      firstUnseen < 0
        ? 0
        : ofMinor.slice(0, firstUnseen).reduce((sum, s) => sum + s.showcase.stops.length, 0);
    return { steps, startIndex };
  }

  const open = instances.filter((i) => installationStatusOf(state, i.itemKey) === 'open');
  const setupSteps: TourStepInput[] = open.map((i) => ({
    stepId: i.step.id,
    connectionId: i.connectionId,
    importance: i.importance,
  }));
  // Only a walk that was not aimed at one step carries the unseen showcases along.
  const tail = request.stepId ? [] : showcases.filter((s) => request.allShowcases || !seen(s)).flatMap(expandShowcase);
  // One release after another, newest first like the bell; inside a release, setup before showcase.
  const steps = [...setupSteps, ...tail]
    .map((step, order) => ({ step, order, minor: tourItemMinor(step) ?? '0.0' }))
    .sort(
      (a, b) =>
        compareVersions(`${b.minor}.0`, `${a.minor}.0`) || a.order - b.order
    )
    .map((entry) => entry.step);
  const startAt = request.stepId
    ? steps.findIndex(
        (step) =>
          !step.showcase &&
          step.stepId === request.stepId &&
          (request.connectionId === undefined || step.connectionId === request.connectionId)
      )
    : 0;
  // An unknown or already finished step falls back to the whole open list.
  return { steps, startIndex: startAt < 0 ? 0 : startAt };
}
