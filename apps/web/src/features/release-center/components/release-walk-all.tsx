/**
 * Walk everything (bell panel)
 *
 * One pinned row at the top of the list (same look as every other message) that answers "what is left, and can I just go
 * through it": a count, what part of it is required, and one action that starts
 * the guide over every open step and unseen showcase at once. It shows only until the operator has started;
 * after that each card offers Continue / Go through again, so the row would only nag.
 *
 * @module features/release-center
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { requestReleaseTour } from '../lib/release-center-requests';
import { showcaseSeenOf } from '../lib/release-notifications';
import { stepViewable } from '../tour/tour-stop';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { useReleaseCenterView } from './release-center-provider';
import { ReleaseIcon } from './release-icon';

export function ReleaseWalkAll({ onNavigate }: { onNavigate: () => void }): ReactElement | null {
  const view = useReleaseCenterView();
  const copy = useMessages('release-center').panel.walkAll;
  const { canWriteSteps } = useReleaseCenterAccess();
  if (!view || (view.instances.length === 0 && view.showcases.length === 0)) return null;

  const unseen = view.showcases.filter((s) => !showcaseSeenOf(view.state, s.itemKey)).length;
  // Without the right to change settings nothing here can be completed: it is a tour of what changed, never "finished".
  const left = canWriteSteps
    ? view.summary.requiredLeft + view.summary.optionalLeft + unseen
    : view.instances.filter((i) => stepViewable(i.step.id)).length + view.showcases.length;
  const finished = canWriteSteps && left === 0;

  // Only an invitation: once anything was started (a step closed, a guide viewed) or all is done, the cards carry
  // their own "Continue" / "Go through again", so a standing row at the top would only nag.
  const stepsLeft = view.summary.requiredLeft + view.summary.optionalLeft;
  const started = unseen < view.showcases.length || (canWriteSteps && stepsLeft < view.instances.length);
  if (finished || started) return null;

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
    <article
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest('button'))) start();
      }}
      className={`msg msg--${finished || !canWriteSteps || view.summary.requiredLeft === 0 ? 'info' : 'warning'} msg--pinned msg--clickable`}>
      <span className="msg__icon">
        <ReleaseIcon name={finished ? 'check' : 'play'} size={16} />
      </span>
      <div className="msg__main">
        <p className="msg__title">
          {finished ? copy.doneTitle : interpolate(canWriteSteps ? copy.leftTitle : copy.viewTitle, { count: left })}
        </p>
        <p className="msg__body">
          {finished
            ? copy.doneBody
            : !canWriteSteps
              ? copy.viewBody
              : view.summary.requiredLeft > 0
              ? interpolate(copy.requiredLeft, { count: view.summary.requiredLeft })
              : copy.onlyOptional}
        </p>
        <div className="msg__foot">
          <button type="button" className="msg__action" onClick={start}>
            {finished ? copy.again : canWriteSteps ? copy.start : copy.viewStart}
          </button>
        </div>
      </div>
    </article>
  );
}
