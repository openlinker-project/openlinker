/**
 * Bench surface behaviour (#2413, story A3)
 *
 * The acceptance criteria that are properties of a MOUNTED surface, each
 * asserted against a real render rather than against a decorator or a comment:
 * the idle lock reveals nothing about the order, discards nothing, and a fresh
 * sign-in reopens the same bench. Who is signed in (A4) is the application
 * topbar's job since #3653 and is asserted in `bench-app-layout.test.tsx`.
 *
 * The progress assertions use a STATEFUL child. A test that only checked the
 * overlay rendered would pass against an implementation that unmounts the bench
 * body on lock — which is exactly the defect "locking never discards progress"
 * forbids, and the reason `BenchIdentityOverlay` renders children above rather
 * than instead.
 *
 * @module apps/web/src/features/bench/components
 */
import { useState, type ReactElement } from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, createAuthenticatedSessionAdapter } from '../../../test/test-utils';
import type { SessionAdapter } from '../../../shared/auth/session-adapter';
import { ThemeProvider } from '../../../shared/theme/theme-provider';
import type { Session } from '../../../shared/auth/session.types';
import { useSession } from '../../../shared/auth/use-session';
import { useBenchInteractive } from '../hooks/use-bench-interactive';
import { useScannerInput } from '../hooks/use-scanner-input';
import { resetGestureLogForTests } from '../lib/scanner-gesture-log';
import { dispatchScannerBurst } from '../lib/scanner-burst.test-helper';
import { BenchSurface } from './bench-surface';

/**
 * Signs in the way the real app does — flip the adapter, then ask the provider
 * to re-read. `LoginForm` does exactly this via `persistSession` +
 * `refreshSession`; driving the real form here would need the api-client mock
 * and would test the form rather than the bench's reaction to a new session.
 *
 * Rendered as a SIBLING of the bench, not a child: when the bench is locked its
 * body is `inert` and concealed, and a control the test has to click must not
 * be inside the thing under test's hidden subtree.
 */
function SignInTrigger({ onSignIn }: { onSignIn: () => void }): ReactElement {
  const { refreshSession } = useSession();
  return (
    <button
      type="button"
      onClick={() => {
        onSignIn();
        void refreshSession();
      }}
    >
      sign in as someone
    </button>
  );
}

/**
 * A session that really goes anonymous when cleared.
 *
 * `createAuthenticatedSessionAdapter`'s `clearSession` is a no-op, which is
 * fine for the lock legs (they assert the STATE machine and the
 * adapter call) but useless for the SIGN-IN leg — the one that exercises
 * `wasSignedIn`, the most delicate logic in the hook. Without a switchable
 * adapter that test would assert nothing.
 */
function createSwitchableSessionAdapter(startSignedIn: boolean): SessionAdapter & {
  signIn: () => void;
} {
  let signedIn = startSignedIn;
  return {
    async getSession(): Promise<Session> {
      return signedIn
        ? {
            status: 'authenticated',
            accessToken: 'test-jwt-token',
            user: {
              id: 'u1',
              username: 'anna',
              email: null,
              role: 'packer',
              permissions: [],
            },
          }
        : { status: 'anonymous', accessToken: null, user: null };
    },
    async getAccessToken(): Promise<string | null> {
      return signedIn ? 'test-jwt-token' : null;
    },
    async persistSession(): Promise<void> {
      signedIn = true;
    },
    async clearSession(): Promise<void> {
      signedIn = false;
    },
    signIn(): void {
      signedIn = true;
    },
  };
}

/** Stands in for the parcel #2418 will render — state that must survive. */
function ProgressStub(): ReactElement {
  const [verified, setVerified] = useState(0);
  return (
    <div>
      <p data-testid="secret-order-ref">ORDER-4471 · Nowak · ul. Testowa 1</p>
      <p data-testid="verified-count">{verified}</p>
      <button type="button" onClick={() => setVerified((n) => n + 1)}>
        verify one
      </button>
    </div>
  );
}

/**
 * Let the idle period elapse, with both flushes the assertion depends on.
 *
 * Two ordering hazards, and a bare `act(() => vi.advanceTimersByTime(…))` loses
 * to either:
 *
 *  1. `useIdleTimeout` SCHEDULES its `setTimeout` from an effect, and that
 *     effect arms only once the session has RESOLVED (`enabled: signedIn`).
 *     Advance the clock before that and there is no timer to advance — and
 *     because the clock is fake, nothing moves it again, so the bench never
 *     locks and the failure reads as "the lock is broken" rather than "the test
 *     advanced too early". `awaitSignedIn()` is the precondition that closes
 *     that hole; the microtask flush below covers the effect itself.
 *  2. Firing the timer schedules a React state update whose effects flush on a
 *     microtask. Asserting before that flush races `waitFor`'s own polling.
 *
 * So: flush mount effects, advance, flush again.
 */
