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
  children: ReactNode;
}

export function ReadOnlyLock({ active, message, children }: ReadOnlyLockProps): ReactElement {
  if (!active) {
    return <>{children}</>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="read-only-lock" tabIndex={0}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}
