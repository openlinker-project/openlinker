/**
 * StickyActionBar (#3935)
 *
 * The bar that holds a long form's primary actions at the bottom of the screen.
 * On the left it says what is still missing before the form can be submitted
 * ("Missing: name, gift") or, when nothing is, that it is ready. Pressing a
 * disabled-looking action while something is missing does not do nothing: the
 * caller calls `shake` on this component's status line and scrolls to the first
 * missing field.
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export interface StickyActionBarProps {
  /** "Missing:". */
  missingLabel: string;
  /** What is missing, already joined; empty means ready. */
  missing: string;
  /** Shown instead of the list when nothing is missing, e.g. "Ready to turn on". */
  readyText: string;
  /** Replays the status line's shake once when it changes from false to true. */
  shaking?: boolean;
  children: ReactNode;
  className?: string;
}

export function StickyActionBar({
  missingLabel,
  missing,
  readyText,
  shaking = false,
  children,
  className,
}: StickyActionBarProps): ReactElement {
  const ready = missing === '';
  return (
    <div className={['pm-actionbar', className].filter(Boolean).join(' ')}>
      <div
        className={['pm-missing', ready ? 'is-ready' : '', shaking ? 'is-shake' : ''].filter(Boolean).join(' ')}
        role="status"
      >
        {ready ? (
          <span>{readyText}</span>
        ) : (
          <>
            <span className="pm-missing__l">{missingLabel}</span>
            <span>{missing}</span>
          </>
        )}
      </div>
      <div className="pm-actionbar__btns">{children}</div>
    </div>
  );
}
