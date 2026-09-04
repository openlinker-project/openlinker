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

describe('BenchSurface (#2413)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function render(): ReturnType<typeof renderWithProviders> {
    return renderWithProviders(
      <BenchSurface idleTimeoutMs={1000}>
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
    await screen.findByTestId('bench-identity-bar');

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());
  });

  it('A3 — the locked screen reveals nothing about the order', async () => {
    render();
    await screen.findByTestId('bench-identity-bar');

    act(() => {
      vi.advanceTimersByTime(1200);
    });
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
    await screen.findByTestId('bench-identity-bar');

    await user.click(screen.getByRole('button', { name: /verify one/i }));
    await user.click(screen.getByRole('button', { name: /verify one/i }));
    expect(screen.getByTestId('verified-count')).toHaveTextContent('2');

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());

    // Still 2. The bench body was never unmounted.
    expect(screen.getByTestId('verified-count')).toHaveTextContent('2');
  });

  it('A2 — a handover asks first, and shows what is already verified', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render();
    await screen.findByTestId('bench-identity-bar');

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
    await screen.findByTestId('bench-identity-bar');

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
    await screen.findByTestId('bench-identity-bar');

    await user.click(screen.getByRole('button', { name: /switch packer/i }));
    await screen.findByTestId('bench-handover');

    act(() => {
      vi.advanceTimersByTime(1200);
    });

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
    // **A 30-SECOND budget, not the 1s the other tests use.** `useFakeTimers({
    // shouldAdvanceTime: true })` lets fake time run while an `await` is
    // pending, so under full-suite parallelism a slow `user.click` can burn a
    // 1s budget by itself and lock the bench between the sign-in and the
    // assertion. Every lock here is driven by an EXPLICIT advance instead, and
    // the budget is far enough above incidental elapsed time that nothing else
    // can reach it. (Found by the pre-commit run, which is the only place the
    // whole suite competes for the same CPU.)
    const IDLE = 30_000;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const adapter = createSwitchableSessionAdapter(true);
    renderWithProviders(
      <>
        <SignInTrigger onSignIn={() => adapter.signIn()} />
        <BenchSurface idleTimeoutMs={IDLE}>
          <ProgressStub />
        </BenchSurface>
      </>,
      { sessionAdapter: adapter }
    );
    await screen.findByTestId('bench-identity-bar');

    // First lock: the idle hook fires and `lock()` clears the session, so the
    // provider goes anonymous for real.
    act(() => {
      vi.advanceTimersByTime(IDLE + 1000);
    });
    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /sign in as someone$/i }));
    await waitFor(() => expect(screen.queryByTestId('bench-locked')).not.toBeInTheDocument());
    // The incoming packer inherits the parcel, untouched.
    expect(screen.getByTestId('verified-count')).toHaveTextContent('0');

    // Second lock. Without `reset()` the hook stays fired and this never
    // happens: a bench that locks exactly once and then never again, which
    // reads as working.
    act(() => {
      vi.advanceTimersByTime(IDLE + 1000);
    });
    await waitFor(() => expect(screen.getByTestId('bench-locked')).toBeInTheDocument());
  });

  it('A2 — confirming a handover clears the outgoing session and keeps progress', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const adapter = createAuthenticatedSessionAdapter();
    const clearSpy = vi.spyOn(adapter, 'clearSession');

    renderWithProviders(
      <BenchSurface idleTimeoutMs={1000}>
        <ProgressStub />
      </BenchSurface>,
      { sessionAdapter: adapter }
    );
    await screen.findByTestId('bench-identity-bar');

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
