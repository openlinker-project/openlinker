/**
 * StickyActionBar
 *
 * The floating bar at the foot of a composer: on the left what is still
 * missing (or "ready" with a one-line summary), on the right the actions. A
 * `shakeKey` that changes replays a short shake on the status, used when the
 * operator presses Save while something is missing.
 *
 * @module apps/web/src/shared/ui
 */
import type { ReactElement, ReactNode } from 'react';

export interface StickyActionBarProps {
  /** Label in front of the status: "Missing" or "Ready". */
  statusLabel: string;
  statusText: ReactNode;
  ready: boolean;
  /** Increment to replay the shake. */
  shakeKey?: number;
  children: ReactNode;
  'data-testid'?: string;
}

export function StickyActionBar({
  statusLabel,
  statusText,
  ready,
  shakeKey = 0,
  children,
  'data-testid': testId,
}: StickyActionBarProps): ReactElement {
  return (
    <div className="pm-actionbar" data-testid={testId}>
      <div
        key={shakeKey}
        className={['pm-missing', ready ? 'is-ready' : '', shakeKey > 0 ? 'is-shake' : '']
          .filter(Boolean)
          .join(' ')}
        role="status"
      >
        <span className="pm-missing__l">{statusLabel}</span>
        <span>{statusText}</span>
      </div>
      <div className="pm-actionbar__btns">{children}</div>
    </div>
  );
}
