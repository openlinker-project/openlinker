/**
 * Message notification row
 *
 * A flat, compact row (not a card): severity icon, title, up to two lines of body,
 * the severity word, the age and one action. It shares the item menu of the release
 * card (mark read, archive, delete). Severity is shape + word + a thin left accent.
 *
 * @module features/release-center/components
 */
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMessages } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../shared/ui/dropdown-menu';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useReleaseActions } from '../hooks/use-release-actions';
import { runNotificationAction } from '../lib/notification-action';
import type { MessageNotification } from '../lib/notification-store';
import { ReleaseIcon } from './release-icon';
import { SeverityIcon } from './release-severity-icon';

export function ReleaseMessageRow({
  message,
  unread,
  archived,
  onNavigate,
}: {
  message: MessageNotification;
  unread: boolean;
  archived: boolean;
  /** Closes the panel when the action hands the viewer elsewhere. */
  onNavigate: () => void;
}): ReactElement {
  const copy = useMessages('release-center').panel;
  const actions = useReleaseActions();
  const navigate = useNavigate();
  const severityLabel = copy.severity[message.severity];

  return (
    <article
      className={`msg msg--${message.severity}`}
      data-unread={unread && !archived}
      data-archived={archived}
    >
      <span className="msg__icon">
        <SeverityIcon severity={message.severity} />
      </span>
      <div className="msg__main">
        <p className="msg__title">
          {unread && !archived ? (
            <span className="msg__dot">
              <span className="sr-only">{copy.unreadLabel}</span>
            </span>
          ) : null}
          {message.title}
        </p>
        {message.body ? <p className="msg__body">{message.body}</p> : null}
        <div className="msg__foot">
          <span className="msg__sev">{severityLabel}</span>
          <TimeDisplay iso={message.createdAt} format="relative" className="msg__time" />
          {message.action ? (
            <button
              type="button"
              className="msg__action"
              onClick={() => {
                if (message.action) {
                  runNotificationAction(message.action, (path) => void navigate(path));
                  if (unread) actions.markRead([message.itemKey]);
                  onNavigate();
                }
              }}
            >
              {message.action.label}
            </button>
          ) : null}
        </div>
      </div>
      <div className="msg__tools">
        {archived ? (
          <Button
            tone="ghost"
            className="button--icon button--sm"
            aria-label={copy.menuRestore}
            title={copy.menuRestore}
            onClick={() => actions.restore(message.itemKey)}
          >
            <ReleaseIcon name="undo" />
          </Button>
        ) : (
          <Button
            tone="ghost"
            className="button--icon button--sm"
            aria-label={copy.menuArchive}
            title={copy.menuArchive}
            onClick={(event) => {
              const row = event.currentTarget.closest('.msg');
              const neighbour = row?.nextElementSibling ?? row?.previousElementSibling ?? null;
              const target = neighbour?.matches('.msg') ? neighbour.querySelector('.msg__tools button') : null;
              actions.archive(message.itemKey);
              // The row leaves the DOM; without this, keyboard focus falls to the page.
              setTimeout(() => {
                const next = target instanceof HTMLElement && target.isConnected
                  ? target
                  : document.querySelector<HTMLElement>('.release-panel [role="radio"][aria-checked="true"]');
                next?.focus();
              }, 0);
            }}
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
            <DropdownMenuItem
              className="release-card__menu-danger"
              onSelect={() => actions.remove(message.itemKey)}
            >
              <ReleaseIcon name="trash" />
              {copy.menuDelete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
