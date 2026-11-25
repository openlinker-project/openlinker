/**
 * SettingsIndexRow and SettingsIndexList (#4154)
 *
 * One row of the settings index: a leading icon tile, what the setting is
 * (title and one plain line), what it is set to right now (a status chip with a
 * semantic tone, plus a quiet note) and the one thing to do about it. The whole
 * row is the click target: the action's link or button is stretched over the
 * row, so a row cannot be half-clickable. The visible affordance is a chevron;
 * the action label stays as the accessible name.
 *
 * A row the signed-in role may not open is still listed (`locked`): it stays
 * readable, carries a lock with a tooltip that says who can open it, and
 * offers no action. Rows hold no data fetching of their own; the caller passes
 * the value and its loading or error state so one failed read marks one row
 * instead of the page.
 *
 * @module shared/ui
 */
import { useId, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMessages } from '../i18n/use-messages';
import { SettingsGlyph, type SettingsGlyphName } from './settings-glyph';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

export type SettingsRowAction =
  | { label: string; to: string }
  | { label: string; onClick: () => void };

export type SettingsValueTone = 'neutral' | 'success' | 'warning' | 'info' | 'muted';

export interface SettingsIndexRowProps {
  title: string;
  /** One plain sentence on what the setting changes. */
  description?: ReactNode;
  icon?: SettingsGlyphName;
  /** The current value. With a `tone` it renders as a status chip. */
  value?: ReactNode;
  tone?: SettingsValueTone;
  /** A small muted caption above the value: what the value is ("Reporting in"). */
  caption?: ReactNode;
  /** A tiny muted suffix after the value: where it comes from ("from environment"). */
  suffix?: ReactNode;
  /** Put a status dot in the chip, for on/off style values. */
  dot?: boolean;
  /**
   * A warning that belongs to the row, not to its value: shown under the
   * description with an icon, so the value column stays short and aligned.
   */
  notice?: ReactNode;
  /** Set the value in a monospace face (addresses, identifiers). */
  mono?: boolean;
  valueState?: 'ready' | 'loading' | 'error';
  /** Text for the loading and error states; spoken for the skeleton. */
  stateText?: string;
  action?: SettingsRowAction;
  /** A second control (kept above the stretched action). */
  secondary?: ReactNode;
  /** Listed, readable and explained, but not openable by this role. */
  locked?: boolean;
  /** Mounted next to the row (dialogs the action opens). */
  children?: ReactNode;
  'data-testid'?: string;
}

function Chevron(): ReactElement {
  return (
    <svg
      className="settings-row__chevron"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarningIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 2.5 14 13H2L8 2.5Z" strokeLinejoin="round" />
      <path d="M8 6.5v3M8 11.5h.01" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

export function SettingsIndexList({
  children,
  pending = false,
}: {
  children: ReactNode;
  /** The caller's role is not known yet: locks are hidden instead of flashing. */
  pending?: boolean;
}): ReactElement {
  // `role="list"` because `list-style: none` drops list semantics in Safari.
  return (
    <ul className="settings-index" role="list" data-pending={pending || undefined}>
      {children}
    </ul>
  );
}

export function SettingsIndexRow({
  title,
  description,
  icon,
  value,
  tone,
  caption,
  suffix,
  dot = false,
  notice,
  mono = false,
  valueState = 'ready',
  stateText,
  action,
  secondary,
  locked = false,
  children,
  'data-testid': testId,
}: SettingsIndexRowProps): ReactElement {
  const copy = useMessages('ui').settingsIndex;
  const titleId = useId();
  const hasValue = value !== undefined && value !== null;

  return (
    <li
      className="settings-row"
      data-locked={locked || undefined}
      data-has-icon={icon ? 'true' : undefined}
      data-testid={testId}
    >
      {icon ? (
        <span className="settings-row__icon" aria-hidden="true">
          <SettingsGlyph name={icon} />
        </span>
      ) : null}
      <div className="settings-row__text">
        <h4 className="settings-row__title" id={titleId}>
          {title}
        </h4>
        {description ? <p className="settings-row__description">{description}</p> : null}
        {notice ? (
          <p className="settings-row__notice" data-tone="warning">
            <WarningIcon />
            <span>{notice}</span>
          </p>
        ) : null}
      </div>

      {valueState === 'loading' ? (
        <div className="settings-row__value" role="status">
          <span className="settings-row__skeleton" aria-hidden="true" />
          <span className="sr-only">{stateText ?? copy.loading}</span>
          {caption ? (
            <span className="settings-row__caption" aria-hidden="true">
              {caption}
            </span>
          ) : null}
        </div>
      ) : valueState === 'error' ? (
        <div className="settings-row__value settings-row__value--error" role="alert">
          {stateText ?? copy.unavailable}
        </div>
      ) : hasValue ? (
        <div className="settings-row__value">
          {caption ? <span className="settings-row__caption">{caption}</span> : null}
          <span className="settings-row__reading">
            {tone ? (
              <span className="settings-chip" data-tone={tone} data-dot={dot || undefined}>
                {value}
              </span>
            ) : (
              <span className="settings-row__figure" data-mono={mono || undefined}>
                {value}
              </span>
            )}
            {suffix ? <span className="settings-row__suffix">{suffix}</span> : null}
          </span>
        </div>
      ) : (
        <div className="settings-row__value" aria-hidden="true" />
      )}

      <div className="settings-row__action">
        {secondary ? <span className="settings-row__secondary">{secondary}</span> : null}
        {locked ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="settings-row__lock"
                tabIndex={0}
                role="img"
                aria-label={`${copy.lockedLabel}. ${copy.lockedHint}`}
              >
                <LockIcon />
              </span>
            </TooltipTrigger>
            <TooltipContent>{copy.lockedHint}</TooltipContent>
          </Tooltip>
        ) : action ? (
          'to' in action ? (
            <Link className="settings-row__link" to={action.to} aria-describedby={titleId}>
              <span className="sr-only">{action.label}</span>
              <Chevron />
            </Link>
          ) : (
            <button type="button" className="settings-row__link" onClick={action.onClick} aria-describedby={titleId}>
              <span className="sr-only">{action.label}</span>
              <Chevron />
            </button>
          )
        ) : null}
      </div>
      {children}
    </li>
  );
}
