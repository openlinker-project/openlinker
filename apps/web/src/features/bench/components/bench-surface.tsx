/**
 * Bench surface (#2413, stories A2–A4)
 *
 * The composition: the idle lock (A3) and its overlay, the connectivity
 * readout, and the bench body as children. Who is signed in (A4) is shown by
 * the application's own topbar above this, which `BenchAppLayout` renders -
 * its user chip names the packer whose work is being recorded, and its user
 * menu is how a packer signs out and hands the bench over (#3653).
 *
 * @module apps/web/src/features/bench/components
 */
import type { ReactElement, ReactNode } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { resolveBenchIdleTimeoutMs, useBenchIdentity } from '../hooks/use-bench-identity';
import { BenchInteractiveContext } from '../hooks/use-bench-interactive';
import { benchIdentityCopy } from '../lib/bench-identity.copy';
import { BenchIdentityOverlay } from './bench-identity-overlay';
import { BenchConnectivityIndicator } from './bench-connectivity-indicator';
import { BenchReachabilityContext } from '../hooks/bench-reachability-context';
import { useBenchReachability } from '../hooks/use-bench-reachability';

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

  // #3407/#3422 - held HERE, above both the connectivity readout that reads it
  // and the parcel pane that reports into it. See `bench-reachability-context.ts` for
  // why a second call of the hook would be inert rather than merely redundant.
  const reachability = useBenchReachability();

  return (
    <BenchReachabilityContext.Provider value={reachability}>
    <div className="bench">
      {/* The app's own topbar sits above this (`BenchAppLayout`); what stays
          bench-owned is only the connectivity readout, which no other page has. */}
      <div className="bench-status">
        <BenchConnectivityIndicator />
      </div>
      {/* #3408 (epic #3401). Advisory only — see `use-bench-identity.ts`'s
          "does not add a fourth state" docblock. Any activity dismisses it
          via `useIdleTimeout`'s own onActivity handler, which is what makes
          "tap anywhere to stay signed in" true without a dismiss button. */}
      {identity.warningSecondsRemaining === null ? null : (
        <Alert tone="warning" data-testid="bench-idle-warning">
          {benchIdentityCopy.warning(identity.warningSecondsRemaining)}
        </Alert>
      )}
      <BenchIdentityOverlay state={identity.state}>
        {/* A3's client half. The overlay hides the body visually; this is what
            takes the scanner off it — `aria-hidden` and `inert` say nothing to
            a document-level listener. See `use-bench-interactive.ts`. */}
        <BenchInteractiveContext.Provider value={identity.state === 'open'}>
          {children}
        </BenchInteractiveContext.Provider>
      </BenchIdentityOverlay>
    </div>
    </BenchReachabilityContext.Provider>
  );
}
