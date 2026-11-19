/**
 * Bell nudge: the popup that drops from the bell when a message arrives
 *
 * One card at a time, anchored under the bell with a small tail at the bell's
 * centre. A newer arrival replaces it and adds to a "+N" counter; the timer depends
 * on severity (info and success 6s, warning 10s, error stays), pauses while the
 * pointer or focus is on the card, and never takes focus. Dismissing only hides the
 * card: the message stays in the list, unread. It does not appear while the panel is
 * open or a tour is running (the ring still plays). Opening the action marks the
 * message read.
 *
 * @module features/release-center/components
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { interpolate, useMessages } from '../../../shared/i18n';
import { useReleaseActions } from '../hooks/use-release-actions';
import { runNotificationAction } from '../lib/notification-action';
import {
  onNotificationArrival,
  type MessageNotification,
  type NotificationSeverity,
} from '../lib/notification-store';
import { ReleaseIcon } from './release-icon';
import { SeverityIcon } from './release-severity-icon';

const DURATION_MS: Record<NotificationSeverity, number | null> = {
  info: 6000,
  success: 6000,
  warning: 10000,
  error: null,
};
/** The bell rings first; the card follows so the bell visibly "speaks" before it. */
const ENTER_DELAY_MS = 250;
const LEAVE_MS = 150;

interface Shown {
  message: MessageNotification;
  /** Arrivals folded into this card while it was up. */
  more: number;
}

export function BellNudge({
  triggerRef,
  panelOpen,
  onOpenPanel,
}: {
  triggerRef: RefObject<HTMLElement | null>;
  panelOpen: boolean;
  onOpenPanel: () => void;
}): ReactElement | null {
  const copy = useMessages('release-center').panel;
  const actions = useReleaseActions();
  const navigate = useNavigate();
  const [shown, setShown] = useState<Shown | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number; tail: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remaining = useRef<number | null>(null);
  const startedAt = useRef(0);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  const clearTimer = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const hide = (): void => {
    clearTimer();
    setLeaving(true);
    setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, LEAVE_MS);
  };
  const hideRef = useRef(hide);
  hideRef.current = hide;

  const arm = (ms: number | null): void => {
    clearTimer();
    remaining.current = ms;
    if (ms === null) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => hideRef.current(), ms);
  };

  const measure = (): void => {
    const bell = triggerRef.current;
    if (!bell) return;
    const rect = bell.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right);
    // Where the bell's centre falls inside the card, so the tail points straight at it.
    const width = Math.min(340, window.innerWidth - 16);
    const cardLeft = window.innerWidth - right - width;
    setAnchor({ top: rect.bottom + 10, right, tail: rect.left + rect.width / 2 - cardLeft });
  };

  useEffect(
    () =>
      onNotificationArrival((message) => {
        // The list is already in view, or a tour owns the screen: the ring is enough.
        if (panelOpenRef.current) return;
        if (document.documentElement.classList.contains('tour-active')) return;
        setTimeout(() => {
          if (panelOpenRef.current) return;
          measure();
          setLeaving(false);
          setShown((current) => {
            // An error is never pushed out by something milder.
            if (current && current.message.severity === 'error' && message.severity !== 'error') {
              return { ...current, more: current.more + 1 };
            }
            return { message, more: current ? current.more + 1 : 0 };
          });
          arm(DURATION_MS[message.severity]);
        }, ENTER_DELAY_MS);
      }),
    []
  );

  useEffect(() => {
    if (panelOpen && shown) hideRef.current();
  }, [panelOpen]);

  useEffect(() => {
    if (!shown) return undefined;
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [shown]);

  useEffect(() => clearTimer, []);

  if (!shown || !anchor) return null;
  const { message, more } = shown;
  const urgent = message.severity === 'error' || message.severity === 'warning';
  const duration = DURATION_MS[message.severity];

  const pause = (): void => {
    if (timer.current && remaining.current !== null) {
      remaining.current = Math.max(800, remaining.current - (Date.now() - startedAt.current));
      clearTimer();
    }
  };
  const resume = (): void => {
    if (!timer.current && remaining.current !== null && !leaving) arm(remaining.current);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      hide();
    }
  };

  return (
    <div
      className="bell-nudge"
      data-leaving={leaving}
      data-severity={message.severity}
      role={urgent ? 'alert' : 'status'}
      style={
        {
          top: anchor.top,
          right: anchor.right,
          '--nudge-tail': `${anchor.tail}px`,
          '--nudge-ms': duration ? `${duration}ms` : undefined,
        } as CSSProperties
      }
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      onKeyDown={onKeyDown}
    >
      <span className="bell-nudge__icon">
        <SeverityIcon severity={message.severity} />
      </span>
      <div className="bell-nudge__main">
        <p className="bell-nudge__title">{message.title}</p>
        {message.body ? <p className="bell-nudge__body">{message.body}</p> : null}
        <div className="bell-nudge__foot">
          {message.action ? (
            <button
              type="button"
              className="msg__action"
              onClick={() => {
                if (message.action) {
                  runNotificationAction(message.action, (path) => void navigate(path));
                  actions.markRead([message.itemKey]);
                }
                hide();
              }}
            >
              {message.action.label}
            </button>
          ) : (
            <button
              type="button"
              className="msg__action"
              onClick={() => {
                onOpenPanel();
              }}
            >
              {copy.nudgeOpen}
            </button>
          )}
          {more > 0 ? <span className="bell-nudge__more">{interpolate(copy.nudgeMore, { n: more })}</span> : null}
        </div>
      </div>
      <button type="button" className="bell-nudge__close" aria-label={copy.nudgeDismiss} onClick={hide}>
        <ReleaseIcon name="close" size={14} />
      </button>
      {duration ? <span className="bell-nudge__timer" aria-hidden="true" /> : null}
    </div>
  );
}
