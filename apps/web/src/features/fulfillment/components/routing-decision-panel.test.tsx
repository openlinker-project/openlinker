/**
 * `RoutingDecisionPanel` tests (#3557).
 *
 * Pinned properties: no control ever forces / checks / abandons a decision; the
 * time limit shown is the server's `ttlMs`; Retry routing is offered only on
 * `resolved`, only while the order is held in a retryable state and only to a
 * writer; a failed read is an error, never "nothing"; routing off makes no read.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoutingDecisionPanel } from './routing-decision-panel';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';
import { ApiError } from '../../../shared/api/api-error';
import type { RoutingDecisionStatus } from '../api/fulfillment.types';

const ORDER_ID = 'ol_order_1';

const OPERATOR: SessionUser = {
  id: 'u2',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
};
const VIEWER: SessionUser = {
  id: 'u3',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: ['orders:read'],
};

function decision(overrides: Partial<RoutingDecisionStatus> = {}): RoutingDecisionStatus {
  return {
    decisionId: 'ol_routingdecision_1',
    state: 'live',
    routerConnectionId: 'router-1',
    createdAt: '2026-10-28T08:00:00.000Z',
    ageMs: 3 * 3_600_000 + 42 * 60_000,
    ttlMs: 3_600_000,
    strandedSince: '2026-10-28T09:00:00.000Z',
    abandonReason: null,
    terminalisedAt: null,
    ...overrides,
  };
}

function setup(opts: {
  decision?: RoutingDecisionStatus | null;
  readError?: Error;
  blockReason?: string | null;
  enabled?: boolean;
  user?: SessionUser;
  retry?: ReturnType<typeof vi.fn>;
}) {
  const getRoutingDecision = vi.fn(async () => {
    if (opts.readError) throw opts.readError;
    if (opts.decision === null) throw new ApiError('none', 404, null);
    return opts.decision ?? decision();
  });
  const retryRouting =
    opts.retry ?? vi.fn().mockResolvedValue({ internalOrderId: ORDER_ID, jobId: 'job-1' });
  const api = createMockApiClient({
    fulfillment: { getRoutingDecision } as never,
    orders: { retryRouting } as never,
    connections: {
      getById: vi.fn().mockResolvedValue({ id: 'router-1', name: 'OpenLinker OMS' }),
    } as never,
  });
  renderWithProviders(
    <RoutingDecisionPanel
      internalOrderId={ORDER_ID}
      orderBlockReason={opts.blockReason ?? null}
      enabled={opts.enabled ?? true}
    />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(opts.user ?? OPERATOR) }
  );
  return { getRoutingDecision, retryRouting };
}

afterEach(() => cleanup());

describe('RoutingDecisionPanel', () => {
  it('should show the stuck state with age, the server time limit and the router, and no control', async () => {
    setup({});

    const panel = await screen.findByTestId('routing-decision-panel');
    expect(panel).toHaveAttribute('data-mk-state', 'stuck');
    expect(screen.getByText('Routing is stuck')).toBeInTheDocument();
    expect(screen.getByText(/waiting for that answer/i)).toBeInTheDocument();
    expect(await screen.findByText(/Router: OpenLinker OMS/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for 3h 42m/)).toBeInTheDocument();
    expect(screen.getByText(/time limit 1h 0m/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('should take the time limit from the response, not a constant', async () => {
    setup({ decision: decision({ ttlMs: 7_200_000 }) });

    expect(await screen.findByText(/time limit 2h 0m/)).toBeInTheDocument();
  });

  it('should show the healthy state for a committed decision, with no control', async () => {
    setup({ decision: decision({ state: 'committed', strandedSince: null }) });

    const panel = await screen.findByTestId('routing-decision-panel');
    expect(panel).toHaveAttribute('data-mk-state', 'healthy');
    expect(screen.getByText('Routed automatically')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('should offer Retry routing on resolved and report a started retry', async () => {
    const { retryRouting } = setup({
      decision: decision({ state: 'abandoned', abandonReason: 'stranded-past-ttl' }),
      blockReason: 'routing-refused',
    });

    const panel = await screen.findByTestId('routing-decision-panel');
    expect(panel).toHaveAttribute('data-mk-state', 'resolved');
    await userEvent.click(await screen.findByTestId('routing-decision-retry'));

    await waitFor(() => expect(retryRouting).toHaveBeenCalledWith(ORDER_ID));
  });

  it('should report a refused retry in words, from the 409 code', async () => {
    setup({
      decision: decision({ state: 'abandoned', abandonReason: 'stranded-past-ttl' }),
      blockReason: 'routing-failed',
      retry: vi.fn().mockRejectedValue(new ApiError('internal', 409, { code: 'not-held' })),
    });

    await userEvent.click(await screen.findByTestId('routing-decision-retry'));

    expect(await screen.findByTestId('routing-decision-retry-error')).toHaveTextContent(
      /not waiting on routing/i
    );
  });

  it('should not offer Retry when the order is not held in a retryable state', async () => {
    setup({
      decision: decision({ state: 'abandoned', abandonReason: 'stranded-past-ttl' }),
      blockReason: null,
    });

    await screen.findByTestId('routing-decision-panel');
    expect(screen.queryByTestId('routing-decision-retry')).not.toBeInTheDocument();
  });

  it('should not offer Retry to a read-only user', async () => {
    setup({
      decision: decision({ state: 'abandoned', abandonReason: 'stranded-past-ttl' }),
      blockReason: 'routing-refused',
      user: VIEWER,
    });

    await screen.findByTestId('routing-decision-panel');
    expect(screen.queryByTestId('routing-decision-retry')).not.toBeInTheDocument();
  });

  it('should render nothing for an order with no decision, and for a live one inside its limit', async () => {
    const none = setup({ decision: null });
    await waitFor(() => expect(none.getRoutingDecision).toHaveBeenCalled());
    expect(screen.queryByTestId('routing-decision-panel')).not.toBeInTheDocument();
  });

  it('should render an error, never nothing, when the read fails', async () => {
    setup({ readError: new Error('db down') });

    expect(await screen.findByText(/Could not load the routing status/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('should make no read when routing is not switched on', () => {
    const { getRoutingDecision } = setup({ enabled: false });

    expect(getRoutingDecision).not.toHaveBeenCalled();
    expect(screen.queryByTestId('routing-decision-panel')).not.toBeInTheDocument();
  });
});
