/**
 * Bench surface (#2413, stories A2–A4)
 *
 * The composition: the always-visible identity bar (A4) over the overlay that
 * owns lock (A3) and handover (A2), with the bench body as children.
 *
 * Exported as ONE component rather than as its two halves, because they are
 * only correct together: a caller rendering the bar alone gets a bench that
 * shows a name and never locks, and a caller rendering the overlay alone gets a
 * bench that locks and never says whose work it is recording. Both are the
 * mis-attribution failure ADR-071 names.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement, ReactNode } from 'react';

import { resolveBenchIdleTimeoutMs, useBenchIdentity } from '../hooks/use-bench-identity';
import { BenchIdentityBar } from './bench-identity-bar';
import { BenchIdentityOverlay } from './bench-identity-overlay';

export interface BenchSurfaceProps {
  /** The bench body. Never unmounted, so its state survives a lock or a switch. */
  readonly children: ReactNode;
  /**
   * Overridable for tests. Production resolves `VITE_OL_BENCH_IDLE_TIMEOUT_MS`
   * — read HERE rather than inside the hook so the hook stays a pure function
   * of its arguments and the one env read has one call site.
   */
  readonly idleTimeoutMs?: number;
}

export function BenchSurface({ children, idleTimeoutMs }: BenchSurfaceProps): ReactElement {
  const identity = useBenchIdentity({
    idleTimeoutMs:
      idleTimeoutMs ??
      resolveBenchIdleTimeoutMs(
        (import.meta.env as Record<string, string | undefined>)
          .VITE_OL_BENCH_IDLE_TIMEOUT_MS
      ),
  });

  return (
    <div className="bench">
      <BenchIdentityBar
        signedInName={identity.signedInName}
        onSwitchPacker={identity.requestHandover}
      />
      <BenchIdentityOverlay
        state={identity.state}
        onConfirmHandover={() => void identity.confirmHandover()}
        onCancelHandover={identity.cancelHandover}
      >
        {children}
      </BenchIdentityOverlay>
    </div>
  );
}
