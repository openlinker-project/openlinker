/**
 * Guided tour state machine (#4149)
 *
 * Local to the provider and never persisted: a reload ends the tour on
 * purpose, so there is no half-resumed walk across a changed screen.
 *
 * @module features/release-center/tour
 */
import type { TourStepInput } from './tour-context';

export type TourTargetState = 'waiting' | 'found' | 'missing';

export interface TourState {
  steps: readonly TourStepInput[];
  index: number;
  active: boolean;
  target: TourTargetState;
  /** Indexes of steps the user skipped; kept for the whole run so Back and forward do not forget them. */
  skipped: readonly number[];
}

export type TourAction =
  | { type: 'start'; steps: readonly TourStepInput[]; index?: number }
  | { type: 'close' }
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'back' }
  | { type: 'target'; state: TourTargetState };

export const INITIAL_TOUR_STATE: TourState = { steps: [], index: 0, active: false, target: 'waiting', skipped: [] };

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'start':
      if (action.steps.length === 0) return state;
      return {
        steps: action.steps,
        index: Math.min(Math.max(action.index ?? 0, 0), action.steps.length - 1),
        active: true,
        target: 'waiting',
        skipped: [],
      };
    case 'close':
      return INITIAL_TOUR_STATE;
    case 'next':
      if (!state.active) return state;
      if (state.index >= state.steps.length - 1) return INITIAL_TOUR_STATE;
      return { ...state, index: state.index + 1, target: 'waiting' };
    case 'skip': {
      if (!state.active) return state;
      if (state.index >= state.steps.length - 1) return INITIAL_TOUR_STATE;
      const skipped = state.skipped.includes(state.index) ? state.skipped : [...state.skipped, state.index];
      return { ...state, skipped, index: state.index + 1, target: 'waiting' };
    }
    case 'back':
      if (!state.active || state.index === 0) return state;
      return { ...state, index: state.index - 1, target: 'waiting' };
    case 'target':
      return state.active ? { ...state, target: action.state } : state;
  }
}
