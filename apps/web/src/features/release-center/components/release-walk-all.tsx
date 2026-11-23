/**
 * Walk everything (bell panel)
 *
 * One pinned row at the top of the list (same look as every other message) that answers "what is left, and can I just go
 * through it": a count, what part of it is required, and one action that starts
 * the guide over every open step and unseen showcase at once. With nothing left
 * the same row offers the walk again from the start, so the control never
 * vanishes and the operator is never sent card by card.
 *
 * @module features/release-center
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
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
        : { allShowcases: true }
    );
    onNavigate();
  };

  return (
    <article className={`msg msg--${finished || view.summary.requiredLeft === 0 ? 'info' : 'warning'} msg--pinned`}>
      <span className="msg__icon">
        <ReleaseIcon name={finished ? 'check' : 'play'} size={16} />
      </span>
      <div className="msg__main">
        <p className="msg__title">
          {finished ? copy.doneTitle : interpolate(copy.leftTitle, { count: left })}
        </p>
        <p className="msg__body">
          {finished
            ? copy.doneBody
            : view.summary.requiredLeft > 0
              ? interpolate(copy.requiredLeft, { count: view.summary.requiredLeft })
              : copy.onlyOptional}
        </p>
        <div className="msg__foot">
          <button type="button" className="msg__action" onClick={start}>
            {finished ? copy.again : copy.start}
          </button>
        </div>
      </div>
    </article>
  );
}
