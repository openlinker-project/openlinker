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

  it('should say these are defaults behind a quiet info mark and that the rules are off', async () => {
    render();
    await userEvent.click(
      await screen.findByRole('button', { name: 'These are default settings' })
    );
    expect(
      await screen.findByText(/Every new connection and every one without its own rules/)
    ).toBeInTheDocument();
    expect(screen.getByTestId('buyer-data-untouched')).toHaveTextContent(
      'Data in your shop and marketplace is not changed.'
    );
    expect(screen.getByRole('switch', { name: 'Turn on the rules' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('should put the master switch in the sticky rail and offer a plan summary for phones', async () => {
    render();
    const rail = await screen.findByTestId('retention-rail');
    expect(rail).toContainElement(screen.getByRole('switch', { name: 'Turn on the rules' }));
    expect(rail).toContainElement(await screen.findByTestId('plan-panel'));
    expect(screen.getByTestId('studio-summary')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('studio-summary-open'));
    expect(await screen.findByRole('dialog', { name: 'What will happen' })).toBeInTheDocument();
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
    // Shop follows the defaults and Allegro has own rules without an enabled key:
    // turning the shared switch on reaches both, and the dialog says so.
    expect(dialog).toHaveTextContent('hide 240 orders and erase personal data from 80');
    expect(
      within(screen.getByTestId('enable-dialog-connections')).getByText(/Allegro:/)
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('enable-dialog-connections')).getByText(/Shop:/)
    ).toBeInTheDocument();
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
    // The strip redraws once the connections (and so who follows the defaults) are known.
    await screen.findByTestId('buyer-data-connections');
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
              hideAfterDays: 180,
              eraseAfterDays: 730,
              mode: 'personal-data',
            },
          },
        })
      )
    );
  });

  it('should keep the studio on a connection with its own rules and let it be edited', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { updateConnection } = render();
    await userEvent.click(await screen.findByRole('tab', { name: /Allegro/ }));

    expect(await screen.findByTestId('scope-chain')).toHaveTextContent('Own rules');
    expect(await screen.findByTestId('age-strip-handle-hide')).toBeInTheDocument();
    expect(screen.getByTestId('retention-studio-conn-conn-allegro')).not.toHaveClass(
      'retention-studio--ghost'
    );
    expect(screen.queryByText(/The switch is shared/)).not.toBeInTheDocument();
    expect(
      errors.mock.calls.filter((call) => String(call[0]).includes('cannot be a descendant'))
    ).toHaveLength(0);

    await userEvent.click(screen.getByTestId('buyer-data-save'));
    // Untouched own rules are not a change.
    expect(updateConnection).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('should show the hint and a ghosted studio for a linked connection, in valid DOM', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render();
    await userEvent.click(await screen.findByRole('tab', { name: 'Shop' }));
    expect(await screen.findByText(/The switch is shared/)).toBeInTheDocument();
    expect(screen.getByTestId('retention-studio-conn-conn-shop')).toHaveClass(
      'retention-studio--ghost'
    );
    expect(
      errors.mock.calls.filter((call) => String(call[0]).includes('cannot be a descendant'))
    ).toHaveLength(0);
    errors.mockRestore();
  });

  it('should count only the connections that follow the defaults on the Defaults tab', async () => {
    const preview = vi.fn().mockResolvedValue({
      toHide: 1,
      toErase: 0,
      total: 1,
      totalOrders: 10,
      skippedProtected: 0,
      skippedByReason: { openReturn: 0, hold: 0, invoicePending: 0 },
      samples: [],
    });
    renderWithProviders(<BuyerDataPage />, {
      apiClient: createMockApiClient({
        operationalSettings: { get: vi.fn().mockResolvedValue(settingsView()) },
        connections: { list: vi.fn().mockResolvedValue([SHOP, ALLEGRO]) },
        buyerData: { preview },
      }),
      sessionAdapter: createAuthenticatedSessionAdapter(ADMIN),
    });
    expect(await screen.findByTestId('plan-note')).toHaveTextContent('1');
    await waitFor(() => expect(screen.getByTestId('plan-stays')).toHaveTextContent('9'));
    const scoped = preview.mock.calls.map((c) => (c[0] as { connectionId?: string }).connectionId);
    expect(scoped).toContain('conn-shop');
    expect(scoped).not.toContain('conn-allegro');
    expect(scoped).not.toContain(undefined);
  });

  it('should save unlinked own rules without an enabled key so they inherit the switch', async () => {
    const { updateConnection } = render();
    await userEvent.click(await screen.findByRole('tab', { name: 'Shop' }));
    await userEvent.click(await screen.findByTestId('scope-unlink'));
    await userEvent.click(screen.getByTestId('buyer-data-save'));
    await waitFor(() => expect(updateConnection).toHaveBeenCalled());
    const body = updateConnection.mock.calls[0][1] as {
      config: { buyerDataRetention: Record<string, unknown> };
    };
    expect(body.config.buyerDataRetention).not.toHaveProperty('enabled');
    expect(body.config.buyerDataRetention).toMatchObject({ hideAfterDays: 90 });
  });

  it('should name a connection that stays off when the shared switch is turned on', async () => {
    const stayOff: Connection = {
      ...sampleConnection,
      id: 'conn-off',
      name: 'Muted',
      config: { buyerDataRetention: { enabled: false, hideAfterDays: 90 } },
    };
    renderWithProviders(<BuyerDataPage />, {
      apiClient: createMockApiClient({
        operationalSettings: {
          get: vi.fn().mockResolvedValue(settingsView()),
          update: vi.fn().mockResolvedValue(undefined) as never,
        },
        connections: { list: vi.fn().mockResolvedValue([SHOP, stayOff]) },
      }),
      sessionAdapter: createAuthenticatedSessionAdapter(ADMIN),
    });
    const toggle = await screen.findByRole('switch', { name: 'Turn on the rules' });
    await waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);
    await userEvent.click(screen.getByTestId('buyer-data-save'));
    expect(await screen.findByTestId('enable-dialog-stays-off')).toHaveTextContent('Muted');
  });

  it('should show a connection switched off for itself and turn it back on with one click', async () => {
    const stayOff: Connection = {
      ...sampleConnection,
      id: 'conn-off',
      name: 'Muted',
      config: { buyerDataRetention: { enabled: false, hideAfterDays: 90 } },
    };
    const updateConnection = vi.fn().mockResolvedValue(stayOff);
    renderWithProviders(<BuyerDataPage />, {
      apiClient: createMockApiClient({
        operationalSettings: {
          get: vi.fn().mockResolvedValue(
            settingsView({
              buyerDataRetentionEnabled: { value: true, source: 'setting', workerMayDiffer: false },
            })
          ),
        },
        connections: {
          list: vi.fn().mockResolvedValue([stayOff]),
          update: updateConnection as never,
        },
      }),
      sessionAdapter: createAuthenticatedSessionAdapter(ADMIN),
    });
    await userEvent.click(await screen.findByRole('tab', { name: /Muted/ }));
    expect(await screen.findByTestId('scope-disabled-here')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('scope-enable-here'));
    await userEvent.click(screen.getByTestId('buyer-data-save'));
    // Starting to sweep a connection asks again, with its count.
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn on the rules' })
    );
    await waitFor(() => expect(updateConnection).toHaveBeenCalled());
    const body = updateConnection.mock.calls[0][1] as {
      config: { buyerDataRetention: Record<string, unknown> };
    };
    expect(body.config.buyerDataRetention).not.toHaveProperty('enabled');
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
