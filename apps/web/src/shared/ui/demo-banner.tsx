/**
 * DemoBanner
 *
 * Full-width info bar rendered below the topbar in AppShell when the
 * deployment is running in demo mode (OL_DEMO_MODE=true). Not dismissible —
 * persists for the session as a constant visual reminder.
 *
 * Analytics consent is captured once at registration (#1743) — this banner no
 * longer prompts for it. When analytics is active it renders a quiet
 * "Analytics on" status with a Disable affordance so opt-out stays reachable.
 * This component stays feature-agnostic — it does not read or write consent
 * storage itself (that lives in `features/demo`, which `shared/ui` must not
 * import) — the host wires `onDisableAnalytics`.
 */
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Button } from './button';

export interface DemoBannerProps extends ComponentPropsWithoutRef<'div'> {
  /** True when demo analytics is currently active (shows a Disable affordance). */
  analyticsActive?: boolean;
  /** Called when the visitor uses the Disable affordance to opt out for this browser. */
  onDisableAnalytics?: () => void;
}

export const DemoBanner = forwardRef<HTMLDivElement, DemoBannerProps>(function DemoBanner(
  { className = '', analyticsActive = false, onDisableAnalytics, ...props },
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
      {analyticsActive ? (
        <span className="demo-banner__consent">
          <span>Analytics on.</span>
          <Button className="button--xs" tone="ghost" onClick={() => onDisableAnalytics?.()}>
            Disable
          </Button>
        </span>
      ) : null}
    </div>
  );
});
