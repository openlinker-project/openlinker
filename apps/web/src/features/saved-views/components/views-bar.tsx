/**
 * ViewsBar
 *
 * The one navigation device of a list: pinned views as tabs with their
 * counters, and a "Views" button that is rendered on EVERY list (also those
 * with a single built-in view), opening the menu of all views with per-view
 * actions. Presentational: the caller owns every decision.
 *
 * @module apps/web/src/features/saved-views/components
 */
import { Fragment, useState, type ReactElement } from 'react';
import { interpolate } from '../../../shared/i18n/interpolate';
import { useMessages } from '../../../shared/i18n/use-messages';
import { Button } from '../../../shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import type { ListView, ViewScope } from '../lib/saved-view.types';
import { ViewIcon } from './view-icons';

export interface ViewsBarProps {
  /** Pinned views plus the active one, in strip order. */
  tabs: ListView[];
  activeId: string;
  /** Every view, for the menu. */
  views: ListView[];
  pinnedIds: string[];
  lockedIds: string[];
  defaultId: string;
  isAdmin: boolean;
  /** False on a list with built-in views only: no per-view menu, no "save as new". */
  customViews: boolean;
  onSelect: (id: string) => void;
  onPin: (id: string) => void;
  onSetDefault: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

const GROUPS: Array<[ViewScope, 'builtIn' | 'shared' | 'mine']> = [
  ['system', 'builtIn'],
  ['shared', 'shared'],
  ['personal', 'mine'],
];

export function ViewsBar(props: ViewsBarProps): ReactElement {
  const copy = useMessages('saved-views').viewsBar;
  const { tabs, activeId, views, pinnedIds, lockedIds, defaultId, isAdmin, customViews } = props;
  const [open, setOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);

  const firstCustom = tabs.findIndex((view) => view.scope !== 'system');
  const hiddenCount = views.filter((view) => !pinnedIds.includes(view.id)).length;
  const canEdit = (view: ListView): boolean =>
    view.scope === 'personal' || (view.scope === 'shared' && isAdmin);
  const groups = customViews ? GROUPS : GROUPS.slice(0, 1);

  const close = (): void => {
    setOpen(false);
    setRowMenu(null);
  };
  const run = (action: () => void): void => {
    action();
    close();
  };

  return (
    <div className="sv-strip">
      <div className="sv-tabs" role="group" aria-label={copy.group}>
        {tabs.map((view, index) => (
          <Fragment key={view.id}>
            {index === firstCustom && firstCustom > 0 ? <span className="sv-sep" aria-hidden="true" /> : null}
            <button
              type="button"
              className="sv-reset sv-tab"
              aria-current={view.id === activeId ? 'true' : undefined}
              aria-label={
                view.count !== undefined
                  ? interpolate(copy.tab, { name: view.name, count: view.count })
                  : undefined
              }
              onClick={() => {
                if (view.id !== activeId) props.onSelect(view.id);
              }}
            >
              {view.name}
              {view.count !== undefined ? (
                <span
                  className={[
                    'sv-tab__count',
                    view.tone === 'error' && view.count > 0 ? 'sv-tab__count--err' : '',
                    view.tone === 'warning' && view.count > 0 ? 'sv-tab__count--warn' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {view.count}
                </span>
              ) : null}
            </button>
          </Fragment>
        ))}
      </div>
      <div className="sv-rel">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setRowMenu(null);
          }}
        >
          <PopoverTrigger asChild>
            <Button tone="ghost" className="button--sm">
              {copy.viewsButton}
              {hiddenCount > 0 ? <span className="sv-hint">{hiddenCount}</span> : null}
              <ViewIcon name="down" size={11} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="sv-menu"
            aria-label={copy.group}
            onEscapeKeyDown={(event) => {
              // The row's submenu is the top layer inside the menu: it closes first.
              if (rowMenu) {
                event.preventDefault();
                setRowMenu(null);
              }
            }}
          >
            {groups.map(([scope, labelKey]) => {
              const inGroup = views.filter((view) => view.scope === scope);
              return (
                <div key={scope}>
                  <div className="sv-menu__label">{copy[labelKey]}</div>
                  {inGroup.length === 0 ? <div className="sv-menu__note">{copy.none}</div> : null}
                  {inGroup.map((view) => (
                    <div key={view.id} className="sv-vrow">
                      <button
                        type="button"
                        className="sv-reset sv-menu__item"
                        aria-current={view.id === activeId}
                        onClick={() => run(() => props.onSelect(view.id))}
                      >
                        <span className="sv-menu__name">{view.name}</span>
                        {view.id === defaultId ? <span className="sv-hint">{copy.defaultBadge}</span> : null}
                      </button>
                      {customViews ? (
                        <button
                          type="button"
                          className="sv-reset sv-vrow__more"
                          aria-label={interpolate(copy.actionsFor, { name: view.name })}
                          aria-expanded={rowMenu === view.id}
                          onClick={() => setRowMenu(rowMenu === view.id ? null : view.id)}
                        >
                          <ViewIcon name="dots" />
                        </button>
                      ) : null}
                      {rowMenu === view.id ? (
                        <div className="sv-sub" role="menu" aria-label={view.name}>
                          {!lockedIds.includes(view.id) ? (
                            <button type="button" role="menuitem" className="sv-reset sv-menu__item" onClick={() => run(() => props.onPin(view.id))}>
                              {pinnedIds.includes(view.id) ? copy.unpin : copy.pin}
                            </button>
                          ) : null}
                          {view.scope !== 'system' ? (
                            <button type="button" role="menuitem" className="sv-reset sv-menu__item" onClick={() => run(() => props.onSetDefault(view.id))}>
                              {view.id === defaultId ? copy.defaultForMe : copy.openByDefault}
                            </button>
                          ) : null}
                          <button type="button" role="menuitem" className="sv-reset sv-menu__item" onClick={() => run(() => props.onDuplicate(view.id))}>
                            {copy.duplicate}
                          </button>
                          {canEdit(view) ? (
                            <button type="button" role="menuitem" className="sv-reset sv-menu__item" onClick={() => run(() => props.onRename(view.id))}>
                              {copy.rename}
                            </button>
                          ) : null}
                          {canEdit(view) ? (
                            <button type="button" role="menuitem" className="sv-reset sv-menu__item sv-menu__item--danger" onClick={() => run(() => props.onDelete(view.id))}>
                              {copy.delete}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              );
            })}
            {customViews ? (
              <>
                <div className="sv-menu__sep" />
                <button type="button" className="sv-reset sv-menu__item" onClick={() => run(props.onNew)}>
                  <ViewIcon name="plus" />
                  <span className="sv-menu__name">{copy.saveNew}</span>
                </button>
              </>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
