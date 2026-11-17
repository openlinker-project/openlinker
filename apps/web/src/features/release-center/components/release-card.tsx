/**
 * Release card (#4148)
 *
 * One release notification: version badge, a segmented progress bar (one
 * segment per step, optional ones hatched), a collapsible step list, and the
 * call to action. The steps are collapsed by default; the toggle is a labelled
 * chevron with a 44px target. A release without steps offers the changelog only.
 *
 * @module features/release-center/components
 */
import { useId, useState, type ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../shared/ui/dropdown-menu';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { useReleaseActions } from '../hooks/use-release-actions';
import { useReleaseCenterAccess } from '../hooks/use-release-center-access';
import { requestReleaseTour, requestWhatsNew } from '../lib/release-center-requests';
import {
  notificationStatusOf,
  stepStatusOf,
  type ReleaseNotification,
  type StepInstance,
} from '../lib/release-notifications';
import { useReleaseCenterView } from './release-center-provider';
import { ReleaseIcon } from './release-icon';
import { ReleaseStepList } from './release-step-list';

export function ReleaseCard({
  notification,
  instances,
  onNavigate,
}: {
  notification: ReleaseNotification;
  instances: readonly StepInstance[];
  /** Closes the panel when the card hands the viewer to another surface. */
  onNavigate: () => void;
}): ReactElement | null {
  const view = useReleaseCenterView();
  const copy = useMessages('release-center').panel;
  const actions = useReleaseActions();
  const { canWriteSteps } = useReleaseCenterAccess();
  const [open, setOpen] = useState(false);
  const regionId = useId();
  if (!view) return null;

  const mine = instances.filter((instance) => notification.stepKeys.includes(instance.itemKey));
  const statuses = mine.map((instance) => stepStatusOf(view.state, instance.itemKey, view.now));
  const done = statuses.filter(
    (entry) => entry.status === 'done' || entry.status === 'not_applicable'
  ).length;
  const open_ = mine.filter((_, index) => statuses[index].status === 'open');
  const requiredLeft = open_.filter((instance) => instance.importance === 'required').length;
  const { status, unread } = notificationStatusOf(view.state, notification.itemKey);
  const archived = status === 'archived';
  const hasSteps = mine.length > 0;
  const left = mine.length - done;

  const cta = !canWriteSteps
    ? copy.ctaShowWhere
    : done === 0
      ? copy.ctaGuide
      : left === 0
        ? copy.ctaAgain
        : copy.ctaContinue;

  return (
    <article className="release-card" data-unread={unread && !archived} data-archived={archived}>
      <div className="release-card__top">
        <div>
          <p className="release-card__title">
            {interpolate(copy.releaseTitle, { version: notification.version })}
          </p>
          <div className="release-card__meta">
            <StatusBadge compact withDot tone="info">
              {interpolate(copy.versionBadge, { version: notification.version })}
            </StatusBadge>
            {archived ? <span>{copy.archivedLabel}</span> : null}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              tone="ghost"
              className="button--icon button--sm"
              aria-label={copy.itemActions}
            >
              <ReleaseIcon name="dots" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hasSteps && !archived && canWriteSteps && left > 0 ? (
              <DropdownMenuItem onSelect={() => actions.markAllDone(open_)}>
                {copy.menuMarkAllDone}
              </DropdownMenuItem>
            ) : null}
            {unread && !archived ? (
              <DropdownMenuItem onSelect={() => actions.markRead([notification.itemKey])}>
                {copy.menuMarkRead}
              </DropdownMenuItem>
            ) : null}
            {archived ? (
              <DropdownMenuItem onSelect={() => actions.restore(notification.itemKey)}>
                {copy.menuRestore}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => actions.archive(notification.itemKey)}>
                {copy.menuArchive}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.remove(notification.itemKey)}>
              {copy.menuDelete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {hasSteps && !archived ? (
        <>
          <div className="release-progress">
            <div className="release-progress__bar" role="img" aria-label={copy.progressLabel}>
              {mine.map((instance, index) => (
                <span
                  key={instance.itemKey}
                  className="release-progress__seg"
                  data-done={
                    statuses[index].status === 'done' || statuses[index].status === 'not_applicable'
                  }
                  data-optional={instance.importance === 'optional'}
                />
              ))}
            </div>
            <div className="release-progress__text">
              <span>{interpolate(copy.doneOf, { done, total: mine.length })}</span>
              <span>
                {!canWriteSteps
                  ? copy.adminCompletes
                  : requiredLeft > 0
                    ? interpolate(copy.requiredLeft, { n: requiredLeft })
                    : copy.requiredDone}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="release-card__toggle"
            aria-expanded={open}
            aria-controls={regionId}
            onClick={() => setOpen((value) => !value)}
          >
            <span>{open ? copy.stepsHide : interpolate(copy.stepsShow, { n: mine.length })}</span>
            <span className="release-card__chevron" aria-hidden="true" data-open={open}>
              <ReleaseIcon name="chevron" />
            </span>
          </button>
          <div id={regionId} className="release-card__collapse" data-open={open}>
            <div>
              {open ? <ReleaseStepList instances={mine} /> : null}
            </div>
          </div>
          <div className="release-card__actions">
            <Button
              className="button--sm"
              onClick={() => {
                requestReleaseTour({});
                onNavigate();
              }}
            >
              {cta} <ReleaseIcon name="arrow-right" size={14} />
            </Button>
            <Button
              className="button--sm"
              tone="secondary"
              onClick={() => {
                requestWhatsNew({ minor: notification.minor });
                onNavigate();
              }}
            >
              {copy.ctaWhatsNew}
            </Button>
          </div>
        </>
      ) : null}
      {!hasSteps || archived ? (
        <div className="release-card__actions">
          <Button
            className="button--sm"
            tone="secondary"
            onClick={() => {
              requestWhatsNew({ minor: notification.minor });
              onNavigate();
            }}
          >
            {copy.ctaChangelog}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
