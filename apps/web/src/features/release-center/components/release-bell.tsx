/**
 * Release bell and notification panel (#4148, ADR-085)
 *
 * Replaces the static topbar "Alerts" button. Renders nothing when the feature
 * is off, the session may not read it (a packer), or no provider is mounted, so
 * the pack bench and the loading shell show no bell. The panel is a Popover, so
 * Esc and outside-click are handled by the layer that is on top (the item menu
 * closes first, then the panel), not by a listener on `document`.
 *
 * The badge counts required steps left; optional-only shows a grey dot with no
 * number. The bell rings and the badge pops on change, both off under
 * `prefers-reduced-motion` (CSS).
 *
 * @module features/release-center/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useMessages, usePlural } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { useReleaseActions } from '../hooks/use-release-actions';
import { requestWhatsNew } from '../lib/release-center-requests';
import { notificationStatusOf, stepStatusOf } from '../lib/release-notifications';
import { useReleaseCenterView } from './release-center-provider';
import { ReleaseBellIcon } from './release-bell-icon';
import { ReleaseCard } from './release-card';

type Tab = 'todo' | 'all' | 'archive';

export function ReleaseBell(): ReactElement | null {
  const view = useReleaseCenterView();
  const bell = useMessages('release-center').bell;
  const panel = useMessages('release-center').panel;
  const plural = usePlural();
  const actions = useReleaseActions();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('todo');
  const [ringing, setRinging] = useState(false);
  const ringSignal = view?.ringSignal ?? 0;

  useEffect(() => {
    if (ringSignal === 0) return undefined;
    setRinging(true);
    const timer = setTimeout(() => setRinging(false), 1000);
    return () => clearTimeout(timer);
  }, [ringSignal]);

  if (!view) return null;

  const { summary } = view;
  const rows = view.notifications.map((notification) => ({
    notification,
    ...notificationStatusOf(view.state, notification.itemKey),
  }));
  const visible = rows.filter((row) => row.status !== 'deleted');
  const active = visible.filter((row) => row.status === 'active');
  const archived = visible.filter((row) => row.status === 'archived');
  const todo = active.filter((row) =>
    view.instances.some(
      (instance) =>
        row.notification.stepKeys.includes(instance.itemKey) &&
        stepStatusOf(view.state, instance.itemKey, view.now).status === 'open'
    )
  );
  const shown = tab === 'todo' ? todo : tab === 'all' ? active : archived;
  const unreadKeys = active.filter((row) => row.unread).map((row) => row.notification.itemKey);

  const srText =
    summary.count > 0
      ? plural(summary.count, bell.srTodo, { n: summary.count })
      : summary.showDot
        ? bell.srOptional
        : bell.srNone;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="release-bell"
          data-ringing={ringing}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="release-bell__icon" aria-hidden="true">
            <ReleaseBellIcon />
          </span>
          <span className="release-bell__label">{bell.label}</span>
          <span
            key={summary.count}
            className="release-bell__badge"
            data-zero={summary.count === 0}
            aria-hidden="true"
          >
            {summary.count}
          </span>
          {summary.showDot ? <span className="release-bell__dot" aria-hidden="true" /> : null}
          <span className="sr-only">{srText}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="release-panel" aria-label={panel.title}>
        <header className="release-panel__head">
          <h2 className="release-panel__title">{panel.title}</h2>
          <div className="release-panel__head-actions">
            <Button
              tone="ghost"
              className="button--sm"
              disabled={unreadKeys.length === 0}
              onClick={() => actions.markRead(unreadKeys)}
            >
              {panel.markRead}
            </Button>
            <PopoverClose asChild>
              <Button tone="ghost" className="button--sm" aria-label={panel.close}>
                <span aria-hidden="true">✕</span>
              </Button>
            </PopoverClose>
          </div>
        </header>
        <div className="release-panel__tabs">
          <SegmentedControl<Tab>
            aria-label={panel.tabsLabel}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'todo', label: `${panel.tabTodo} ${todo.length}` },
              { value: 'all', label: `${panel.tabAll} ${active.length}` },
              { value: 'archive', label: `${panel.tabArchive} ${archived.length}` },
            ]}
          />
        </div>
        <div className="release-panel__list" aria-live="polite">
          {shown.length === 0 ? (
            <div className="release-panel__empty">
              <strong>{tab === 'archive' ? panel.emptyArchiveTitle : panel.emptyDoneTitle}</strong>
              <span>{tab === 'archive' ? panel.emptyArchiveBody : panel.emptyDoneBody}</span>
            </div>
          ) : (
            shown.map((row) => (
              <ReleaseCard
                key={row.notification.itemKey}
                notification={row.notification}
                instances={view.instances}
                onNavigate={() => setOpen(false)}
              />
            ))
          )}
        </div>
        <footer className="release-panel__foot">
          <button
            type="button"
            className="release-panel__link"
            onClick={() => {
              requestWhatsNew({});
              setOpen(false);
            }}
          >
            {panel.footerChangelog}
          </button>
        </footer>
      </PopoverContent>
    </Popover>
  );
}
