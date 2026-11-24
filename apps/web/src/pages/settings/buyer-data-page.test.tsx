/**
 * Buyer data settings page (#4289)
 *
 * Pins: admin-only; off by default and says so; the defaults note names the
 * scope; the master switch stays locked until a trial run; enabling asks for
 * confirmation and writes the four knobs; connections with own rules are listed.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BuyerDataPage } from './buyer-data-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../test/test-utils';
import type { SessionUser } from '../../shared/auth/session.types';
import type { Connection } from '../../features/connections';

const ADMIN: SessionUser = {
  id: 'user_1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['orders:read', 'orders:write', 'connections:write'],
  analyticsConsent: true,
};

const OPERATOR: SessionUser = {
  ...ADMIN,
  id: 'u2',
  role: 'operator',
  permissions: ['connections:read'],
};

const SHOP: Connection = { ...sampleConnection, id: 'conn-shop', name: 'Shop', config: {} };
const ALLEGRO: Connection = {
  ...sampleConnection,
  id: 'conn-allegro',
  name: 'Allegro',
  config: { buyerDataRetention: { hideAfterDays: 0 } },
};

function settingsView(overrides: Record<string, unknown> = {}): unknown {
  return {
    buyerDataRetentionEnabled: { value: false, source: 'default', workerMayDiffer: false },
    buyerDataHideAfterDays: { value: 90, source: 'setting', workerMayDiffer: false },
    buyerDataEraseAfterDays: { value: 730, source: 'setting', workerMayDiffer: false },
    buyerDataEraseMode: { value: 'personal-data', source: 'default', workerMayDiffer: false },
    ...overrides,
  };
}

function render(opts: { view?: unknown; user?: SessionUser } = {}): { update: Mock } {
  const update = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<BuyerDataPage />, {
    apiClient: createMockApiClient({
      operationalSettings: {
        get: vi.fn().mockResolvedValue(opts.view ?? settingsView()),
        update: update as never,
      },
      connections: { list: vi.fn().mockResolvedValue([SHOP, ALLEGRO]) },
    }),
    sessionAdapter: createAuthenticatedSessionAdapter(opts.user ?? ADMIN),
  });
  return { update };
}

afterEach(cleanup);

describe('BuyerDataPage (#4289)', () => {
  it('should state the page is admin-only without connections:write', async () => {
    render({ user: OPERATOR });
    expect(
      await screen.findByText('Only an administrator can change the buyer data rules.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('buyer-data-page')).not.toBeInTheDocument();
  });

  it('should say these are defaults and that the rules are off', async () => {
    render();
    expect(await screen.findByText('These are default settings')).toBeInTheDocument();
    expect(
      screen.getByText(/Every new connection and every connection without its own rules/)
    ).toBeInTheDocument();
    expect(screen.getByTestId('buyer-data-off-note')).toHaveTextContent(
      'Nothing changes until you turn the rules on'
    );
  });

  it('should keep the switch locked until a trial run, then confirm before saving the knobs', async () => {
    const { update } = render();

    const toggle = await screen.findByTestId('buyer-data-master-switch');
    expect(toggle).toBeDisabled();

    await userEvent.click(screen.getByTestId('buyer-data-trial-run'));
    expect(await screen.findByTestId('buyer-data-trial-result')).toBeInTheDocument();
    await waitFor(() => expect(toggle).toBeEnabled());

    await userEvent.click(toggle);
    await userEvent.click(screen.getByTestId('buyer-data-save'));
    const dialog = await screen.findByRole('dialog');
    expect(update).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        buyerDataRetentionEnabled: true,
        buyerDataHideAfterDays: 90,
        buyerDataEraseAfterDays: 730,
        buyerDataEraseMode: 'personal-data',
      })
    );
  });

  it('should list connections and mark the one with its own rules', async () => {
    render();
    const table = await screen.findByTestId('buyer-data-connections');
    expect(within(table).getByText('Own')).toBeInTheDocument();
    expect(within(table).getByText('Same as general')).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 of 2 connections have their own rules. You change them in the connection edit.'
      )
    ).toBeInTheDocument();
  });

  it('should disable saving while the erase period is shorter than the hide period', async () => {
    render({
      view: settingsView({
        buyerDataHideAfterDays: { value: 365, source: 'setting', workerMayDiffer: false },
        buyerDataEraseAfterDays: { value: 90, source: 'setting', workerMayDiffer: false },
      }),
    });
    expect(
      await screen.findByText('Personal data cannot be erased before the order is hidden.')
    ).toBeInTheDocument();
    expect(screen.getByTestId('buyer-data-save')).toBeDisabled();
  });
});
