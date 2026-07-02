/**
 * DemoBanner
 *
 * Full-width info bar rendered below the topbar in AppShell when the
 * deployment is running in demo mode (OL_DEMO_MODE=true). Not dismissible —
 * persists for the session as a constant visual reminder.
 */
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const DemoBanner = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  function DemoBanner({ className = '', ...props }, ref) {
    const classes = ['demo-banner', className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={classes} role="note" aria-label="Demo mode notice" {...props}>
        <span className="demo-banner__icon" aria-hidden="true">🔒</span>
        <span>
          <strong>Demo mode — read-only.</strong> You can explore all data; write actions are
          disabled.
        </span>
      </div>
    );
  },
);
