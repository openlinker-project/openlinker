/**
 * TourProvider (#4149)
 *
 * Owns the tour state (local `useReducer`), navigates with the router to the
 * screen of the current step, and renders the card. Nothing is persisted, so a
 * reload ends the tour by design. Esc is handled in the capture phase so it
 * closes only the tour and never the dialog or panel underneath.
 *
 * @module features/release-center/tour
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import { generatePath, useLocation, useNavigate } from 'react-router-dom';
import { RELEASE_STEPS } from '../catalog/release-steps';
import { useReleaseCenterView } from '../components/release-center-provider';
import { subscribeToTourRequests } from '../lib/release-center-requests';
import { TourCard } from './tour-card';
import { TourContext, type TourController, type TourStepInput } from './tour-context';
import { tourStepsForRequest } from './tour-request-steps';
import { INITIAL_TOUR_STATE, tourReducer } from './tour-reducer';

export function tourPathFor(step: TourStepInput): string | null {
  const entry = RELEASE_STEPS.find((candidate) => candidate.id === step.stepId);
  if (!entry) return null;
  const params = entry.routeParams({
    connection: step.connectionId
      ? { id: step.connectionId, platformType: '', capabilities: [], config: {} }
      : null,
    unassignedCarrierMethods: 0,
  });
  return generatePath(`/${entry.routePattern}`, params);
}

export function TourProvider({ children }: PropsWithChildren): ReactElement {
  const [state, dispatch] = useReducer(tourReducer, INITIAL_TOUR_STATE);
  const navigate = useNavigate();
  const location = useLocation();
  const triggerRef = useRef<HTMLElement | null>(null);

  const close = useCallback((): void => {
    dispatch({ type: 'close' });
    const trigger = triggerRef.current;
    triggerRef.current = null;
    // Focus returns after the card unmounts so it is not stolen back by it.
    if (trigger) setTimeout(() => trigger.focus(), 0);
  }, []);

  const start = useCallback((steps: readonly TourStepInput[], trigger?: HTMLElement | null): void => {
    triggerRef.current =
      trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dispatch({ type: 'start', steps });
  }, []);

  const view = useReleaseCenterView();
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(
    () =>
      subscribeToTourRequests((request) => {
        const latest = viewRef.current;
        if (!latest) return;
        start(tourStepsForRequest(latest.instances, latest.state, request));
      }),
    [start]
  );

  const current = state.active ? state.steps[state.index] : undefined;
  const path = current ? tourPathFor(current) : null;

  useEffect(() => {
    if (path && path !== location.pathname) void navigate(path);
    // Only a step change navigates; the user wandering off must not be pulled back.
  }, [path, state.index, state.active]);

  useEffect(() => {
    if (!state.active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [state.active, close]);

  const controller = useMemo<TourController>(
    () => ({ isActive: state.active, start, close }),
    [state.active, start, close]
  );

  return (
    <TourContext.Provider value={controller}>
      {children}
      {state.active ? <TourCard state={state} dispatch={dispatch} onClose={close} /> : null}
    </TourContext.Provider>
  );
}
