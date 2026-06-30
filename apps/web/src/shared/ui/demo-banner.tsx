/**
 * DemoBanner
 *
 * Full-width info bar rendered below the topbar in AppShell when the
 * deployment is running in demo mode (OL_DEMO_MODE=true). Not dismissible —
 * persists for the session as a constant visual reminder.
 */
import type { ReactElement } from 'react';

export function DemoBanner(): ReactElement {
  return (
    <div className="demo-banner" role="note" aria-label="Demo mode notice">
      <span className="demo-banner__icon" aria-hidden="true">🔒</span>
      <span>
        <strong>Demo mode — read-only.</strong> You can explore all data; write actions are
        disabled.
      </span>
    </div>
  );
}
