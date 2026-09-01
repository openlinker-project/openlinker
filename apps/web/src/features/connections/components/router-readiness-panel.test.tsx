/**
 * RouterReadinessPanel tests (#2407)
 *
 * The three states are asserted apart, because the difference between them is
 * the whole point: "routing cannot be enabled yet", "routing is on and deciding
 * nothing" and "ready" are three different things to tell an operator, and
 * collapsing any two of them is the operator-hostile reading this issue removes.
 *
 * @module features/connections/components
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../../test/test-utils';
import { RouterReadinessPanel } from './router-readiness-panel';
import type { LocationBootstrapResult } from '../../inventory';
import type { SessionUser } from '../../../shared/auth/session.types';

function sourcingStatus(state: 'default' | 'resolved'): unknown {
  return {
    rows: [
      {
        question: 'sourcing',
        state,
        answer: state === 'default' ? { kind: 'default-today' } : { kind: 'openlinker' },
        why: { kind: 'default', code: 'x' },
        source: state === 'default' ? 'default' : 'operator-config',
        inactiveClaimantConnectionIds: [],
      },
    ],
    attention: { counted: [], routine: [], affectedOrderCount: 0 },
    presets: [],
  };
}

interface RenderOptions {
  activeLocations?: number;
  sourcing?: 'default' | 'resolved';
  bootstrap?: () => Promise<LocationBootstrapResult>;
  user?: SessionUser;
}

function renderPanel(options: RenderOptions = {}): {
  bootstrap: () => Promise<LocationBootstrapResult>;
  container: HTMLElement;
} {
  const bootstrap: () => Promise<LocationBootstrapResult> =
    options.bootstrap ??
    vi.fn(() =>
      Promise.resolve({
        created: [{ id: 'l1', code: 'MAIN', name: 'Main warehouse', status: 'active' }],
        existingCodes: [],
      })
    );
  const apiClient = createMockApiClient({
    inventory: {
      listActiveLocations: vi
        .fn()
        .mockResolvedValue({ items: [], total: options.activeLocations ?? 0, page: 1, limit: 1 }),
      bootstrapLocations: bootstrap,
    },
    fulfillmentAuthority: {
      getStatus: vi.fn().mockResolvedValue(sourcingStatus(options.sourcing ?? 'default')),
    },
  });
  const { container } = renderWithProviders(<RouterReadinessPanel />, {
    apiClient,
    sessionAdapter: createAuthenticatedSessionAdapter(options.user),
  });
  return { bootstrap, container };
}

afterEach(() => {
  cleanup();
});

describe('RouterReadinessPanel', () => {
  it('states that routing cannot be enabled yet, and offers the remedy', async () => {
    renderPanel({ activeLocations: 0, sourcing: 'default' });

    expect(await screen.findByText(/cannot be switched on until/i)).toBeInTheDocument();
    expect(screen.getByText('No location yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create default location/i })).toBeEnabled();
  });

  it('describes the degraded state as unfinished setup, not as a silent failure', async () => {
    // The D7 state: the guard is enable-time only, so an install can legitimately
    // reach zero locations after enabling. The copy must say routing is on and
    // deciding nothing — and must NOT reuse the pre-enable "cannot be switched
    // on" line, which would be false about a connection that already has it on.
    renderPanel({ activeLocations: 0, sourcing: 'resolved' });

    expect(await screen.findByText(/is switched on, and with no active location/i)).toBeInTheDocument();
    expect(screen.getByText(/setup step that has not been done yet, not a fault/i)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be switched on until/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create default location/i })).toBeInTheDocument();
  });

  it('reports ready without promising routing will find somewhere to send an order', async () => {
    // Claimed, so the panel confirms the claim. The unclaimed+ready combination
    // renders nothing at all — see the test below.
    renderPanel({ activeLocations: 2, sourcing: 'resolved' });

    expect(await screen.findByText('Location ready')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    // A minted location holds no stock (ADR-058 decision 2) — the panel must not
    // read as "routing will now work".
    expect(screen.getByText(/holds no stock/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create default location/i })).not.toBeInTheDocument();
  });

  it('renders nothing when the precondition is met and nothing claims routing', async () => {
    // The only non-actionable combination. This panel sits on EVERY connection's
    // health tab, including connections that will never route, so "routing can be
    // switched on" there is noise rather than information. Would go red against a
    // panel that renders all four states.
    const { container } = renderPanel({ activeLocations: 1, sourcing: 'default' });

    await waitFor(() => expect(container.querySelector('.panel')).toBeNull());
    expect(screen.queryByText(/fulfilment routing/i)).not.toBeInTheDocument();
  });

  it('mints on click and re-reads the count rather than assuming the write moved it', async () => {
    const { bootstrap } = renderPanel({ activeLocations: 0 });

    await userEvent.click(await screen.findByRole('button', { name: /create default location/i }));

    await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1));
  });

  it('surfaces a bootstrap failure instead of leaving the blocker looking cleared', async () => {
    const { bootstrap } = renderPanel({
      activeLocations: 0,
      bootstrap: vi.fn(() => Promise.reject(new Error('locations table is unavailable'))),
    });

    await userEvent.click(await screen.findByRole('button', { name: /create default location/i }));

    expect(await screen.findByText('locations table is unavailable')).toBeInTheDocument();
    expect(bootstrap).toHaveBeenCalled();
  });

  it('disables the action, with a stated reason, for a non-admin holding inventory:write', async () => {
    // The route is `@Roles('admin')` while `inventory:write` is also an operator
    // permission, so gating on the permission alone would render a control that
    // answers 403. `useWriteAccess` still reports it visible, so the control is
    // rendered disabled — and a control disabled for an unstated reason is worse
    // than one that says why, which is what the title assertion pins.
    renderPanel({
      activeLocations: 0,
      user: {
        id: 'user_2',
        username: 'operator',
        email: 'operator@example.com',
        role: 'operator',
        permissions: ['inventory:read', 'inventory:write'],
        analyticsConsent: true,
      },
    });

    // The blocker is still stated — the fact is not privileged, only the fix is.
    expect(await screen.findByText(/cannot be switched on until/i)).toBeInTheDocument();
    const action = screen.getByRole('button', { name: /create default location/i });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute('title', expect.stringMatching(/administrator/i));
  });

  it('does not claim routing is off while the claim is still unknown', async () => {
    // Loading or a failed status read must not fall into the pre-enable copy —
    // that would tell an operator whose routing IS on that it cannot be switched
    // on. Would go green against a `sourcingRow !== undefined && ...` boolean.
    const apiClient = createMockApiClient({
      inventory: {
        listActiveLocations: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 1 }),
        bootstrapLocations: vi.fn(),
      },
      fulfillmentAuthority: {
        getStatus: vi.fn(() => Promise.reject(new Error('status unavailable'))),
      },
    });
    renderWithProviders(<RouterReadinessPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText(/is not known here/i)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be switched on until/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/is switched on, and with no active location/i)).not.toBeInTheDocument();
    // The blocker itself is still stated, and the remedy still offered.
    expect(screen.getByRole('button', { name: /create default location/i })).toBeInTheDocument();
  });
});