async function advanceIdlePeriod(timeoutMs: number = IDLE_TIMEOUT_MS): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(timeoutMs + 200);
    await Promise.resolve();
  });
}

/**
 * Wait until a packer is really signed in — the precondition every idle-lock
 * assertion in this file rests on.
 *
 * While the session adapter's promise is still pending, `signedIn` is false,
 * so the surface presents as LOCKED and `useIdleTimeout` is `enabled: false`
 * with no timer armed - an advance placed then is a silent no-op, and the
 * bench never locks however long the test waits. The locked overlay leaving
 * the DOM IS the session having resolved.
 *
 * The trailing flush is the other half, and it is not decoration. The overlay
 * leaves in the COMMIT that renders the new session, while the hook's
 * `wasSignedIn` transition effect - the one that re-arms the clock - is a
 * passive effect of that same commit. So: wait for the render, then let the
 * effects it scheduled run, and only then hand back a settled bench.
 */
async function awaitSignedIn(): Promise<void> {
  await waitFor(() => expect(screen.queryByTestId('bench-locked')).not.toBeInTheDocument());
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * A body that listens the way the real bench bodies do (#2905 review, A3).
 *
 * `useScannerInput`'s `enabled` docblock says a COVERED surface passes `false`,
 * and until #2905 neither real consumer did — `aria-hidden` and `inert` do
 * nothing to a document-level `keydown` listener, so a scan at a locked bench
 * fired a real `verifyUnit`. This stub is the smallest thing that reproduces
 * that: it does exactly what `BenchParcelView` and `BenchWorkList` do.
 */
function ScannerStub({ seen }: { seen: string[] }): ReactElement {
  const interactive = useBenchInteractive();
  useScannerInput({
    enabled: interactive,
    onScan: (gesture) => {
      seen.push(gesture.value);
    },
  });
  return <p data-testid="scanner-stub">listening</p>;
}

/** One completed scanner gesture, dispatched at the document as a real one is. */
function scan(value: string): void {
  act(() => {
    dispatchScannerBurst(value);
  });
}

/**
 * One idle budget for every bench mounted in this file, and it is THIRTY
 * SECONDS rather than the second a bench test naively wants.
 *
 * `shouldAdvanceTime: true` (below) is not optional here, and its cost is that
 * fake time keeps running with real time — so every millisecond a `user.click`
 * or a `findBy*` spends on the wall is spent out of the bench's idle budget.
 * Against a 1s budget on a slow or loaded runner (CI is ~3x this laptop) two
 * clicks are enough to lock the bench *before* the assertion the test is
 * making, and the file fails in a way that reads as "the lock is broken" and
 * varies by machine.
 *
 * Every lock here is therefore driven by an EXPLICIT `advanceIdlePeriod()`, and
 * the budget is set far above any credible incidental elapsed time so that
 * nothing but that explicit advance can reach it. Nothing about what the tests
 * ASSERT changes with this number — only which clock reaches the deadline.
 */
const IDLE_TIMEOUT_MS = 30_000;

/**
 * The bench body may render theme-aware primitives, and `renderWithProviders`
 * deliberately does not mount a `ThemeProvider` globally (the
 * `theme-toggle.test.tsx` precedent), so every render in this file wraps its
 * tree with one here.
 */
function withTheme(node: ReactElement): ReactElement {
  return <ThemeProvider>{node}</ThemeProvider>;
}

describe('BenchSurface (#2413)', () => {
  beforeEach(() => {
    // `shouldAdvanceTime: true` is load-bearing, not incidental: RTL does not
    // recognise vitest's fake timers, so `waitFor` / `findBy*` poll on a real
    // interval. With the clock fully frozen every await in this file hangs to
    // the 10s test timeout (verified). Its cost is paid for by the budget above.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function render(): ReturnType<typeof renderWithProviders> {
    return renderWithProviders(
      withTheme(
        <BenchSurface idleTimeoutMs={IDLE_TIMEOUT_MS}>
          <ProgressStub />
        </BenchSurface>
      ),
      { sessionAdapter: createAuthenticatedSessionAdapter() }
    );
  }

  it('A3 — locks after the idle period', async () => {
    render();
    await awaitSignedIn();

    await advanceIdlePeriod();

    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());
  });

  it('A3 — the locked screen reveals nothing about the order', async () => {
    render();
    await awaitSignedIn();

    await advanceIdlePeriod();
    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());

    // The body is still MOUNTED — that is how progress survives — so the
    // assertion is about EXPOSURE, not about presence. `getByTestId` would pass
    // on a body that is fully visible; the concealment attributes are the claim.
    const body = screen.getByTestId('bench-body');
    expect(body).toHaveAttribute('aria-hidden', 'true');
    expect(body).toHaveAttribute('inert');
    expect(body.className).toContain('bench-body--concealed');
  });

  it('A3 — locking discards no progress', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render();
    await awaitSignedIn();

    await user.click(screen.getByRole('button', { name: /verify one/i }));
    await user.click(screen.getByRole('button', { name: /verify one/i }));
    expect(screen.getByTestId('verified-count')).toHaveTextContent('2');

    await advanceIdlePeriod();
    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());

    // Still 2. The bench body was never unmounted.
    expect(screen.getByTestId('verified-count')).toHaveTextContent('2');
  });

  it('A3 — a locked bench takes the SCANNER off, not just the pixels', async () => {
    // The idle lock clears the session, but the parcel survives in the query
    // cache and the listener is on `document` — so before #2905 a scan at an
    // unattended terminal minted a gesture id and fired an (unauthenticated)
    // `verifyUnit`, landing as an alert UNDERNEATH the lock. The 401 is the
    // right backstop and the wrong primary.
    resetGestureLogForTests();
    const seen: string[] = [];
    renderWithProviders(
      withTheme(
        <BenchSurface idleTimeoutMs={IDLE_TIMEOUT_MS}>
          <ScannerStub seen={seen} />
        </BenchSurface>
      ),
      { sessionAdapter: createAuthenticatedSessionAdapter() }
    );
    await awaitSignedIn();

    // Non-vacuity: the listener really is attached while the bench is open, so
    // the assertion after the lock is about the LOCK and not about a stub that
    // never listened.
    scan('5901234123457');
    expect(seen).toEqual(['5901234123457']);

    await advanceIdlePeriod();
    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());

    scan('4006381333931');
    expect(seen).toEqual(['5901234123457']);
  });

  it('A2 — a fresh sign-in reopens the bench and RE-ARMS the idle clock', async () => {
    // The sign-in leg, and the only test of the `wasSignedIn` transition
    // effect. It starts SIGNED IN and lets the first idle period actually
    // elapse, which is what makes the re-arm assertion real: `useIdleTimeout`
    // fires once and stays fired, so only `reset()` can make the bench lock a
    // SECOND time. Starting signed-out instead would pass against a hook that
    // never calls `reset()` at all — the timer would simply be arming for the
    // first time — which is a test that reads correct and asserts nothing.
    //
    // Both locks are driven by an EXPLICIT `advanceIdlePeriod()`, against the
    // file's deliberately large `IDLE_TIMEOUT_MS` — so no amount of wall-clock
    // time spent in the sign-in click can reach the budget and lock the bench
    // behind the test's back.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const adapter = createSwitchableSessionAdapter(true);
    renderWithProviders(
      withTheme(
        <>
          <SignInTrigger onSignIn={() => adapter.signIn()} />
          <BenchSurface idleTimeoutMs={IDLE_TIMEOUT_MS}>
            <ProgressStub />
          </BenchSurface>
        </>
      ),
      { sessionAdapter: adapter }
    );
    await awaitSignedIn();

    // First lock: the idle hook fires and `lock()` clears the session, so the
    // provider goes anonymous for real.
    await advanceIdlePeriod();
    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /sign in as someone$/i }));
    await waitFor(() => expect(screen.queryByTestId('bench-locked')).not.toBeInTheDocument());
    await awaitSignedIn();
    // The incoming packer inherits the parcel, untouched.
    expect(screen.getByTestId('verified-count')).toHaveTextContent('0');

    // Second lock. Without `reset()` the hook stays fired and this never
    // happens: a bench that locks exactly once and then never again, which
    // reads as working.
    await advanceIdlePeriod();
    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());
  });

  // ── #3408 — idle-lock countdown warning + resume-to-prior-state ─────────
  describe('the idle-lock countdown warning', () => {
    // BENCH_WARNING_LEAD_MS is 30s, so a 30s timeout (this file's default)
    // never produces a warning window at all — needs a longer budget.
    const WARNING_IDLE_TIMEOUT_MS = 60_000;

    it('shows the countdown before the terminal lock, and NOT before it', async () => {
      renderWithProviders(
        withTheme(
          <BenchSurface idleTimeoutMs={WARNING_IDLE_TIMEOUT_MS}>
            <ProgressStub />
          </BenchSurface>
        ),
        { sessionAdapter: createAuthenticatedSessionAdapter() }
      );
      await awaitSignedIn();

      expect(screen.queryByTestId('bench-idle-warning')).not.toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(WARNING_IDLE_TIMEOUT_MS - 30_000 + 100);
        await Promise.resolve();
      });

      const warning = await screen.findByTestId('bench-idle-warning');
      expect(warning).toHaveTextContent(/signed out in 30s/i);
      expect(warning).toHaveTextContent(/tap anywhere/i);
      // Advisory, not a fourth screen — the body stays fully visible.
      expect(screen.getByTestId('secret-order-ref')).toBeVisible();
      expect(screen.queryByTestId('bench-locked')).not.toBeInTheDocument();
    });

    it('is dismissed by activity, which also pushes the lock back out', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithProviders(
        withTheme(
          <BenchSurface idleTimeoutMs={WARNING_IDLE_TIMEOUT_MS}>
            <ProgressStub />
          </BenchSurface>
        ),
        { sessionAdapter: createAuthenticatedSessionAdapter() }
      );
      await awaitSignedIn();

      await act(async () => {
        vi.advanceTimersByTime(WARNING_IDLE_TIMEOUT_MS - 30_000 + 100);
        await Promise.resolve();
      });
      await screen.findByTestId('bench-idle-warning');

      // A real click is activity — the same "tap anywhere" the copy promises.
      await user.click(screen.getByRole('button', { name: /verify one/i }));

      await waitFor(() =>
        expect(screen.queryByTestId('bench-idle-warning')).not.toBeInTheDocument()
      );

      // And the lock itself was pushed back — the ORIGINAL deadline (a further
      // ~29.9s from here) must not still fire the terminal lock.
      await act(async () => {
        vi.advanceTimersByTime(29_000);
        await Promise.resolve();
      });
      expect(screen.queryByTestId('bench-locked')).not.toBeInTheDocument();
    });

    it('clears once the terminal lock actually fires', async () => {
      renderWithProviders(
        withTheme(
          <BenchSurface idleTimeoutMs={WARNING_IDLE_TIMEOUT_MS}>
            <ProgressStub />
          </BenchSurface>
        ),
        { sessionAdapter: createAuthenticatedSessionAdapter() }
      );
      await awaitSignedIn();

      await advanceIdlePeriod(WARNING_IDLE_TIMEOUT_MS);

      await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());
      expect(screen.queryByTestId('bench-idle-warning')).not.toBeInTheDocument();
    });

    it('resumes to the EXACT prior parcel/state on sign-in, never the worklist', async () => {
      // BenchPage keeps "which parcel is open" as its own state, outside
      // BenchSurface's remit — this proves the piece BenchSurface IS
      // responsible for: the body (whatever it is) is never unmounted by a
      // lock, so whatever a caller had open stays open underneath, and its
      // own state (ProgressStub's counter here) is exactly as it was left.
      renderWithProviders(
        withTheme(
          <BenchSurface idleTimeoutMs={IDLE_TIMEOUT_MS}>
            <ProgressStub />
          </BenchSurface>
        ),
        { sessionAdapter: createAuthenticatedSessionAdapter() }
      );
      await awaitSignedIn();

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole('button', { name: /verify one/i }));
      await user.click(screen.getByRole('button', { name: /verify one/i }));
      expect(screen.getByTestId('verified-count')).toHaveTextContent('2');

      await advanceIdlePeriod();
      await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());

      // The SAME packer signs back in, so this is a resume of their own box.
      await user.type(screen.getByLabelText(/username/i), 'marta');
      await user.type(screen.getByLabelText(/password/i), 'whatever-the-mock-accepts');
      await user.click(screen.getByRole('button', { name: /^sign in$/i }));

      await waitFor(() =>
        expect(screen.queryByTestId('bench-locked')).not.toBeInTheDocument()
      );
      // Landed back on exactly the same body, in exactly the same state —
      // never reset to a fresh worklist or a zeroed counter.
      expect(screen.getByTestId('secret-order-ref')).toBeInTheDocument();
      expect(screen.getByTestId('verified-count')).toHaveTextContent('2');
    });
  });
});
