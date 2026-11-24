/**
 * TourCard (#4149)
 *
 * The non-modal card and the highlight ring. Focus moves to the card on every
 * step; the ring is decorative (`aria-hidden`, `pointer-events: none`) and is
 * positioned with transform only. A required step disables "Next" through
 * `aria-disabled` so the button stays focusable and explains itself.
 *
 * @module features/release-center/tour
 */
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
} from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { animate } from 'motion/react';
import { useToast } from '../../../shared/ui/toast-provider';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../shared/ui/tooltip';
import { ProgressSegment } from '../components/progress-segment';
import { ReleaseIcon } from '../components/release-icon';
import { connectionsQueryKeys, useConnectionQuery } from '../../connections';
import { RELEASE_STEPS } from '../catalog/release-steps';
import { useReleaseItemStatesMutation } from '../hooks/use-release-item-states-mutation';
import { showcaseSeenOf } from '../lib/release-notifications';
import { useReleaseStateQuery } from '../hooks/use-release-state-query';
import { useReleaseStepsMutation } from '../hooks/use-release-steps-mutation';
import { installationStatusOf, releaseStepItemKey } from '../lib/release-state-merge';
import { applyChoice, readChoice, TOUR_CHOICES } from './tour-choices';
import type { TourStepInput } from './tour-context';
import type { TourAction, TourState } from './tour-reducer';
import { bottomReserve, chooseDock, RING_PADDING, ringBoxInDocument, type TourDock } from './tour-geometry';
import { resolveTourStop, tourItemKey, tourItemMinor } from './tour-stop';
import { useTourTarget } from './use-tour-target';

function readTopInset(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--shell-topbar-height');
  const bar = Number.parseFloat(raw);
  return (Number.isFinite(bar) ? bar : 56) + 12 + RING_PADDING;
}

