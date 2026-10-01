/**
 * `OrderColumnPresetManager` unit tests (#3530, D32, #3507 PR 7).
 *
 * Pins: one list in table order (ticked columns first with up/down, hidden
 * ones after, unticked), ticking/unticking moves a column between the two,
 * reordering swaps two ticked entries, "Save as preset" reveals a named row
 * and the saved preset becomes the selected one, a presets read that fails
 * says so, deleting a preset asks first, an admin sees "Set as workspace
 * default" and a non-admin does not, and a foreign-vocabulary id already in
 * `columns` (the export's ids) survives a toggle untouched.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderColumnPresetManager } from './order-column-preset-manager';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';
import type { OrderColumnPreset } from '../api/orders.types';

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

function preset(id: string, name: string, columns: string[]): OrderColumnPreset {
  return { id, userId: 'user-1', name, columns, createdAt: '', updatedAt: '' };
}

interface RenderOptions {
  user?: SessionUser;
  presets?: OrderColumnPreset[] | Error;
}

function renderManager(columns: string[], onColumnsChange = vi.fn(), options: RenderOptions = {}) {
  const user = options.user ?? OPERATOR;
  let stored: OrderColumnPreset[] = options.presets instanceof Error ? [] : (options.presets ?? []);
  const orders = {
    listColumnPresets:
      options.presets instanceof Error
        ? vi.fn().mockRejectedValue(options.presets)
        : vi.fn(() => Promise.resolve(stored)),
    createColumnPreset: vi.fn((name: string, cols: string[]) => {
      const created = preset('preset-new', name, cols);
      stored = [...stored, created];
      return Promise.resolve(created);
    }),
    deleteColumnPreset: vi.fn((id: string) => {
      stored = stored.filter((p) => p.id !== id);
      return Promise.resolve();
    }),
    setWorkspaceDefaultColumnPreset: vi.fn().mockResolvedValue(preset('wsdefault', 'Workspace default', columns)),
  };
  const api = createMockApiClient({ orders });
  renderWithProviders(
    <OrderColumnPresetManager availableColumns={AVAILABLE} columns={columns} onColumnsChange={onColumnsChange} />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(user) },
  );
  return { orders, onColumnsChange };
}

const list = (): HTMLElement => screen.getByRole('list', { name: 'Columns, in table order' });

afterEach(cleanup);

describe('OrderColumnPresetManager (#3530, D32, #3507 PR 7)', () => {
  it('lists ticked columns in order, then the hidden ones unticked at the end', async () => {
    renderManager(['b', 'a']);

    const items = within(await screen.findByRole('list', { name: 'Columns, in table order' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent?.replace(/[↑↓]/g, ''))).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(within(items[0]).getByRole('checkbox')).toBeChecked();
    expect(within(items[2]).getByRole('checkbox')).not.toBeChecked();
    // Hidden columns carry no reorder arrows — their position is "after the ticked ones".
    expect(within(items[2]).queryByRole('button')).toBeNull();
  });

  it('unticks a visible column and ticks a hidden one (appended)', async () => {
    const { onColumnsChange } = renderManager(['a', 'b']);
    const user = userEvent.setup();

    await user.click(within(list()).getByRole('checkbox', { name: 'Alpha' }));
    expect(onColumnsChange).toHaveBeenCalledWith(['b']);

    onColumnsChange.mockClear();
    await user.click(within(list()).getByRole('checkbox', { name: 'Gamma' }));
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

  it("preserves a foreign-vocabulary id (e.g. an export column id inside the list's manager) across a toggle", async () => {
    const { onColumnsChange } = renderManager(['a', 'orderNumber']);
    const user = userEvent.setup();

    await user.click(within(list()).getByRole('checkbox', { name: 'Beta' }));

    const lastCall = onColumnsChange.mock.calls.at(-1)?.[0] as string[];
    expect(lastCall).toEqual(['a', 'b', 'orderNumber']);
  });

  it('saves the current columns as a named preset and selects the new preset', async () => {
    const { orders } = renderManager(['a', 'b']);
    const user = userEvent.setup();

    expect(screen.queryByPlaceholderText('Preset name')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save as preset' }));
    await user.type(screen.getByRole('textbox', { name: 'Preset name' }), 'My layout');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(orders.createColumnPreset).toHaveBeenCalledWith('My layout', ['a', 'b']);
    });
    const select = screen.getByRole('combobox', { name: 'Preset' });
    await waitFor(() => { expect(select).toHaveValue('preset-new'); });
    expect(within(select).getByRole('option', { name: 'My layout' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Preset name' })).toBeNull();
  });

  it('says so when the saved presets cannot be loaded', async () => {
    renderManager(['a'], vi.fn(), { presets: new Error('Not Found') });

    expect(await screen.findByText('Saved presets could not be loaded.')).toBeInTheDocument();
  });

  it('asks before deleting a preset, and deletes only on confirm', async () => {
    const { orders, onColumnsChange } = renderManager(['a'], vi.fn(), {
      presets: [preset('p1', 'Packing view', ['b'])],
    });
    const user = userEvent.setup();

    const select = screen.getByRole('combobox', { name: 'Preset' });
    await screen.findByRole('option', { name: 'Packing view' });
    await user.selectOptions(select, 'p1');
    expect(onColumnsChange).toHaveBeenCalledWith(['b']);

    await user.click(screen.getByRole('button', { name: 'Delete preset' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this preset?' });
    expect(orders.deleteColumnPreset).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Delete preset' }));
    await waitFor(() => { expect(orders.deleteColumnPreset).toHaveBeenCalledWith('p1'); });
    await waitFor(() => { expect(select).toHaveValue(''); });
  });

  it('offers "Set as workspace default" to an admin only', async () => {
    const admin: SessionUser = { ...OPERATOR, role: 'admin', permissions: [] };
    renderManager(['a'], vi.fn(), { user: admin });
    expect(await screen.findByRole('button', { name: 'Set as workspace default' })).toBeInTheDocument();

    cleanup();
    renderManager(['a'], vi.fn(), { user: OPERATOR });
    await screen.findByRole('list', { name: 'Columns, in table order' });
    expect(screen.queryByRole('button', { name: 'Set as workspace default' })).toBeNull();
  });
});
