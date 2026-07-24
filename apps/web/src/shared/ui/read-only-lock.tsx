/**
 * ReadOnlyLock
 *
 * Wraps a disabled write affordance with a tooltip explaining why it is locked.
 * When `active` is false it renders its children untouched, so call sites can
 * always mount the same subtree and only opt into the lock treatment for demo
 * read-only viewers (#1615).
 *
 * The `<span>` wrapper is required because a natively-disabled `<button>` emits
 * no pointer events, so the Radix tooltip would never trigger without it (same
 * pattern as the AI-suggest locked trigger in `suggestion-dialog.tsx`).
 *
 * @module shared/ui
 */
import type { ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

interface ReadOnlyLockProps {
  /** When true, wrap children with the locked tooltip; otherwise pass through. */
  active: boolean;
  /** Tooltip copy explaining why the affordance is disabled. */
  message: string;
  /**
   * Fired when the locked wrapper is clicked (the disabled control inside
   * emits no pointer events, so this is the only reachable click signal).
   * Only ever attached when `active` — demo-event intent-click instrumentation
   * (#1788) is the primary consumer.
   */
  onLockedClick?: () => void;
  children: ReactNode;
}

export function ReadOnlyLock({
  active,
  message,
  onLockedClick,
  children,
}: ReadOnlyLockProps): ReactElement {
  if (!active) {
    return <>{children}</>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="read-only-lock" tabIndex={0} onClick={onLockedClick}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}
