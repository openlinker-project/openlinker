/**
 * SaveButton (#3935)
 *
 * A primary button with a save micro-state: the label slides out for a spinner
 * while the request runs, then for a check mark and "Saved" for a moment, then
 * back. The state follows the caller's mutation, so it is honest: the check
 * appears only after the server said yes, and an error sends the button straight
 * back to its label (the caller shows the error itself).
 *
 * @module shared/ui
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

export interface SaveButtonProps {
  /** "Save changes". */
  label: string;
  /** "Saving". */
  busyLabel: string;
  /** "Saved". */
  doneLabel: string;
  /** The request is running. */
  pending: boolean;
  /** Increases by one each time a save succeeds; the check shows on every change. */
  savedCount: number;
  onClick: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  'data-testid'?: string;
}

const SAVED_MS = 1800;

export function SaveButton({
  label,
  busyLabel,
  doneLabel,
  pending,
  savedCount,
  onClick,
  disabled = false,
  type = 'button',
  className,
  'data-testid': testId,
}: SaveButtonProps): ReactElement {
  const [saved, setSaved] = useState(false);
  const seen = useRef(savedCount);

  useEffect(() => {
    if (savedCount === seen.current) return undefined;
    seen.current = savedCount;
    setSaved(true);
    const timer = window.setTimeout(() => {
      setSaved(false);
    }, SAVED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [savedCount]);

  const state = pending ? 'is-saving' : saved ? 'is-saved' : '';
  return (
    <button
      type={type}
      className={['button', 'button--sm', 'pm-save', state, className].filter(Boolean).join(' ')}
      aria-label={label}
      disabled={disabled || pending}
      data-testid={testId}
      onClick={onClick}
    >
      <span className="pm-save__a">{label}</span>
      <span className="pm-save__b" aria-hidden="true">
        <i className="pm-save__spin" />
        {busyLabel}
      </span>
      <span className="pm-save__c" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="M3 8.5l3.2 3.2L13 4.8" />
        </svg>
        {doneLabel}
      </span>
      <span className="sr-only" role="status">
        {pending ? busyLabel : saved ? doneLabel : ''}
      </span>
    </button>
  );
}
