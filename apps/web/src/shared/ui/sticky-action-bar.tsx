/**
 * StickyActionBar (#3935)
 *
 * The bar that holds a form's primary actions at the bottom of the screen. Its
 * left side is a status line, in one of two shapes: what is still missing before
 * the form can be submitted ("Missing: name, gift", or a ready text when nothing
 * is) for a form being filled in; or a free `message` ("2 changes") for a form
 * being edited. A caller that wants the bar only while there is something to
 * save passes `visible={false}` when clean: it slides away, is out of the tab
 * order and is hidden from assistive tech, so a clean page has no dead controls.
 *
 * Pressing a disabled-looking action while something is missing does not do
 * nothing: the caller sets `shaking` and scrolls to the first missing field.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export interface StickyActionBarProps {
  /** "Missing:". Used with `missing` and `readyText`. */
  missingLabel?: string;
  /** What is missing, already joined; empty means ready. */
  missing?: string;
  /** Shown instead of the list when nothing is missing, e.g. "Ready to turn on". */
  readyText?: string;
  /** A free status line; takes the place of the missing/ready pair. */
  message?: ReactNode;
  /** Replays the status line's shake when it turns true. */
  shaking?: boolean;
  /** False while the form is clean and the bar should leave. */
  visible?: boolean;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function StickyActionBar({
  missingLabel,
  missing = '',
  readyText,
  message,
  shaking = false,
  visible = true,
  children,
  className,
  'aria-label': ariaLabel,
}: StickyActionBarProps): ReactElement {
  const ready = missing === '';
  const status =
    message !== undefined ? (
      <span>{message}</span>
    ) : ready ? (
      <span>{readyText}</span>
    ) : (
      <>
        <span className="pm-missing__l">{missingLabel}</span>
        <span>{missing}</span>
      </>
    );
  return (
    <div
      className={['pm-actionbar', className].filter(Boolean).join(' ')}
      data-clean={visible ? 'false' : 'true'}
      role={ariaLabel === undefined ? undefined : 'region'}
      aria-label={ariaLabel}
      aria-hidden={visible ? undefined : true}
      // Takes the hidden bar's buttons out of the tab order.
      inert={!visible}
    >
      <div
        className={['pm-missing', message === undefined && ready ? 'is-ready' : '', shaking ? 'is-shake' : '']
          .filter(Boolean)
          .join(' ')}
        role="status"
      >
        {status}
      </div>
      <div className="pm-actionbar__btns">{children}</div>
    </div>
  );
}
