/**
 * Bench surface behaviour (#2413, stories A2 / A3 / A4)
 *
 * The three acceptance criteria that are properties of a MOUNTED surface, each
 * asserted against a real render rather than against a decorator or a comment:
 *
 *  - **A4** the signed-in name is visible with no interaction;
 *  - **A3** the idle lock reveals nothing about the order, and discards nothing;
 *  - **A2** a handover clears the outgoing session and keeps progress.
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
import type { Session } from '../../../shared/auth/session.types';
import { useSession } from '../../../shared/auth/use-session';
import { useBenchInteractive } from '../hooks/use-bench-interactive';
import { useScannerInput } from '../hooks/use-scanner-input';
import { resetGestureLogForTests } from '../lib/scanner-gesture-log';
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
 * fine for the lock/handover legs (they assert the STATE machine and the
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
 * `BenchIdentityBar` is rendered UNCONDITIONALLY by `BenchSurface`, so
 * `findByTestId('bench-identity-bar')` resolves on the very FIRST render, while
 * the session adapter's promise is still pending. At that moment `signedIn` is
 * false, `useIdleTimeout` is `enabled: false` and no timer exists — so an
 * advance placed after it can be a silent no-op, and the bench then never
 * locks however long the test waits.
 *
 * "Switch packer" is `disabled` exactly while `signedInName === null`, so its
 * becoming enabled IS the session having resolved. (The bar's own text cannot
 * serve as the signal: the signed-OUT copy, "Nobody is signed in", contains
 * "signed in".)
 *
 * The trailing flush is the other half, and it is not decoration. The button
 * turns enabled in the COMMIT that renders the new session, while the hook's
 * `wasSignedIn` transition effect — the one that calls `setState('open')` and
 * re-arms the clock — is a passive effect of that same commit. Return on the
 * rendered attribute alone and a test can click "Switch packer" in the window
 * between the two, and have its `handover` snapped straight back to `open` by
 * an effect that was already queued. So: wait for the render, then let the
 * effects it scheduled run, and only then hand back a settled bench.
 */
async function awaitSignedIn(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /switch packer/i })).toBeEnabled()
  );
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
    for (const char of value) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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
      <BenchSurface idleTimeoutMs={IDLE_TIMEOUT_MS}>
        <ProgressStub />
      </BenchSurface>,
      { sessionAdapter: createAuthenticatedSessionAdapter() }
    );
  }

  it('A4 — shows the signed-in name without any interaction', async () => {
    render();
    const bar = await screen.findByTestId('bench-identity-bar');
    expect(bar).toHaveTextContent(/Signed in/i);
  });

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
      <BenchSurface idleTimeoutMs={IDLE_TIMEOUT_MS}>
        <ScannerStub seen={seen} />
      </BenchSurface>,
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

  it('A2 — a handover asks first, and shows what is already verified', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render();
    await awaitSignedIn();

    await user.click(screen.getByRole('button', { name: /verify one/i }));
    await user.click(screen.getByRole('button', { name: /switch packer/i }));

    const handover = await screen.findByTestId('bench-handover');
    expect(handover).toBeInTheDocument();
    // Unlike the locked state, the handover deliberately leaves the body
    // VISIBLE — spec D13 makes whoever finishes the box the packer of record,
    // so the incoming person must see what they are taking on.
    expect(screen.getByTestId('bench-body')).not.toHaveAttribute('aria-hidden');
    expect(screen.getByTestId('verified-count')).toHaveTextContent('1');
  });

  it('A2 — cancelling a handover leaves the packer signed in', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render();
    await awaitSignedIn();

    await user.click(screen.getByRole('button', { name: /switch packer/i }));
    await screen.findByTestId('bench-handover');
    await user.click(screen.getByRole('button', { name: /stay signed in/i }));

    await waitFor(() => expect(screen.queryByTestId('bench-handover')).not.toBeInTheDocument());
    expect(screen.queryByTestId('bench-locked')).not.toBeInTheDocument();
  });

  it('A3 — a bench abandoned mid-HANDOVER still locks', async () => {
    // One tap of "switch packer" and the incoming person is called away. The
    // outgoing packer is still signed in with a live token, so disarming the
    // idle clock in `handover` would leave an unattended shared terminal signed
    // in indefinitely — the leak A3 exists to close, reachable in one tap.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render();
    await awaitSignedIn();

    await user.click(screen.getByRole('button', { name: /switch packer/i }));
    await screen.findByTestId('bench-handover');

    await advanceIdlePeriod();

    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());
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
      <>
        <SignInTrigger onSignIn={() => adapter.signIn()} />
        <BenchSurface idleTimeoutMs={IDLE_TIMEOUT_MS}>
          <ProgressStub />
        </BenchSurface>
      </>,
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

  it('A2 — confirming a handover clears the outgoing session and keeps progress', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const adapter = createAuthenticatedSessionAdapter();
    const clearSpy = vi.spyOn(adapter, 'clearSession');

    renderWithProviders(
      <BenchSurface idleTimeoutMs={IDLE_TIMEOUT_MS}>
        <ProgressStub />
      </BenchSurface>,
      { sessionAdapter: adapter }
    );
    await awaitSignedIn();

    await user.click(screen.getByRole('button', { name: /verify one/i }));
    await user.click(screen.getByRole('button', { name: /switch packer/i }));
    await screen.findByTestId('bench-handover');
    await user.click(screen.getByRole('button', { name: /sign in as someone else/i }));

    // A "switch packer" that only re-rendered would leave the outgoing token
    // live on a shared browser profile — a real mis-attribution path, and the
    // reason this is asserted on the adapter rather than on the DOM.
    await waitFor(() => expect(clearSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());
    expect(screen.getByTestId('verified-count')).toHaveTextContent('1');
  });
});
