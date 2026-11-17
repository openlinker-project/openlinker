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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type Dispatch, type ReactElement } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { ReleaseIcon } from '../components/release-icon';
import { connectionsQueryKeys, useConnectionQuery } from '../../connections';
import { RELEASE_STEPS } from '../catalog/release-steps';
import { useReleaseStateQuery } from '../hooks/use-release-state-query';
import { useReleaseStepsMutation } from '../hooks/use-release-steps-mutation';
import { installationStatusOf, releaseStepItemKey } from '../lib/release-state-merge';
import { applyChoice, readChoice, TOUR_CHOICES } from './tour-choices';
import type { TourAction, TourState } from './tour-reducer';
import { bottomReserve, chooseDock, RING_PADDING, ringBoxInDocument, type TourDock } from './tour-geometry';
import { useTourTarget } from './use-tour-target';

function readTopInset(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--shell-topbar-height');
  const bar = Number.parseFloat(raw);
  return (Number.isFinite(bar) ? bar : 56) + 12 + RING_PADDING;
}

interface TourCardProps {
  state: TourState;
  dispatch: Dispatch<TourAction>;
  onClose: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function TourCard({ state, dispatch, onClose }: TourCardProps): ReactElement | null {
  const copy = useMessages('release-center');
  const tour = copy.tour;
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin();
  const steps = useReleaseStepsMutation();
  const releaseState = useReleaseStateQuery();
  const step = state.steps[state.index];
  const entry = step ? RELEASE_STEPS.find((candidate) => candidate.id === step.stepId) : undefined;
  const connection = useConnectionQuery(step?.connectionId ?? '', { enabled: Boolean(step?.connectionId) });
  const [savedChoice, setSavedChoice] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const cardRef = useRef<HTMLElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const reasonId = useId();
  const target = useTourTarget(entry?.target ?? null, state.active, state.index);

  useEffect(() => {
    if (target.state === 'found') dispatch({ type: 'target', state: 'found' });
    else if (target.state === 'missing') dispatch({ type: 'target', state: 'missing' });
  }, [target.state, dispatch]);

  useEffect(() => {
    setSavedChoice(null);
    setSaveFailed(false);
    cardRef.current?.focus();
  }, [state.index]);

  // A node the router already removed is as good as missing; measuring it parks the ring at the origin.
  const element = target.state === 'found' && target.element.isConnected ? target.element : null;

  useEffect(() => {
    const ring = ringRef.current;
    if (!element || !ring) return undefined;
    const card = cardRef.current;
    if (!card) return undefined;
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
      card.dataset.dock = dock;
      card.style.setProperty('--tour-card-top', `${Math.round(topInset)}px`);
    };

    // The ring lives in document coordinates, so scrolling moves it natively and
    // it is measured only when the layout changes, never per scroll event.
    const place = (): void => {
      const rect = element.getBoundingClientRect();
      const box = ringBoxInDocument(
        { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        { x: window.scrollX, y: window.scrollY }
      );
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
    window.addEventListener('scroll', scheduleDock, { capture: true, passive: true });
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
      document.documentElement.style.removeProperty('--tour-card-space');
      cancelAnimationFrame(frame);
      cancelAnimationFrame(dockFrame);
      window.removeEventListener('scroll', scheduleDock, true);
      window.removeEventListener('resize', schedule);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('load', schedule, true);
    };
  }, [element]);

  const spec = step ? TOUR_CHOICES[step.stepId] : undefined;
  const config = (connection.data?.config ?? {}) as Record<string, unknown>;
  const pressed = spec ? readChoice(spec, config) : null;

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
      await queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all });
      if (step && entry) {
        steps.mutate([
          { itemKey: releaseStepItemKey(step.stepId, step.connectionId), status: 'done', doneVia: 'manual' },
        ]);
      }
    },
    onError: () => setSaveFailed(true),
  });

  if (!step || !entry) return null;

  const stepCopy = copy.steps[step.stepId as keyof typeof copy.steps];
  const itemKey = releaseStepItemKey(step.stepId, step.connectionId);
  const done = installationStatusOf(releaseState.data, itemKey) === 'done';
  const total = state.steps.length;
  const isLast = state.index === total - 1;
  const blocked = isAdmin && step.importance === 'required' && !done;
  const choiceLabels = tour.choices as Record<string, string>;
  const shownChoice = savedChoice ?? pressed;

  let status = '';
  if (state.target === 'missing') status = tour.missing;
  else if (saveFailed) status = tour.saveFailed;
  else if (shownChoice) status = interpolate(tour.saved, { choice: choiceLabels[shownChoice] ?? shownChoice });

  const handleNext = (): void => {
    if (blocked) return;
    if (isLast) onClose();
    else dispatch({ type: 'next' });
  };

  return (
    <>
      {createPortal(
        <div ref={ringRef} className="tour-ring" aria-hidden="true" hidden={!element} />,
        document.body
      )}
      <section
        ref={cardRef}
        className="tour-card"
        data-parity={state.index % 2}
        role="region"
        aria-label={tour.regionLabel}
        tabIndex={-1}
      >
        <ol className="tour-card__rail" aria-hidden="true">
          {state.steps.map((other, index) => {
            const otherDone =
              installationStatusOf(releaseState.data, releaseStepItemKey(other.stepId, other.connectionId)) ===
              'done';
            const dotState = otherDone ? 'done' : index === state.index ? 'current' : 'todo';
            return (
              <li
                key={`${other.stepId}:${other.connectionId ?? ''}`}
                className={`tour-card__dot tour-card__dot--${dotState}${
                  other.importance === 'optional' ? ' tour-card__dot--optional' : ''
                }`}
              />
            );
          })}
        </ol>
        <div className="tour-card__top">
          <span>{interpolate(tour.stepOf, { current: state.index + 1, total })}</span>
          <span
            className={`release-chip${isAdmin && step.importance === 'required' ? ' release-chip--accent' : ''}`}
          >
            {!isAdmin ? tour.adminOnly : step.importance === 'required' ? tour.required : tour.optional}
          </span>
        </div>
        <div className="tour-card__text">
          <h2 className="tour-card__title">{stepCopy.tourTitle}</h2>
          <p className="tour-card__body">{stepCopy.tourBody}</p>
        </div>
        {isAdmin && spec ? (
          <div className="tour-card__choices" role="group" aria-label={stepCopy.tourTitle}>
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
          {status && shownChoice && state.target !== 'missing' && !saveFailed ? (
            <div className="tour-done">
              <ReleaseIcon name="check" size={14} />
              <span>{status}</span>
            </div>
          ) : status ? (
            <p className="tour-card__hint">{status}</p>
          ) : !isAdmin ? (
            <p className="tour-card__hint">{tour.viewerHint}</p>
          ) : null}
        </div>
        {blocked ? (
          <p id={reasonId} className="tour-card__reason">
            {tour.requiredReason}
          </p>
        ) : null}
        <div className="tour-card__footer">
          <Button tone="ghost" className="button--sm" onClick={onClose}>
            {tour.later}
          </Button>
          <div className="tour-card__nav">
            {state.index > 0 ? (
              <Button
                tone="secondary"
                className="button--sm"
                onClick={() => dispatch({ type: 'back' })}
              >
                <ReleaseIcon name="arrow-left" size={14} /> {tour.back}
              </Button>
            ) : null}
            <Button
              tone="primary"
              className="button--sm"
              aria-disabled={blocked || undefined}
              aria-describedby={blocked ? reasonId : undefined}
              onClick={handleNext}
            >
              {isLast ? tour.finish : tour.next} <ReleaseIcon name="arrow-right" size={14} />
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