interface TourCardProps {
  state: TourState;
  dispatch: Dispatch<TourAction>;
  /** The walk ended normally (last step done); closes without asking. */
  onClose: () => void;
  /** The operator asked to leave early (the close button); the provider confirms first. */
  onDismiss: () => void;
  /** Tells the provider a confirmation is open, so Esc answers that dialog instead of the tour. */
  onModalChange: (open: boolean) => void;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function useOptionalToast(): ReturnType<typeof useToast> | null {
  try {
    return useToast();
  } catch {
    return null;
  }
}

/** Glides the card's `translate` from an offset back to rest; the CSS entrance animation owns `transform`. */
function settleCard(card: HTMLElement, from: number): void {
  if (from === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    card.style.translate = '';
    return;
  }
  void animate(from, 0, {
    type: 'spring',
    bounce: 0.12,
    visualDuration: 0.32,
    onUpdate: (value) => {
      card.style.translate = `0 ${value}px`;
    },
    onComplete: () => {
      card.style.translate = '';
    },
  });
}

export function TourCard({ state, dispatch, onClose, onDismiss, onModalChange }: TourCardProps): ReactElement | null {
  const copy = useMessages('release-center');
  const tour = copy.tour;
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  // CONFIG mode (may change settings) or VIEW mode (only shown where things changed).
  const canConfig = useReleaseCenterAccess().canWriteSteps;
  const steps = useReleaseStepsMutation();
  const releaseState = useReleaseStateQuery();
  const step = state.steps[state.index];
  const entry = step ? RELEASE_STEPS.find((candidate) => candidate.id === step.stepId) : undefined;
  const stop = step ? resolveTourStop(step) : null;
  const showcase = step?.showcase ?? null;
  const userItems = useReleaseItemStatesMutation();
  const seenSent = useRef<Set<string>>(new Set());
  // One rail segment per item: all stops of a showcase share one.
  const groups = useMemo(() => {
    const out: { key: string; first: number; step: TourStepInput; minor: string | null }[] = [];
    state.steps.forEach((entryStep, index) => {
      const key = tourItemKey(entryStep);
      if (!out.some((group) => group.key === key)) {
        out.push({ key, first: index, step: entryStep, minor: tourItemMinor(entryStep) });
      }
    });
    return out;
  }, [state.steps]);
  const connection = useConnectionQuery(step?.connectionId ?? '', { enabled: Boolean(step?.connectionId) });
  const [savedChoice, setSavedChoice] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  useEffect(() => {
    onModalChange(confirmSkip);
    return () => onModalChange(false);
  }, [confirmSkip, onModalChange]);

  const cardRef = useRef<HTMLElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  // Which side of the screen the highlighted element has scrolled off, so the operator can be pointed back.
  const [offscreen, setOffscreen] = useState<'above' | 'below' | null>(null);
  const reasonId = useId();
  const toast = useOptionalToast();
  const location = useLocation();
  // On a phone the card can fold down to the steps alone, so what it points at stays in view.
  const [collapsed, setCollapsed] = useState(false);
  // A swipe on the handle folds (down) or unfolds (up) the card; a plain tap on it toggles too.
  const dragStart = useRef<{ y: number; moved: boolean; height: number; offset: number } | null>(null);
  // Height and drag offset from before the fold, so the card can glide from where the finger left it.
  const flip = useRef<{ height: number; offset: number } | null>(null);
  useLayoutEffect(() => {
    const pending = flip.current;
    const card = cardRef.current;
    flip.current = null;
    if (!pending || !card) return;
    // The card is docked to the bottom, so its top edge moved by the height change: start from where it was.
    settleCard(card, pending.offset - (pending.height - card.offsetHeight));
  }, [collapsed]);
  // On the page a step's link leads to, the tour points there instead of at the step's own element.
  const onFollowPage = Boolean(
    stop?.follow &&
      (stop.follow.prefix
        ? location.pathname.startsWith(`${stop.follow.path}/`)
        : location.pathname === stop.follow.path)
  );
  // Which of the follow-up page's stops is shown; starts over with every step and when the page is left.
  const [followIndex, setFollowIndex] = useState(0);
  useEffect(() => setFollowIndex(0), [state.index, onFollowPage]);
  const followTargets = stop?.follow?.targets ?? [];
  const followLast = followIndex >= followTargets.length - 1;
  const target = useTourTarget(
    onFollowPage ? (followTargets[followIndex] ?? null) : (stop?.target ?? null),
    state.active,
    state.index * 100 + (onFollowPage ? followIndex + 1 : 0)
  );

  // The step whose target was on screen at some point: if a resize later swaps the layout (desktop table to phone cards)
  // the target goes missing, but that is not a reason to pass the step on the operator's behalf.
  const foundAtStep = useRef<number | null>(null);
  useEffect(() => {
    if (target.state === 'found') {
      foundAtStep.current = state.index;
      dispatch({ type: 'target', state: 'found' });
    }
    else if (target.state === 'missing') {
      dispatch({ type: 'target', state: 'missing' });
      if (showcase) {
        // eslint-disable-next-line no-console -- developer diagnostics for a catalog target that is not on screen
        console.warn(`[release-center] tour target "${stop?.target}" not found for showcase "${step?.stepId}" stop ${showcase.stopIndex}`);
      }
    }
  // The step index is a dependency: a next step on the same page keeps `found`, while the reducer resets to `waiting`.
  }, [target.state, state.index, dispatch]);

  useEffect(() => {
    setSavedChoice(null);
    setSaveFailed(false);
    cardRef.current?.focus();
  }, [state.index]);

  // A showcase counts as seen once its last stop is shown (found or not) or it is skipped; closing early does not count.
  const markSeen = (itemKey: string): void => {
    if (seenSent.current.has(itemKey)) return;
    seenSent.current.add(itemKey);
    userItems.mutate([{ itemKey, status: 'archived' }]);
  };
  useEffect(() => {
    if (!state.active) {
      seenSent.current = new Set();
      return;
    }
    if (showcase && showcase.stopIndex === showcase.stopCount - 1) markSeen(showcase.itemKey);
    // Reaching a stop is the only trigger; the mutation object changes every render.
  }, [state.index, state.active]);

  // A guide stop whose target takes no room on this screen (a control that hides itself on a phone) is passed.
  useEffect(() => {
    if (!showcase || state.target !== 'missing') return undefined;
    if (foundAtStep.current === state.index) return undefined;
    const timer = window.setTimeout(() => {
      if (state.index === state.steps.length - 1) onClose();
      else dispatch({ type: 'next' });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [state.target, state.index]);

  // A node the router already removed is as good as missing; measuring it parks the ring at the origin.
  const element = target.state === 'found' && target.element.isConnected ? target.element : null;

  useEffect(() => {
    const ring = ringRef.current;
    if (!element || !ring) return undefined;
    const card = cardRef.current;
    if (!card) return undefined;
    document.documentElement.classList.add('tour-active');
    let frame = 0;
    let dockFrame = 0;
    let scrolled = false;
    let dock: TourDock = 'bottom';

    const applyDock = (): void => {
      const rect = element.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const topInset = readTopInset();
      dock = chooseDock({
        target: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        card: { width: cardRect.width, height: cardRect.height },
        topInset,
        current: dock,
      });
      // The card swaps between the bottom edge and the top corner by changing top/bottom, which cannot be
      // tweened, so the move is replayed as a glide from the old centre (FLIP). A first placement never glides.
      const previousDock = card.dataset.dock;
      const before = previousDock && previousDock !== dock ? card.getBoundingClientRect() : null;
      card.dataset.dock = dock;
      card.style.setProperty('--tour-card-top', `${Math.round(topInset)}px`);
      if (before && !prefersReducedMotion() && typeof card.animate === 'function') {
        const after = card.getBoundingClientRect();
        const dx = before.left + before.width / 2 - (after.left + after.width / 2);
        const dy = before.top + before.height / 2 - (after.top + after.height / 2);
        if (Math.abs(dx) + Math.abs(dy) > 2) {
          card.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
            { duration: 380, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
          );
        }
      }
    };

    // The ring lives in document coordinates, so scrolling moves it natively and
    // it is measured only when the layout changes, never per scroll event.
    const place = (): void => {
      const rect = element.getBoundingClientRect();
      const box = ringBoxInDocument(
        { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        { x: 0, y: 0 }
      );
      // A target in the topbar (the bell) needs the ring above that bar, which otherwise dims itself.
      const inChrome = Boolean(element.closest('.shell-topbar'));
      ring.dataset.chrome = inChrome ? 'true' : 'false';
      document.documentElement.classList.toggle('tour-chrome-target', inChrome);
      ring.style.width = `${box.width}px`;
      ring.style.height = `${box.height}px`;
      ring.style.top = `${box.top}px`;
      ring.style.left = `${box.left}px`;
      document.documentElement.style.setProperty(
        '--tour-card-space',
        `${bottomReserve(card.getBoundingClientRect().height)}px`
      );
      applyDock();
      if (ring.style.visibility !== 'visible') {
        ring.style.visibility = 'visible';
        // The first placement must not tween in from wherever the previous step left the ring.
        requestAnimationFrame(() => {
          ring.style.transition = '';
        });
      }
      if (!scrolled) {
        scrolled = true;
        if (inChrome) return;
        // Once: put the target's top just under the bar. The user's own scrolling is never undone.
        const delta = rect.top - readTopInset();
        if (Math.abs(delta) > 2) {
          window.scrollBy({ top: delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        }
      }
    };
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    // Only the card's side depends on what is on screen; it is cheap and the ring is untouched.
    const scheduleDock = (): void => {
      cancelAnimationFrame(dockFrame);
      dockFrame = requestAnimationFrame(applyDock);
    };
    // Hidden and un-tweened until the first measurement so the ring never flashes at the origin or a stale rect.
    ring.style.visibility = 'hidden';
    ring.style.transition = 'none';
    place();
    // The ring is fixed to the viewport, so it follows what it lights even when that is sticky or inside a
    // scroller of its own. While the page moves it must not tween (it would trail behind), so the
    // transition is off for the duration of the scroll and comes back once it settles.
    let settle = 0;
    const onScroll = (): void => {
      ring.style.transition = 'none';
      schedule();
      scheduleDock();
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        ring.style.transition = '';
      }, 140);
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    // Belt and braces: whatever moves the target (a sticky header settling, a scroller of its own, a font or
    // image arriving) shows up in its rect, so the ring follows the rect itself, one cheap read per frame.
    let followFrame = 0;
    let lastBox = '';
    const follow = (): void => {
      const rect = element.getBoundingClientRect();
      const side = element.closest('.shell-topbar') ? null : rect.bottom < 56 ? 'above' : rect.top > window.innerHeight - 8 ? 'below' : null;
      setOffscreen((previous) => (previous === side ? previous : side));
      const box = `${rect.top}|${rect.left}|${rect.width}|${rect.height}`;
      if (box !== lastBox) {
        if (lastBox !== '') onScroll();
        lastBox = box;
      }
      followFrame = requestAnimationFrame(follow);
    };
    followFrame = requestAnimationFrame(follow);
    window.addEventListener('resize', schedule);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(element);
    resizeObserver?.observe(card);
    // Content loading above the target shifts it without resizing it.
    resizeObserver?.observe(document.body);
    // A section expanding or an image or font arriving can move the target without resizing anything observed.
    const mutationObserver = new MutationObserver((records) => {
      // The ring and the card write their own styles; reacting to those would loop.
      if (records.every((record) => ring.contains(record.target) || card.contains(record.target))) return;
      schedule();
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener('load', schedule, true);
    void document.fonts?.ready.then(schedule);
    return () => {
      document.documentElement.classList.remove('tour-active');
      document.documentElement.classList.remove('tour-chrome-target');
      document.documentElement.style.removeProperty('--tour-card-space');
      cancelAnimationFrame(frame);
      cancelAnimationFrame(dockFrame);
      cancelAnimationFrame(followFrame);
      setOffscreen(null);
      window.clearTimeout(settle);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', schedule);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('load', schedule, true);
    };
  }, [element]);

  const spec = step ? TOUR_CHOICES[step.stepId] : undefined;
  const config = (connection.data?.config ?? {}) as Record<string, unknown>;
  const pressed = spec ? readChoice(spec, config) : null;

  // Only a change of the saved config clears the "Saved" note: right after our own save the config is still the old one.
  const lastPressed = useRef(pressed);
  useEffect(() => {
    if (lastPressed.current !== pressed) {
      lastPressed.current = pressed;
      setSavedChoice((current) => (current && pressed && pressed !== current ? null : current));
    }
  }, [pressed]);

  const choose = useMutation({
    mutationKey: ['release-center', 'tour-choice'],
    mutationFn: async (choiceId: string) => {
      if (!spec || !step?.connectionId) throw new Error('no choice');
      const next = applyChoice(spec, config, choiceId);
      if (!next) throw new Error('unknown choice');
      await apiClient.connections.update(step.connectionId, { config: next });
      return choiceId;
    },
    onSuccess: async (choiceId) => {
      setSaveFailed(false);
      setSavedChoice(choiceId);
      // The decision is recorded first: waiting for the connections to refetch must not delay or lose it.
      if (step && entry) {
        steps.mutate(
          [{ itemKey: releaseStepItemKey(step.stepId, step.connectionId), status: 'done', doneVia: 'manual' }],
          { onError: () => setSaveFailed(true) }
        );
      }
      // Not awaited: the refetch of every connection query can take seconds, and the choice buttons stay locked while it runs.
      void queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all });
    },
    onError: () => setSaveFailed(true),
  });

  if (!step || (!entry && !showcase)) return null;

  const showcaseCopy = showcase
    ? (copy.showcases as unknown as Record<string, { stops: Record<string, { title: string; body: string }> } | undefined>)[step.stepId]
    : undefined;
  const stopCopy = showcase ? showcaseCopy?.stops[showcase.stopIndex] : undefined;
  const stepCopy = showcase
    ? { tourTitle: stopCopy?.title ?? step.stepId, tourBody: stopCopy?.body ?? '', follow0: (stopCopy as { followBody?: string } | undefined)?.followBody }
    : copy.steps[step.stepId as keyof typeof copy.steps];
  const itemKey = releaseStepItemKey(step.stepId, step.connectionId);
  const done = installationStatusOf(releaseState.data, itemKey) === 'done';
  const total = groups.length;
  // Several releases in one walk: the progress shows them as separate clusters and the count is per release.
  const clusters = useMemo(() => {
    const out: { minor: string | null; items: { group: (typeof groups)[number]; position: number }[] }[] = [];
    groups.forEach((group, position) => {
      const last = out[out.length - 1];
      if (last && last.minor === group.minor) last.items.push({ group, position });
      else out.push({ minor: group.minor, items: [{ group, position }] });
    });
    return out;
  }, [groups]);
  const releases = new Set(groups.map((group) => group.minor));
  const multiRelease = releases.size > 1;
  const currentMinor = groups.find((group) => group.key === tourItemKey(step))?.minor ?? null;
  const inRelease = groups.filter((group) => group.minor === currentMinor);
  const positionInRelease = inRelease.findIndex((group) => group.key === tourItemKey(step));
  const groupIndex = groups.findIndex((group) => group.key === tourItemKey(step));
  const isLast = state.index === state.steps.length - 1;
  const stepPath = resolveTourStop(step)?.path ?? null;
  const blocked = !showcase && canConfig && step.importance === 'required' && !done;
  const choiceLabels = tour.choices as Record<string, string>;
  // The page's own checkbox changes the form before anything is saved: the card follows it so the two never disagree.
  const [pageChoice, setPageChoice] = useState<string | null>(null);
  useEffect(() => {
    setPageChoice(null);
  }, [state.index, pressed]);
  useEffect(() => {
    if (!spec || !element) return undefined;
    const onChange = (event: Event): void => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox' || !element.contains(input)) return;
      setPageChoice(spec.choices.find((choice) => choice.value === input.checked)?.id ?? null);
    };
    document.addEventListener('change', onChange, true);
    return () => document.removeEventListener('change', onChange, true);
  }, [spec, element]);
  // Our own save wins until the config catches up: right after it `pressed` still reads the old value.
  const shownChoice = pageChoice ?? savedChoice ?? pressed;
  // While the target is still being looked for, every control waits: acting now would run against a step nobody has seen.
  const searching = state.target === 'waiting';

  let status = '';
  // A showcase stop with no target is a developer problem, so the operator reads nothing about it.
  if (state.target === 'missing' && !showcase) {
    // Away from the step's own page is a place to be, not a failure: say where the step lives.
    status = stepPath && stepPath !== location.pathname ? tour.away : tour.missing;
  }
  else if (saveFailed) status = tour.saveFailed;
  else if (pageChoice && pageChoice !== pressed) status = tour.unsaved;
  else if (savedChoice) status = interpolate(tour.saved, { choice: choiceLabels[savedChoice] ?? savedChoice });

  const handleNext = (): void => {
    if (blocked) return;
    // Walking past an optional step you could see counts as having looked at it, like "stays as it is".
    if (!showcase && canConfig && step.importance === 'optional' && !done && state.target === 'found') {
      steps.mutate([{ itemKey, status: 'done', doneVia: 'manual' }]);
    }
    if (isLast) {
      toast?.showToast({ tone: 'success', title: tour.doneToastTitle, description: tour.doneToastBody });
      onClose();
    } else dispatch({ type: 'next' });
  };

  // "Stays as it is" is a decision too: it records the step as handled, so it also unblocks a required step.
  // Skipping a showcase counts as seen and leaves the whole item at once.
  const handleSkipShowcase = (): void => {
    if (!showcase) return;
    setConfirmSkip(false);
    markSeen(showcase.itemKey);
    dispatch({ type: 'skipItem' });
  };

  // A missing optional step is handled too: the operator was told and moved on, and it must not stay open for ever.
  const handleSkipMissing = (): void => {
    if (canConfig && step.importance === 'optional' && !done) {
      steps.mutate([{ itemKey, status: 'done', doneVia: 'manual' }]);
    }
    if (isLast) onClose();
    else dispatch({ type: 'skip' });
  };

  const handleStaysAsIs = (): void => {
    steps.mutate([{ itemKey, status: 'done', doneVia: 'manual' }]);
    if (isLast) onClose();
    else dispatch({ type: 'next' });
  };

  return (
    <>
      {createPortal(
        <div ref={ringRef} className="tour-ring" aria-hidden="true" hidden={!element} />,
        document.body
      )}
      {element && offscreen
        ? createPortal(
            <button
              type="button"
              className="tour-pointer"
              data-side={offscreen}
              onClick={() =>
                element.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
              }
            >
              <ReleaseIcon name="chevron" size={14} />
              {tour.backToTarget}
            </button>,
            document.body
          )
        : null}
      <section
        ref={cardRef}
        className="tour-card"
        data-collapsed={collapsed}
        data-parity={state.index % 2}
        role="region"
        aria-label={tour.regionLabel}
        tabIndex={-1}
      >
        <div
          className="tour-card__handle"
          role="presentation"
          onPointerDown={(event) => {
            const card = cardRef.current;
            if (!card) return;
            dragStart.current = { y: event.clientY, moved: false, height: card.offsetHeight, offset: 0 };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = dragStart.current;
            const card = cardRef.current;
            if (!start || !card) return;
            const dy = event.clientY - start.y;
            if (Math.abs(dy) > 6) start.moved = true;
            // The card follows the finger inside the range it can fold or unfold through, with a little give past it.
            const range = Math.max(80, start.height * 0.45);
            const raw = collapsed ? Math.min(0, Math.max(dy, -range * 1.1)) : Math.max(0, Math.min(dy, range * 1.1));
            start.offset = raw;
            card.style.translate = `0 ${raw}px`;
          }}
          onPointerUp={() => {
            const start = dragStart.current;
            dragStart.current = null;
            const card = cardRef.current;
            if (!start || !card) return;
            const crossed = collapsed ? start.offset < -40 : start.offset > 40;
            if (crossed || !start.moved) {
              flip.current = { height: start.height, offset: start.offset };
              setCollapsed((value) => !value);
            } else {
              settleCard(card, start.offset);
            }
          }}
          onPointerCancel={() => {
            const start = dragStart.current;
            dragStart.current = null;
            if (start && cardRef.current) settleCard(cardRef.current, start.offset);
          }}
        >
          <span className="tour-card__grip" aria-hidden="true" />
        </div>
        <div className="tour-card__rail" role="group" aria-label={tour.railLabel}>
          {clusters.map((cluster) => (
            <div
              key={cluster.minor ?? 'none'}
              className="tour-card__release"
              style={{ flex: cluster.items.length }}
              data-active={cluster.minor === currentMinor ? 'true' : undefined}
              data-labelled={multiRelease ? 'true' : undefined}
            >
              {multiRelease ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="tour-card__release-label" tabIndex={0}>
                      {cluster.minor ?? tour.noRelease}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    className="tour-card__tip"
                    side="top"
                    align="start"
                    collisionPadding={8}
                    avoidCollisions
                  >
                    <strong>
                      {cluster.minor
                        ? interpolate(tour.releaseName, { version: cluster.minor })
                        : tour.noReleaseFull}
                    </strong>
                    <span>{interpolate(tour.releaseSteps, { n: cluster.items.length })}</span>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <ol className="tour-card__segs">
          {cluster.items.map(({ group, position }) => {
            const other = group.step;
            const isShowcaseGroup = Boolean(other.showcase);
            const active = position === groupIndex;
            const otherDone = other.showcase
              ? showcaseSeenOf(releaseState.data ?? { enabled: true, cursor: null, user: [], installation: [] }, other.showcase.itemKey)
              : installationStatusOf(releaseState.data, releaseStepItemKey(other.stepId, other.connectionId)) ===
                'done';
            const dotState = otherDone
              ? 'done'
              : active
                ? 'current'
                : state.skipped.includes(group.first)
                  ? 'skipped'
                  : 'todo';
            const stopCount = other.showcase?.stopCount ?? 1;
            const stopTitle = isShowcaseGroup
              ? (copy.showcases as unknown as Record<string, { title: string } | undefined>)[other.stepId]?.title
              : copy.steps[other.stepId as keyof typeof copy.steps]?.tourTitle;
            return (
              <li
                key={group.key}
                className="tour-card__seg"
              >
                {isShowcaseGroup && active && stopCount > 1 ? (
                  <span className="tour-card__stops">
                    {Array.from({ length: stopCount }, (_, stopIndex) => {
                      const index = group.first + stopIndex;
                      const reached = index <= state.furthest;
                      const stopState = index === state.index ? 'current' : reached ? 'done' : 'todo';
                      return (
                        <ProgressSegment
                          key={stopIndex}
                          kind="showcase"
                          state={stopState}
                          aria-current={index === state.index ? 'step' : undefined}
                          aria-disabled={!reached || undefined}
                          aria-label={interpolate(tour.stopOf, { current: stopIndex + 1, total: stopCount })}
                          onSelect={() => {
                            if (reached) dispatch({ type: 'go', index });
                          }}
                        />
                      );
                    })}
                  </span>
                ) : (
                  <ProgressSegment
                    kind={isShowcaseGroup ? 'showcase' : other.importance}
                    state={dotState}
                    aria-current={active ? 'step' : undefined}
                    aria-label={interpolate(tour.railStep, {
                      current: position + 1,
                      total,
                      status: tour.railState[dotState],
                    })}
                    title={stopTitle}
                    onSelect={() => dispatch({ type: 'go', index: group.first })}
                  />
                )}
              </li>
            );
          })}
              </ol>
            </div>
          ))}
        </div>
        <div className="tour-card__top">
          <span>
            {multiRelease && currentMinor
              ? interpolate(tour.stepOfRelease, {
                  version: currentMinor,
                  current: positionInRelease + 1,
                  total: inRelease.length,
                })
              : interpolate(tour.stepOf, { current: groupIndex + 1, total })}
          </span>
          <span className="tour-card__top-end">
            <button
              type="button"
              className="tour-card__fold"
              aria-expanded={!collapsed}
              aria-label={collapsed ? tour.expand : tour.collapse}
              title={collapsed ? tour.expand : tour.collapse}
              onClick={() => {
                // Same glide as a swipe: remember the height before the fold so the card eases to the new one.
                const card = cardRef.current;
                if (card) flip.current = { height: card.offsetHeight, offset: 0 };
                setCollapsed((value) => !value);
              }}
            >
              <ReleaseIcon name="chevron" size={14} />
            </button>
            <button
              type="button"
              className="tour-card__close"
              aria-label={tour.close}
              title={tour.close}
              onClick={onDismiss}
            >
              <ReleaseIcon name="close" size={14} />
            </button>
          </span>
        </div>
        <div className="tour-card__text">
          <h2 className="tour-card__title">{stepCopy.tourTitle}</h2>
          {/* The badge sits under the title, as it does in the steps list: one place for it everywhere. */}
          <div className="tour-card__meta">
            {showcase ? (
              <span className="release-chip release-chip--muted">{tour.showcaseChip}</span>
            ) : (
              <span
                className={`release-chip${canConfig && step.importance === 'required' ? ' release-chip--accent' : ' release-chip--muted'}`}
              >
                {!canConfig ? tour.viewOnly : step.importance === 'required' ? tour.required : tour.optional}
              </span>
            )}
          </div>
          <p className="tour-card__body">
            {(onFollowPage ? (stepCopy as Record<string, string | undefined>)[`follow${followIndex}`] : undefined) ??
              (!canConfig && !showcase ? (stepCopy as Record<string, string | undefined>).viewBody : undefined) ??
              stepCopy.tourBody}
          </p>
        </div>
        {!showcase && canConfig && spec ? (
          <div className="tour-card__choices" role="group" aria-label={stepCopy.tourTitle} inert={searching || undefined}>
            {spec.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="tour-choice"
                aria-pressed={shownChoice === choice.id}
                disabled={choose.isPending || connection.data === undefined}
                onClick={() => choose.mutate(choice.id)}
              >
                <span className="tour-choice__dot" aria-hidden="true" />
                {choiceLabels[choice.id]}
              </button>
            ))}
          </div>
        ) : null}
        <div className="tour-card__live" role="status" aria-live="polite">
          {searching ? (
            <p className="tour-card__searching">
              <span className="tour-card__spinner" aria-hidden="true" />
              {tour.searching}
            </p>
          ) : status && shownChoice && state.target !== 'missing' && !saveFailed ? (
            <div className="tour-done">
              <ReleaseIcon name="check" size={14} />
              <span>{status}</span>
            </div>
          ) : status ? (
            <p className="tour-card__hint">{status}</p>
          ) : showcase && showcase.stopCount > 1 ? (
            <p className="sr-only">
              {interpolate(tour.stopLive, {
                current: showcase.stopIndex + 1,
                total: showcase.stopCount,
                title: stepCopy.tourTitle,
              })}
            </p>
          ) : !canConfig && !showcase ? (
            <p className="tour-card__hint">{tour.viewWhere}</p>
          ) : null}
        </div>
        {blocked && state.target !== 'missing' && !onFollowPage ? (
          <p id={reasonId} className="tour-card__reason">
            {tour.requiredReason}
          </p>
        ) : null}
        <div className="tour-card__footer" inert={searching || undefined}>
          {showcase ? (
            <Button tone="ghost" className="button--sm" onClick={() => setConfirmSkip(true)}>
              {tour.skipShowcase}
            </Button>
          ) : canConfig && !done && state.target !== 'missing' ? (
            <Button tone="ghost" className="button--sm" onClick={handleStaysAsIs}>
              {copy.panel.stayAsIs}
            </Button>
          ) : null}
          <div className="tour-card__nav">
            {state.index > 0 ? (
              <Button
                tone="secondary"
                className="button--sm tour-card__back"
                aria-label={tour.back}
                title={tour.back}
                onClick={() => dispatch({ type: 'back' })}
              >
                <ReleaseIcon name="arrow-left" size={14} />
              </Button>
            ) : null}
            {state.target === 'missing' && !showcase ? (
              <>
                {/* The element lives on the step's own page; the operator may simply have left it. */}
                {stepPath && stepPath !== location.pathname ? (
                  <Button tone="secondary" className="button--sm" onClick={() => void navigate(stepPath)}>
                    {tour.goToStep}
                  </Button>
                ) : null}
                {/* A step that cannot be shown must never trap the walk: skipping always moves on. */}
                <Button tone="primary" className="button--sm" onClick={handleSkipMissing}>
                  {tour.skip} <ReleaseIcon name="arrow-right" size={14} />
                </Button>
              </>
            ) : onFollowPage && stepPath ? (
              /* Walk the follow-up page's stops, then lead back to the step: "Next" there would only sit locked. */
              <Button
                tone="primary"
                className="button--sm"
                onClick={() => (followLast ? void navigate(stepPath) : setFollowIndex(followIndex + 1))}
              >
                {followLast ? tour.goToStep : tour.next} <ReleaseIcon name="arrow-right" size={14} />
              </Button>
            ) : (
              <Button
                tone="primary"
                className="button--sm"
                aria-disabled={blocked || undefined}
                aria-describedby={blocked ? reasonId : undefined}
                onClick={handleNext}
              >
                {isLast ? tour.finish : tour.next} <ReleaseIcon name="arrow-right" size={14} />
              </Button>
            )}
          </div>
        </div>
      </section>
      <ConfirmDialog
        open={confirmSkip}
        onOpenChange={setConfirmSkip}
        title={tour.skipConfirm.title}
        description={tour.skipConfirm.description}
        cancelLabel={tour.skipConfirm.stay}
        confirmLabel={tour.skipConfirm.confirm}
        onConfirm={handleSkipShowcase}
        initialFocus="cancel"
        className="dialog__content--elevated"
        overlayClassName="dialog__overlay--elevated"
      />
    </>
  );
}
