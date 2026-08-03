/**
 * DemoBanner
 *
 * Full-width info bar rendered below the topbar in AppShell when the
 * deployment is running in demo mode (OL_DEMO_MODE=true). Not dismissible —
 * persists for the session as a constant visual reminder.
 *
 * Analytics consent is captured once at registration (#1743) and is a condition
 * of using the demo (#1938), so the banner carries no analytics affordance any
 * more: the "Analytics on / Disable" pair was the last in-product opt-out and
 * went with the Settings tile.
 */
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type DemoBannerProps = ComponentPropsWithoutRef<'div'>;

export const DemoBanner = forwardRef<HTMLDivElement, DemoBannerProps>(function DemoBanner(
  { className = '', ...props },
  ref,
) {
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
});
