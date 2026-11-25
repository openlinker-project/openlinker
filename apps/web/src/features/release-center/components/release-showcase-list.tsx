/**
 * Release showcase list
 *
 * The tour-only items of a release. They are laid out exactly like the setup steps above them
 * (same marker column, title, chips, actions), so a release reads as one list. What differs is
 * only what is true: nothing to configure, so the marker is a play glyph in the info tone instead of a
 * number, the chip says "view only" (the same words as the tour card), and there is no connector line.
 * Every role may watch a tour, so nothing here is gated on write access.
 *
 * @module features/release-center/components
 */
import type { ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { useReleaseActions } from '../hooks/use-release-actions';
import { requestReleaseTour } from '../lib/release-center-requests';
import { showcaseSeenOf, showcaseTally, type ShowcaseInstance } from '../lib/release-notifications';
import { useReleaseCenterView } from './release-center-provider';
import { ReleaseIcon } from './release-icon';

interface ShowcaseCopy {
  title: string;
  why: string;
}

export function ReleaseShowcaseList({
  instances,
  onNavigate,
  page = false,
}: {
  instances: readonly ShowcaseInstance[];
  /** Called when a row hands the viewer to the tour, so a panel can step aside. */
  onNavigate?: () => void;
  /** On the What's new page the list sits in the page, not in a card. */
  page?: boolean;
}): ReactElement | null {
  const view = useReleaseCenterView();
  const copy = useMessages('release-center');
  const actions = useReleaseActions();
  if (!view || instances.length === 0) return null;
  const panel = copy.panel;
  const texts = copy.showcases as unknown as Record<string, ShowcaseCopy | undefined>;
  const tally = showcaseTally(instances, view.state);

  return (
    <section
      className={`release-showcase${page ? ' release-showcase--page' : ''}`}
      aria-label={panel.showcaseHeading}
    >
      <header className="release-showcase__head">
        <h4 className="release-showcase__title">{panel.showcaseHeading}</h4>
        <span className="release-showcase__tally" aria-live="polite">
          {interpolate(panel.showcaseTally, { viewed: tally.viewed, total: tally.total })}
        </span>
      </header>
      <ol className="release-steps release-steps--showcase">
        {instances.map((instance) => {
          const seen = showcaseSeenOf(view.state, instance.itemKey);
          const text = texts[instance.showcase.id];
          const title = text?.title ?? instance.showcase.id;
          return (
            <li
              key={instance.itemKey}
              className="release-step"
              data-kind="showcase"
              data-status={seen ? 'done' : 'open'}
            >
              <span className="release-step__ind">
                {seen ? <ReleaseIcon name="check" size={12} /> : <ReleaseIcon name="play" size={10} />}
              </span>
              <div className="release-step__body">
                <p className="release-step__title">{title}</p>
                <div className="release-step__chips">
                  <span className="release-chip release-chip--muted">{copy.tour.showcaseChip}</span>
                  {seen ? <span className="release-chip release-chip--info">{panel.viewedChip}</span> : null}
                </div>
                {text?.why ? <p className="release-step__why">{text.why}</p> : null}
                <div className="release-step__actions">
                  <Button
                    className="button--xs"
                    tone="secondary"
                    aria-label={`${title}: ${panel.stepTour}`}
                    onClick={() => {
                      requestReleaseTour({ showcaseId: instance.showcase.id });
                      onNavigate?.();
                    }}
                  >
                    {panel.stepTour} <ReleaseIcon name="arrow-right" size={12} />
                  </Button>
                  {seen ? (
                    <Button
                      className="button--xs"
                      tone="ghost"
                      onClick={() => actions.resetShowcase(instance.itemKey)}
                    >
                      {panel.unview}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
