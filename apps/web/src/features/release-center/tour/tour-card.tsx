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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type Dispatch, type ReactElement } from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useIsAdmin } from '../../../shared/auth/use-permission';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { connectionsQueryKeys, useConnectionQuery } from '../../connections';
import { RELEASE_STEPS } from '../catalog/release-steps';
import { useReleaseStateQuery } from '../hooks/use-release-state-query';
import { useReleaseStepsMutation } from '../hooks/use-release-steps-mutation';
import { installationStatusOf, releaseStepItemKey } from '../lib/release-state-merge';
import { applyChoice, readChoice, TOUR_CHOICES } from './tour-choices';
import type { TourAction, TourState } from './tour-reducer';
import { useTourTarget } from './use-tour-target';

interface TourCardProps {
  state: TourState;
  dispatch: Dispatch<TourAction>;
  onClose: () => void;
}

const RING_PADDING = 4;
const CARD_GAP = 12;
const CARD_WIDTH = 340;
const MOBILE_QUERY = '(max-width: 767px)';

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isMobile(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
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
  const target = useTourTarget(entry?.target ?? null, state.active);

  useEffect(() => {
    if (target.state === 'found') dispatch({ type: 'target', state: 'found' });
    else if (target.state === 'missing') dispatch({ type: 'target', state: 'missing' });
  }, [target.state, dispatch]);

  useEffect(() => {
    setSavedChoice(null);
    setSaveFailed(false);
    cardRef.current?.focus();
  }, [state.index]);

  const element = target.state === 'found' ? target.element : null;

  useEffect(() => {
    const card = cardRef.current;
    const ring = ringRef.current;
    if (!element || !card || !ring) return undefined;
    element.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    let frame = 0;
    const place = (): void => {
      const rect = element.getBoundingClientRect();
      ring.style.width = `${rect.width + RING_PADDING * 2}px`;
      ring.style.height = `${rect.height + RING_PADDING * 2}px`;
      ring.style.transform = `translate(${rect.left - RING_PADDING}px, ${rect.top - RING_PADDING}px)`;
      if (isMobile()) {
        card.style.transform = '';
        return;
      }
      const cardHeight = card.offsetHeight;
      const below = rect.bottom + CARD_GAP;
      const fitsBelow = below + cardHeight <= window.innerHeight;
      const top = fitsBelow ? below : Math.max(CARD_GAP, rect.top - CARD_GAP - cardHeight);
      const left = Math.min(Math.max(CARD_GAP, rect.left), window.innerWidth - CARD_WIDTH - CARD_GAP);
      card.style.transform = `translate(${left}px, ${top}px)`;
    };
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      resizeObserver?.disconnect();
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

  const className = ['tour-card', isMobile() ? 'tour-card--docked' : ''].filter(Boolean).join(' ');

  return (
    <>
      <div ref={ringRef} className="tour-ring" aria-hidden="true" hidden={!element} />
      <section ref={cardRef} className={className} role="region" aria-label={tour.regionLabel} tabIndex={-1}>
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
        <p className="tour-card__eyebrow">
          {interpolate(tour.stepOf, { current: state.index + 1, total })}
          {' · '}
          {step.importance === 'required' ? tour.required : tour.optional}
          {!isAdmin ? <span className="tour-card__chip">{tour.adminOnly}</span> : null}
        </p>
        <h2 className="tour-card__title">{stepCopy.tourTitle}</h2>
        <p className="tour-card__body">{stepCopy.tourBody}</p>
        {!isAdmin ? <p className="tour-card__hint">{tour.viewerHint}</p> : null}
        {isAdmin && spec ? (
          <div className="tour-card__choices" role="group" aria-label={stepCopy.tourTitle}>
            {spec.choices.map((choice) => (
              <Button
                key={choice.id}
                tone="secondary"
                aria-pressed={shownChoice === choice.id}
                disabled={choose.isPending || connection.data === undefined}
                onClick={() => choose.mutate(choice.id)}
              >
                {choiceLabels[choice.id]}
              </Button>
            ))}
          </div>
        ) : null}
        <p className="tour-card__status" role="status" aria-live="polite">
          {status}
        </p>
        <div className="tour-card__footer">
          <Button tone="ghost" onClick={onClose}>
            {tour.later}
          </Button>
          <span className="tour-card__spacer" />
          {state.index > 0 ? (
            <Button tone="secondary" onClick={() => dispatch({ type: 'back' })}>
              {tour.back}
            </Button>
          ) : null}
          <Button
            tone="primary"
            aria-disabled={blocked || undefined}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={handleNext}
          >
            {isLast ? tour.finish : tour.next}
          </Button>
        </div>
        {blocked ? (
          <p id={reasonId} className="tour-card__reason">
            {tour.requiredReason}
          </p>
        ) : null}
      </section>
    </>
  );
}
