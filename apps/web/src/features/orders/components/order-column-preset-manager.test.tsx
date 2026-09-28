/**
 * `OrderColumnPresetManager` unit tests (#3530, D32).
 *
 * Pins: visible columns render in order with Up/Down/Hide, hidden columns
 * render separately with Show, toggling moves a column between the two
 * lists, reordering swaps two visible entries, "Save as preset" calls the
 * create mutation with the CURRENT column list, an admin sees "Set as
 * workspace default" and a non-admin does not, and a foreign-vocabulary id
 * already present in `columns` (e.g. the OTHER surface's ids) survives a
 * toggle untouched.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderColumnPresetManager } from './order-column-preset-manager';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';

const AVAILABLE = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

const OPERATOR: SessionUser = {
  id: 'user-1',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
  analyticsConsent: true,
};

function renderManager(columns: string[], onColumnsChange = vi.fn(), user: SessionUser = OPERATOR) {
  const orders = {
    listColumnPresets: vi.fn().mockResolvedValue([]),
    createColumnPreset: vi.fn().mockResolvedValue({
      id: 'preset-1',
      userId: user.id,
      name: 'Mine',
      columns,
      createdAt: '',
      updatedAt: '',
    }),
    setWorkspaceDefaultColumnPreset: vi.fn().mockResolvedValue({
      id: 'wsdefault',
      userId: null,
      name: 'Workspace default',
      columns,
      createdAt: '',
      updatedAt: '',
    }),
  };
  const api = createMockApiClient({ orders });
  renderWithProviders(
    <OrderColumnPresetManager availableColumns={AVAILABLE} columns={columns} onColumnsChange={onColumnsChange} />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(user) },
  );
  return { orders, onColumnsChange };
}

afterEach(cleanup);

describe('OrderColumnPresetManager (#3530, D32)', () => {
  it('lists visible columns in order and hidden columns separately', async () => {
    renderManager(['b', 'a']);

    await screen.findByText('Visible columns (in order)');
    const visibleList = screen.getByText('Visible columns (in order)').closest('div')?.querySelector('ul');
    expect(visibleList?.textContent).toBe('Beta↑↓HideAlpha↑↓Hide');
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('hides a visible column and shows a hidden one', async () => {
    const { onColumnsChange } = renderManager(['a', 'b']);
    const user = userEvent.setup();

    const alphaRow = screen.getByText('Alpha').closest('li');
    await user.click(alphaRow!.querySelector('button')!.parentElement!.querySelectorAll('button')[2]);
    expect(onColumnsChange).toHaveBeenCalledWith(['b']);

    onColumnsChange.mockClear();
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(onColumnsChange).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('moves a visible column up/down, disabling the boundary directions', async () => {
    const { onColumnsChange } = renderManager(['a', 'b']);
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: 'Move Alpha up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Beta down' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move Beta up' }));
    expect(onColumnsChange).toHaveBeenCalledWith(['b', 'a']);
  });

  it('preserves a foreign-vocabulary id (e.g. an export column id inside the list\'s manager) across a toggle', async () => {
    const { onColumnsChange } = renderManager(['a', 'orderNumber']);
    const user = userEvent.setup();

    // "orderNumber" is not in AVAILABLE, so it never appears as a row, but a
    // toggle on a KNOWN column must not silently drop it from the array.
    await user.click(screen.getByRole('button', { name: 'Show' })); // shows "b" or "c"

    const lastCall = onColumnsChange.mock.calls.at(-1)?.[0] as string[];
    expect(lastCall).toContain('orderNumber');
    expect(lastCall).toContain('a');
  });

  it('saves the current column list as a new preset', async () => {
    const { orders } = renderManager(['a', 'b']);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('New preset name'), 'My layout');
    await user.click(screen.getByRole('button', { name: 'Save as preset' }));

    await waitFor(() => {
      expect(orders.createColumnPreset).toHaveBeenCalledWith('My layout', ['a', 'b']);
    });
  });

  it('offers "Set as workspace default" to an admin only', async () => {
    const admin: SessionUser = { ...OPERATOR, role: 'admin', permissions: [] };
    renderManager(['a'], vi.fn(), admin);
    expect(await screen.findByRole('button', { name: 'Set as workspace default' })).toBeInTheDocument();

    cleanup();
    renderManager(['a'], vi.fn(), OPERATOR);
    await screen.findByText('Visible columns (in order)');
    expect(screen.queryByRole('button', { name: 'Set as workspace default' })).toBeNull();
  });
});
