/**
 * TourProvider (#4149)
 *
 * Owns the tour state (local `useReducer`), navigates with the router to the
 * screen of the current step, and renders the card. Nothing is persisted, so a
 * reload ends the tour by design. Leaving early (Esc or the close button) asks
 * first, in the shared ConfirmDialog; finishing the last step does not. Esc is
 * handled in the capture phase so it only ever reaches the tour and never the
 * dialog or panel underneath, and it steps aside while the confirmation is open
 * so that dialog's own Esc ("stay") works.
 *
 * @module features/release-center/tour
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useContext,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import {
  UNSAFE_DataRouterContext,
  useBlocker,
  useLocation,
  useNavigate,
  type BlockerFunction,
} from 'react-router-dom';
import { ConfirmDialog } from '../../../shared/ui';
import { useMessages } from '../../../shared/i18n';
import { useReleaseCenterView } from '../components/release-center-provider';
import { subscribeToTourRequests } from '../lib/release-center-requests';
import { TourCard } from './tour-card';
import { TourContext, type TourController, type TourStepInput } from './tour-context';
import { tourStepsForRequest } from './tour-request-steps';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { resolveTourStop } from './tour-stop';
import { INITIAL_TOUR_STATE, tourReducer } from './tour-reducer';

export function tourPathFor(step: TourStepInput): string | null {
  return resolveTourStop(step)?.path ?? null;
}

/**
 * Holds in-app navigation the operator starts while a guide is running, and asks before closing the guide.
 * The tour's own page changes (one step to the next) are never held: they land on the path of one of its
 * steps. Needs a data router (`useBlocker`); the app mounts `createBrowserRouter`.
 */
function TourLeaveGuard({
  stepPaths,
  canFollow,
  onLeave,
}: {
  stepPaths: ReadonlySet<string>;
  /** The current step declares a follow-up page, so a link inside its target is a way on, not a way out. */
  canFollow: boolean;
  onLeave: () => void;
}): ReactElement {
  const pathsRef = useRef(stepPaths);
  pathsRef.current = stepPaths;
  // A link inside the highlighted area is the step telling the operator where to go, so following it is not leaving.
  const followedAt = useRef(0);
  const canFollowRef = useRef(canFollow);
  canFollowRef.current = canFollow;
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const target = event.target;
      if (canFollowRef.current && target instanceof Element && target.closest('[data-tour] a[href], a[href][data-tour]')) {
        followedAt.current = Date.now();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname &&
      !pathsRef.current.has(nextLocation.pathname) &&
      Date.now() - followedAt.current > 1500,
    []
  );
  const blocker = useBlocker(shouldBlock);
  const copy = useMessages('release-center').tour.leave;
  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset();
      }}
      title={copy.title}
      description={copy.description}
      cancelLabel={copy.stay}
      confirmLabel={copy.confirm}
      initialFocus="cancel"
      className="dialog__content--elevated"
      overlayClassName="dialog__overlay--elevated"
      onConfirm={() => {
        onLeave();
        if (blocker.state === 'blocked') blocker.proceed();
      }}
    />
  );
}

export function TourProvider({ children }: PropsWithChildren): ReactElement {
  const [state, dispatch] = useReducer(tourReducer, INITIAL_TOUR_STATE);
  const navigate = useNavigate();
  const location = useLocation();
  const triggerRef = useRef<HTMLElement | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  // `useBlocker` only works under a data router (the app's); a plain router, as in component tests, has none.
  const dataRouter = useContext(UNSAFE_DataRouterContext) !== null;
  // The card's own confirmation (skip the guide): Esc must answer that dialog, not open a second one.
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const leaveCopy = useMessages('release-center').tour.leave;

  const close = useCallback((): void => {
    setConfirmingLeave(false);
    dispatch({ type: 'close' });
    const trigger = triggerRef.current;
    triggerRef.current = null;
    // Focus returns after the card unmounts so it is not stolen back by it.
    if (trigger) setTimeout(() => trigger.focus(), 0);
  }, []);

  const requestLeave = useCallback((): void => setConfirmingLeave(true), []);

  const start = useCallback((steps: readonly TourStepInput[], trigger?: HTMLElement | null, startIndex?: number): void => {
    triggerRef.current =
      trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dispatch({ type: 'start', steps, index: startIndex });
  }, []);

  const view = useReleaseCenterView();
  const canConfigRef = useRef(false);
  canConfigRef.current = useReleaseCenterAccess().canWriteSteps;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(
    () =>
      subscribeToTourRequests((request) => {
        const latest = viewRef.current;
        if (!latest) return;
        const walk = tourStepsForRequest(latest.instances, latest.state, request, latest.showcases, canConfigRef.current);
        start(walk.steps, null, walk.startIndex);
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
      if (event.key !== 'Escape' || confirmingLeave || cardModalOpen) return;
      event.preventDefault();
      event.stopPropagation();
      requestLeave();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [state.active, confirmingLeave, cardModalOpen, requestLeave]);

  const controller = useMemo<TourController>(
    () => ({ isActive: state.active, start, close }),
    [state.active, start, close]
  );

  return (
    <TourContext.Provider value={controller}>
      {children}
      {state.active && dataRouter ? (
        <TourLeaveGuard
          stepPaths={new Set(state.steps.flatMap((step) => { const stop = resolveTourStop(step); return stop ? [stop.path, ...(stop.follow ? [stop.follow.path] : [])] : []; }))}
          canFollow={Boolean(current && resolveTourStop(current)?.follow)}
          onLeave={close}
        />
      ) : null}
      {state.active ? (
        <TourCard
          state={state}
          dispatch={dispatch}
          onClose={close} onDismiss={requestLeave}
          onModalChange={setCardModalOpen}
        />
      ) : null}
      {/* Elevated classes lift it over the tour card (z-index 61). Focus starts on
          "stay" because leaving is the one action that loses the operator's place. */}
      <ConfirmDialog
        open={state.active && confirmingLeave}
        onOpenChange={setConfirmingLeave}
        title={leaveCopy.title}
        description={leaveCopy.description}
        cancelLabel={leaveCopy.stay}
        confirmLabel={leaveCopy.confirm}
        onConfirm={close}
        initialFocus="cancel"
        className="dialog__content--elevated"
        overlayClassName="dialog__overlay--elevated"
      />
    </TourContext.Provider>
  );
}
