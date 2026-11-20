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
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
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
  GENERAL_MINOR,
  notificationStatusOf,
  showcaseSeenOf,
  showcaseTally,
  stepStatusOf,
  type ReleaseNotification,
  type StepInstance,
} from '../lib/release-notifications';
import { useReleaseCenterView } from './release-center-provider';
import { ReleaseShowcaseList } from './release-showcase-list';
import { ReleaseIcon } from './release-icon';
import { ReleaseStepList } from './release-step-list';

export function ReleaseCard({
  notification,
  instances,
  onNavigate,
  hideChangelogLink = false,
}: {
  notification: ReleaseNotification;
  instances: readonly StepInstance[];
  /** Closes the panel when the card hands the viewer to another surface. */
  onNavigate: () => void;
  /** On the What's new page itself the changelog is already in view. */
  hideChangelogLink?: boolean;
}): ReactElement | null {
  const view = useReleaseCenterView();
  const copy = useMessages('release-center').panel;
  const actions = useReleaseActions();
  const { canWriteSteps } = useReleaseCenterAccess();
  const [open, setOpen] = useState(false);
  // The list stays mounted while it folds away, so the exit animates real content instead of an empty box.
  const [mounted, setMounted] = useState(false);
  const regionId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The step list unmounts when collapsed, so its scroll offset is kept here.
  const savedScroll = useRef(0);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const syncEdges = useCallback((): void => {
    const node = scrollRef.current;
    if (!node) return;
    const top = node.scrollTop > 1;
    const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    setEdges((previous) => (previous.top === top && previous.bottom === bottom ? previous : { top, bottom }));
  }, []);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!open || !node) return undefined;
    node.scrollTop = savedScroll.current;
    syncEdges();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncEdges);
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => observer?.disconnect();
  }, [open, syncEdges]);

  useEffect(() => {
    if (!open) setEdges({ top: false, bottom: false });
  }, [open]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    const timer = setTimeout(() => setMounted(false), 420);
    return () => clearTimeout(timer);
  }, [open]);

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
  const myShowcases = view.showcases.filter((s) => notification.showcaseKeys.includes(s.itemKey));
  const showcaseOnly = mine.length === 0 && myShowcases.length > 0;
  const tally = showcaseTally(myShowcases, view.state);
  const allSeen = myShowcases.every((s) => showcaseSeenOf(view.state, s.itemKey));
  const hasSteps = mine.length > 0 || myShowcases.length > 0;
  const left = mine.length - done;

  const cta = showcaseOnly
    ? allSeen
      ? copy.ctaTourAgain
      : copy.ctaTour
    : !canWriteSteps
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
            {notification.minor === GENERAL_MINOR
              ? copy.generalTitle
              : interpolate(copy.releaseTitle, { version: notification.version })}
          </p>
          <div className="release-card__meta">
            {notification.minor === GENERAL_MINOR ? null : (
              <StatusBadge compact withDot tone="info">
                {interpolate(copy.versionBadge, { version: notification.version })}
              </StatusBadge>
            )}
            {archived ? <span>{copy.archivedLabel}</span> : null}
          </div>
        </div>
        <div className="release-card__top-actions">
          {archived ? (
            <Button
              tone="ghost"
              className="button--icon button--sm"
              aria-label={copy.menuRestore}
              title={copy.menuRestore}
              onClick={() => actions.restore(notification.itemKey)}
            >
              <ReleaseIcon name="undo" />
            </Button>
          ) : (
            // Archiving also reads it, so there is no separate "mark as read" to hunt for in a menu.
            <Button
              tone="ghost"
              className="button--icon button--sm"
              aria-label={copy.menuArchive}
              title={copy.menuArchive}
              onClick={() => actions.archive(notification.itemKey)}
            >
              <ReleaseIcon name="archive" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button tone="ghost" className="button--icon button--sm" aria-label={copy.itemActions}>
                <ReleaseIcon name="dots" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="release-card__menu">
              {hasSteps && !archived && canWriteSteps && left > 0 ? (
                <>
                  <DropdownMenuItem onSelect={() => actions.markAllDone(open_)}>
                    <ReleaseIcon name="check" />
                    {copy.menuMarkAllDone}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem
                className="release-card__menu-danger"
                onSelect={() => actions.remove(notification.itemKey)}
              >
                <ReleaseIcon name="trash" />
                {copy.menuDelete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Archived cards keep their progress and steps: archiving files the notice away, it does not
          take away the way back to a step or the view of what is done. */}
      {hasSteps ? (
        <>
          <div className="release-progress">
            <div
              className="release-progress__bar"
              role="img"
              aria-label={showcaseOnly ? copy.progressShowcase : copy.progressLabel}
              data-mixed={mine.length > 0 && myShowcases.length > 0}
            >
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
              {mine.length > 0 && myShowcases.length > 0 ? (
                <i className="release-progress__gap" aria-hidden="true" />
              ) : null}
              {myShowcases.flatMap((instance) =>
                instance.showcase.stops.map((_, stop) => (
                  <span
                    key={`${instance.itemKey}:${stop}`}
                    className="release-progress__seg"
                    data-kind="showcase"
                    data-done={showcaseSeenOf(view.state, instance.itemKey)}
                  />
                ))
              )}
            </div>
            <div className="release-progress__text">
              {mine.length > 0 ? (
                <>
                  <span>{interpolate(copy.doneOf, { done, total: mine.length })}</span>
                  <span>
                    {!canWriteSteps
                      ? copy.adminCompletes
                      : requiredLeft > 0
                        ? interpolate(copy.requiredLeft, { n: requiredLeft })
                        : copy.requiredDone}
                  </span>
                </>
              ) : (
                <span>{interpolate(copy.showcaseTally, { viewed: tally.viewed, total: tally.total })}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="release-card__toggle"
            aria-expanded={open}
            aria-controls={regionId}
            onClick={() => {
              if (open && scrollRef.current) savedScroll.current = scrollRef.current.scrollTop;
              setOpen((value) => !value);
            }}
          >
            <span className="release-card__toggle-label">
              {showcaseOnly ? copy.stopsLabel : copy.stepsLabel}
              <span className="release-card__count">{showcaseOnly ? tally.total : mine.length + myShowcases.length}</span>
            </span>
            <span className="release-card__chevron" aria-hidden="true" data-open={open}>
              <ReleaseIcon name="chevron" />
            </span>
          </button>
          <div id={regionId} className="release-card__collapse" data-open={open}>
            <div
              ref={scrollRef}
              className="release-card__steps"
              data-edge-top={edges.top}
              data-edge-bottom={edges.bottom}
              onScroll={syncEdges}
              {...(open
                ? {
                    role: 'region',
                    'aria-label': interpolate(copy.stepsRegion, { version: notification.version }),
                    tabIndex: 0,
                  }
                : {})}
            >
              {open || mounted ? (
                <>
                  {mine.length > 0 ? <ReleaseStepList instances={mine} onNavigate={onNavigate} /> : null}
                  <ReleaseShowcaseList instances={myShowcases} onNavigate={onNavigate} />
                </>
              ) : null}
            </div>
          </div>
          <div className="release-card__actions">
            <Button
              className="button--sm"
              onClick={() => {
                requestReleaseTour(showcaseOnly ? { showcaseMinor: notification.minor } : {});
                onNavigate();
              }}
            >
              {cta} <ReleaseIcon name="arrow-right" size={14} />
            </Button>
            {hideChangelogLink || notification.minor === GENERAL_MINOR ? null : (
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
            )}
          </div>
        </>
      ) : null}
      {!hasSteps ? (
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
