/**
 * Walk everything (bell panel)
 *
 * One strip above the list that answers "what is left, and can I just go
 * through it": a count, what part of it is required, and one button that starts
 * the guide over every open step and unseen showcase at once. With nothing left
 * the same strip offers the walk again from the start, so the control never
 * vanishes and the operator is never sent card by card.
 *
 * @module features/release-center
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { requestReleaseTour } from '../lib/release-center-requests';
import { showcaseSeenOf } from '../lib/release-notifications';
import { useReleaseCenterView } from './release-center-provider';
import { ReleaseIcon } from './release-icon';

export function ReleaseWalkAll({ onNavigate }: { onNavigate: () => void }): ReactElement | null {
  const view = useReleaseCenterView();
  const copy = useMessages('release-center').panel.walkAll;
  if (!view || (view.instances.length === 0 && view.showcases.length === 0)) return null;

  const unseen = view.showcases.filter((s) => !showcaseSeenOf(view.state, s.itemKey)).length;
  const left = view.summary.requiredLeft + view.summary.optionalLeft + unseen;
  const finished = left === 0;

  const start = (): void => {
    requestReleaseTour(
      finished
        ? {
            replaySteps: view.instances.map((i) => ({
              stepId: i.step.id,
              connectionId: i.connectionId,
              importance: i.importance,
            })),
            replayShowcaseIds: view.showcases.map((s) => s.showcase.id),
          }
        : {}
    );
    onNavigate();
  };

  return (
    <div className="release-walk" data-finished={finished}>
      <span className="release-walk__icon" aria-hidden="true">
        <ReleaseIcon name={finished ? 'check' : 'play'} size={14} />
      </span>
      <div className="release-walk__text">
        <strong>{finished ? copy.doneTitle : interpolate(copy.leftTitle, { count: left })}</strong>
        <span>
          {finished
            ? copy.doneBody
            : view.summary.requiredLeft > 0
              ? interpolate(copy.requiredLeft, { count: view.summary.requiredLeft })
              : copy.onlyOptional}
        </span>
      </div>
      <Button tone={finished ? 'secondary' : 'primary'} className="button--sm" onClick={start}>
        {finished ? copy.again : copy.start}
        <ReleaseIcon name="arrow-right" size={14} />
      </Button>
    </div>
  );
}
