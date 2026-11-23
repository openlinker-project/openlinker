/**
 * Where a tour entry points
 *
 * A setup step resolves from the step catalog (route params may need the
 * connection); a showcase stop resolves from its own stop list. One function so
 * the provider (which navigates) and the card (which highlights) cannot disagree.
 *
 * @module features/release-center/tour
 */
import { generatePath } from 'react-router-dom';
import { RELEASE_SHOWCASES } from '../catalog/release-showcases';
import { RELEASE_STEPS } from '../catalog/release-steps';
import type { TourStepInput } from './tour-context';

export interface TourStop {
  path: string;
  target: string;
}

export function resolveTourStop(step: TourStepInput): TourStop | null {
  if (step.showcase) {
    const showcase = RELEASE_SHOWCASES.find((candidate) => candidate.id === step.stepId);
    const stop = showcase?.stops[step.showcase.stopIndex];
    return stop ? { path: generatePath(`/${stop.routePattern}`), target: stop.target } : null;
  }
  const entry = RELEASE_STEPS.find((candidate) => candidate.id === step.stepId);
  if (!entry) return null;
  const params = entry.routeParams({
    connection: step.connectionId
      ? { id: step.connectionId, platformType: '', capabilities: [], config: {} }
      : null,
    unassignedCarrierMethods: null,
  });
  return { path: generatePath(`/${entry.routePattern}`, params), target: entry.target };
}

/** `major.minor` of the release that ships this entry, or null for an unknown id. */
export function tourItemMinor(step: TourStepInput): string | null {
  const introducedIn = step.showcase
    ? RELEASE_SHOWCASES.find((candidate) => candidate.id === step.stepId)?.introducedIn
    : RELEASE_STEPS.find((candidate) => candidate.id === step.stepId)?.introducedIn;
  const match = introducedIn ? /^(\d+)\.(\d+)\./.exec(introducedIn) : null;
  return match ? `${match[1]}.${match[2]}` : null;
}

/** Identity of the item a tour entry belongs to: all stops of one showcase share it. */
export function tourItemKey(step: TourStepInput): string {
  return `${step.stepId}:${step.connectionId ?? ''}`;
}
