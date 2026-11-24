/**
 * Buyer data settings page (#4289)
 *
 * Pins: admin-only; off by default and says so; the defaults note names the
 * scope; the master switch stays locked until the plan is calculated; enabling
 * asks for confirmation and writes the four knobs; each connection has a tab
 * that links to or breaks from the defaults; connections are compared in a table.
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

function render(opts: { view?: unknown; user?: SessionUser } = {}): {
  update: Mock;
  updateConnection: Mock;
} {
  const update = vi.fn().mockResolvedValue(undefined);
  const updateConnection = vi.fn().mockResolvedValue(SHOP);
  renderWithProviders(<BuyerDataPage />, {
    apiClient: createMockApiClient({
      operationalSettings: {
        get: vi.fn().mockResolvedValue(opts.view ?? settingsView()),
        update: update as never,
      },
      connections: {
        list: vi.fn().mockResolvedValue([SHOP, ALLEGRO]),
        update: updateConnection as never,
      },
    }),
    sessionAdapter: createAuthenticatedSessionAdapter(opts.user ?? ADMIN),
  });
  return { update, updateConnection };
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
      screen.getByText(/Every new connection and every one without its own rules/)
    ).toBeInTheDocument();
    expect(screen.getByTestId('buyer-data-untouched')).toHaveTextContent(
      'Data in your shop and marketplace is not changed.'
    );
    expect(screen.getByRole('switch', { name: 'Turn on the rules' })).toBeDisabled();
  });

  it('should keep the switch locked until the plan is calculated, then confirm before saving the knobs', async () => {
    const { update } = render();

    const toggle = await screen.findByRole('switch', { name: 'Turn on the rules' });
    expect(toggle).toBeDisabled();
    await waitFor(() => expect(toggle).toBeEnabled());

    await userEvent.click(toggle);
    await userEvent.click(screen.getByTestId('buyer-data-save'));
    const dialog = await screen.findByRole('dialog');
    expect(update).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('hide 120 orders and erase personal data from 40');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on the rules' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        buyerDataRetentionEnabled: true,
        buyerDataHideAfterDays: 90,
        buyerDataEraseAfterDays: 730,
        buyerDataEraseMode: 'personal-data',
      })
    );
  });

  it('should save a handle move on the defaults as the new defaults', async () => {
    const { update } = render();
    const hide = await screen.findByTestId('age-strip-handle-hide');
    hide.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.click(screen.getByTestId('buyer-data-save'));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ buyerDataHideAfterDays: 180, buyerDataRetentionEnabled: false })
      )
    );
  });

  it('should show a linked connection ghosted and unlink it when a handle is grabbed', async () => {
    const { updateConnection } = render();
    await userEvent.click(await screen.findByRole('tab', { name: 'Shop' }));

    expect(await screen.findByTestId('scope-chain')).toHaveTextContent('Follows defaults');
    expect(screen.getByTestId('scope-unlink')).toBeInTheDocument();

    const hide = await screen.findByTestId('age-strip-handle-hide');
    hide.focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(screen.getByTestId('scope-chain')).toHaveTextContent('Own rules');
    await userEvent.click(screen.getByTestId('buyer-data-save'));
    await waitFor(() =>
      expect(updateConnection).toHaveBeenCalledWith(
        'conn-shop',
        expect.objectContaining({
          config: {
            buyerDataRetention: {
              enabled: false,
              hideAfterDays: 180,
              eraseAfterDays: 730,
              mode: 'personal-data',
            },
          },
        })
      )
    );
  });

  it('should send a connection back to the defaults with an explicit null', async () => {
    const { updateConnection } = render();
    await userEvent.click(await screen.findByRole('tab', { name: /Allegro/ }));
    await userEvent.click(await screen.findByTestId('scope-relink'));
    expect(screen.getByTestId('scope-chain')).toHaveTextContent('Follows defaults');

    await userEvent.click(screen.getByTestId('buyer-data-save'));
    await waitFor(() =>
      expect(updateConnection).toHaveBeenCalledWith(
        'conn-allegro',
        expect.objectContaining({ config: { buyerDataRetention: null } })
      )
    );
  });

  it('should list connections and mark the one with its own rules', async () => {
    render();
    const table = await screen.findByTestId('buyer-data-connections');
    expect(within(table).getByText('Own')).toBeInTheDocument();
    expect(within(table).getByText('Same as default')).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 of 2 connections have their own rules. Click a connection to see its rules.'
      )
    ).toBeInTheDocument();
    await userEvent.click(within(table).getByRole('button', { name: 'Shop' }));
    expect(await screen.findByTestId('scope-chain')).toBeInTheDocument();
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
