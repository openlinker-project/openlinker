/**
 * Guided tour state machine (#4149)
 *
 * Local to the provider and never persisted: a reload ends the tour on
 * purpose, so there is no half-resumed walk across a changed screen.
 *
 * @module features/release-center/tour
 */
import type { TourStepInput } from './tour-context';
import { tourItemKey } from './tour-stop';

export type TourTargetState = 'waiting' | 'found' | 'missing';

export interface TourState {
  steps: readonly TourStepInput[];
  index: number;
  active: boolean;
  target: TourTargetState;
  /** Indexes of steps the user skipped; kept for the whole run so Back and forward do not forget them. */
  skipped: readonly number[];
  /** Highest index the walk has reached; stops of a showcase may be revisited up to here. */
  furthest: number;
}

export type TourAction =
  | { type: 'start'; steps: readonly TourStepInput[]; index?: number }
  | { type: 'close' }
  | { type: 'next' }
  | { type: 'skip' }
  /** Leaves the whole showcase the current stop belongs to. */
  | { type: 'skipItem' }
  | { type: 'back' }
  | { type: 'go'; index: number }
  | { type: 'target'; state: TourTargetState };

export const INITIAL_TOUR_STATE: TourState = { steps: [], index: 0, active: false, target: 'waiting', skipped: [], furthest: 0 };

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'start':
      if (action.steps.length === 0) return state;
      return {
        steps: action.steps,
        index: Math.min(Math.max(action.index ?? 0, 0), action.steps.length - 1),
        furthest: Math.min(Math.max(action.index ?? 0, 0), action.steps.length - 1),
        active: true,
        target: 'waiting',
        skipped: [],
      };
    case 'close':
      return INITIAL_TOUR_STATE;
    case 'next':
      if (!state.active) return state;
      if (state.index >= state.steps.length - 1) return INITIAL_TOUR_STATE;
      return { ...state, index: state.index + 1, furthest: Math.max(state.furthest, state.index + 1), target: 'waiting' };
    case 'skip': {
      if (!state.active) return state;
      if (state.index >= state.steps.length - 1) return INITIAL_TOUR_STATE;
      const skipped = state.skipped.includes(state.index) ? state.skipped : [...state.skipped, state.index];
      return { ...state, skipped, index: state.index + 1, furthest: Math.max(state.furthest, state.index + 1), target: 'waiting' };
    }
    case 'skipItem': {
      if (!state.active) return state;
      const key = tourItemKey(state.steps[state.index]);
      const mine = state.steps.flatMap((entry, i) => (tourItemKey(entry) === key ? [i] : []));
      const next = state.steps.findIndex((entry, i) => i > state.index && tourItemKey(entry) !== key);
      if (next < 0) return INITIAL_TOUR_STATE;
      return { ...state, skipped: [...new Set([...state.skipped, ...mine])], index: next, furthest: Math.max(state.furthest, next), target: 'waiting' };
    }
    case 'go':
      if (!state.active || action.index === state.index) return state;
      if (action.index < 0 || action.index >= state.steps.length) return state;
      return { ...state, index: action.index, furthest: Math.max(state.furthest, action.index), target: 'waiting' };
    case 'back':
      if (!state.active || state.index === 0) return state;
      return { ...state, index: state.index - 1, target: 'waiting' };
    case 'target':
      return state.active ? { ...state, target: action.state } : state;
  }
}
