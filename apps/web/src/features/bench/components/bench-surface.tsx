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
 * `BenchTopbar` (#3423) is composed here too, but is stateless and carries no
 * attribution stake — it renders above the identity bar unconditionally and
 * has no bearing on the lock/handover argument above.
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement, ReactNode } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { resolveBenchIdleTimeoutMs, useBenchIdentity } from '../hooks/use-bench-identity';
import { BenchInteractiveContext } from '../hooks/use-bench-interactive';
import { benchIdentityCopy } from '../lib/bench-identity.copy';
import { BenchIdentityBar } from './bench-identity-bar';
import { BenchIdentityOverlay } from './bench-identity-overlay';
import { BenchTopbar } from './bench-topbar';

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
      {/* #3423 (epic #3401) — bench-owned, never `AppShell`. See the module docblock. */}
      <BenchTopbar signedInName={identity.signedInName} />
      <BenchIdentityBar
        signedInName={identity.signedInName}
        onSwitchPacker={identity.requestHandover}
      />
      {/* #3408 (epic #3401). Advisory only — see `use-bench-identity.ts`'s
          "does not add a fourth state" docblock. Any activity dismisses it
          via `useIdleTimeout`'s own onActivity handler, which is what makes
          "tap anywhere to stay signed in" true without a dismiss button. */}
      {identity.warningSecondsRemaining === null ? null : (
        <Alert tone="warning" data-testid="bench-idle-warning">
          {benchIdentityCopy.warning(identity.warningSecondsRemaining)}
        </Alert>
      )}
      <BenchIdentityOverlay
        state={identity.state}
        onConfirmHandover={() => void identity.confirmHandover()}
        onCancelHandover={identity.cancelHandover}
      >
        {/* A3's client half. The overlay hides the body visually; this is what
            takes the scanner off it — `aria-hidden` and `inert` say nothing to
            a document-level listener. See `use-bench-interactive.ts`. */}
        <BenchInteractiveContext.Provider value={identity.state === 'open'}>
          {children}
        </BenchInteractiveContext.Provider>
      </BenchIdentityOverlay>
    </div>
  );
}
