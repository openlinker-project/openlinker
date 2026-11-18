import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSearchParams } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api/api-error';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import { ColumnsPanel } from '../components/columns-panel';
import { EditedBar } from '../components/edited-bar';
import { RepairBanner } from '../components/repair-banner';
import { ViewsBar } from '../components/views-bar';
import { testRegistry, type TestRow } from '../lib/saved-views.fixtures';
import type { SavedView } from '../lib/saved-view.types';
import { useListView } from './use-list-view';

const now = '2026-11-18T10:00:00.000Z';
const stored = (overrides: Partial<SavedView> & Pick<SavedView, 'id' | 'name'>): SavedView => ({
  pageKey: 'orders',
  scope: 'personal',
  definition: { v: 1, query: 'source=Allegro', sort: { key: 'total', dir: 'desc' }, columns: ['customer', 'total'], parts: {} },
  revision: 3,
  isDefault: false,
  ownerUserId: 'u1',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

function Harness({ registry = testRegistry }: { registry?: typeof testRegistry }): React.ReactElement {
  const view = useListView<TestRow>({ registry, pageTitle: 'Orders' });
  const [params] = useSearchParams();
  return (
    <div>
      <output data-testid="search">{params.toString()}</output>
      <output data-testid="active">{view.activeView.id}</output>
      <output data-testid="columns">{view.current.columns.join(',')}</output>
      <output data-testid="sort">{`${view.sort.key}:${view.sort.dir}`}</output>
      <output data-testid="ready">{String(view.isReady)}</output>
      <button type="button" onClick={() => view.columnsPanel.onColumnsChange(['total'])}>
        drop-customer
      </button>
      <ViewsBar {...view.viewsBar} />
      {view.editedBar ? <EditedBar {...view.editedBar} /> : null}
      {view.repairBanner ? <RepairBanner {...view.repairBanner} /> : null}
      <ColumnsPanel {...view.columnsPanel} />
    </div>
  );
}

const search = (): URLSearchParams => new URLSearchParams(screen.getByTestId('search').textContent ?? '');
const operator = createAuthenticatedSessionAdapter({
  id: 'user_2',
  username: 'op',
  email: null,
  role: 'operator',
  permissions: [],
});

describe('useListView', () => {
  it('should apply the first built-in view to the address when it carries no state', async () => {
    renderWithProviders(<Harness />, { route: '/orders' });
    await waitFor(() => expect(search().get('view')).toBe('all'));
    expect(search().get('sort')).toBe('created:desc');
    expect(screen.getByTestId('active')).toHaveTextContent('all');
  });

  it('should open the personal default view on load', async () => {
    const apiClient = createMockApiClient({
      savedViews: { list: vi.fn().mockResolvedValue([stored({ id: 'mine', name: 'Allegro', isDefault: true })]) },
    });
    renderWithProviders(<Harness />, { route: '/orders', apiClient });
    await waitFor(() => expect(search().get('view')).toBe('mine'));
    expect(search().get('source')).toBe('Allegro');
    expect(search().get('sort')).toBe('total:desc');
  });

  it('should prefer the personal default over a shared default', async () => {
    const apiClient = createMockApiClient({
      savedViews: {
        list: vi.fn().mockResolvedValue([
          stored({ id: 'shared', name: 'Team', scope: 'shared', isDefault: true, ownerUserId: null }),
          stored({ id: 'mine', name: 'Mine', isDefault: true }),
        ]),
      },
    });
    renderWithProviders(<Harness />, { route: '/orders', apiClient });
    await waitFor(() => expect(search().get('view')).toBe('mine'));
  });

  it('should fall back to the first built-in view when the views cannot be loaded', async () => {
    const apiClient = createMockApiClient({ savedViews: { list: vi.fn().mockRejectedValue(new Error('down')) } });
    renderWithProviders(<Harness />, { route: '/orders', apiClient });
    await waitFor(() => expect(search().get('view')).toBe('all'));
  });

  it('should let a deep link win over the default view', async () => {
    const apiClient = createMockApiClient({
      savedViews: { list: vi.fn().mockResolvedValue([stored({ id: 'mine', name: 'Allegro', isDefault: true })]) },
    });
    renderWithProviders(<Harness />, { route: '/orders?stage=failed', apiClient });
    await screen.findByTestId('ready');
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('attention'));
    expect(search().get('stage')).toBe('failed');
    expect(search().get('source')).toBeNull();
  });

  it('should not report a deep link that matches a built-in view as edited', async () => {
    renderWithProviders(<Harness />, { route: '/orders?stage=failed&sort=created:desc' });
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('attention'));
    expect(screen.queryByRole('group', { name: 'Unsaved view changes' })).toBeNull();
  });

  it('should open the view named in the address and restore its columns', async () => {
    const apiClient = createMockApiClient({
      savedViews: {
        list: vi.fn().mockResolvedValue([
          stored({ id: 'cols', name: 'Cols', definition: { v: 1, query: 'source=Allegro', sort: null, columns: ['tags', 'stock'], parts: {} } }),
        ]),
      },
    });
    renderWithProviders(<Harness />, { route: '/orders?view=cols&source=Allegro', apiClient });
    await waitFor(() => expect(screen.getByTestId('columns')).toHaveTextContent('tags,stock'));
  });

  describe('saving', () => {
    async function setup(apiOverrides: Record<string, unknown> = {}, view: Partial<SavedView> = {}, sessionAdapter = createAuthenticatedSessionAdapter()): Promise<{ update: ReturnType<typeof vi.fn> }> {
      const update = vi.fn().mockResolvedValue(stored({ id: 'mine', name: 'Allegro', revision: 4 }));
      const apiClient = createMockApiClient({
        savedViews: {
          list: vi.fn().mockResolvedValue([stored({ id: 'mine', name: 'Allegro', ...view })]),
          update,
          ...apiOverrides,
        },
      });
      renderWithProviders(<Harness />, {
        route: '/orders?view=mine&source=Allegro&sort=total:desc',
        apiClient,
        sessionAdapter,
      });
      await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('mine'));
      return { update };
    }

    it('should show the Edited bar after a change and clear it on Reset', async () => {
      await setup();
      expect(screen.queryByRole('group', { name: 'Unsaved view changes' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'drop-customer' }));
      expect(await screen.findByRole('group', { name: 'Unsaved view changes' })).toHaveTextContent('Edited · Columns');
      await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await waitFor(() => expect(screen.queryByRole('group', { name: 'Unsaved view changes' })).toBeNull());
      expect(screen.getByTestId('columns')).toHaveTextContent('customer,total');
    });

    it('should send the draft with the revision it was loaded at', async () => {
      const { update } = await setup();
      await userEvent.click(screen.getByRole('button', { name: 'drop-customer' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(update).toHaveBeenCalled());
      expect(update).toHaveBeenCalledWith('mine', {
        definition: expect.objectContaining({ columns: ['total'], query: 'source=Allegro' }),
        expectedRevision: 3,
      });
    });

    it('should tell the operator when someone else saved first', async () => {
      const conflict = new ApiError('conflict', 409, { code: 'SAVED_VIEW_REVISION_CONFLICT' });
      await setup({ update: vi.fn().mockRejectedValue(conflict) });
      await userEvent.click(screen.getByRole('button', { name: 'drop-customer' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
      expect(await screen.findByText(/Someone else changed “Allegro”/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
      // Still edited: nothing was saved.
      expect(screen.getByRole('group', { name: 'Unsaved view changes' })).toBeInTheDocument();
    });

    it('should not let a non-admin overwrite a shared view', async () => {
      await setup({}, { scope: 'shared', ownerUserId: null }, operator);
      await userEvent.click(screen.getByRole('button', { name: 'drop-customer' }));
      expect(await screen.findByRole('button', { name: 'Save as my view…' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    });

    it('should offer an undo when switching away discards edits', async () => {
      await setup();
      await userEvent.click(screen.getByRole('button', { name: 'drop-customer' }));
      await screen.findByRole('group', { name: 'Unsaved view changes' });
      await userEvent.click(screen.getByRole('button', { name: /^All orders/ }));
      expect(await screen.findByText('Discarded your changes to “Allegro”.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('mine'));
      expect(screen.getByTestId('columns')).toHaveTextContent('total');
    });
  });

  describe('a view that references something that was removed', () => {
    const broken = {
      definition: { v: 1 as const, query: 'source=Allegro&retired=1', sort: null, columns: ['customer', 'carrierRef'], parts: {} },
    };

    it('should skip the missing items and say so', async () => {
      const apiClient = createMockApiClient({
        savedViews: { list: vi.fn().mockResolvedValue([stored({ id: 'old', name: 'Old', ...broken })]) },
      });
      renderWithProviders(<Harness />, { route: '/orders?view=old&source=Allegro', apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
      expect(await screen.findByRole('alert')).toHaveTextContent('Column “carrierRef” no longer exists.');
      expect(screen.getByRole('alert')).toHaveTextContent('Filter “retired” no longer exists');
      expect(screen.getByTestId('columns')).toHaveTextContent('customer');
      expect(screen.getByTestId('columns')).not.toHaveTextContent('carrierRef');
    });

    it('should save the repaired view when asked to remove the missing items', async () => {
      const update = vi.fn().mockResolvedValue(stored({ id: 'old', name: 'Old' }));
      const apiClient = createMockApiClient({
        savedViews: { list: vi.fn().mockResolvedValue([stored({ id: 'old', name: 'Old', ...broken })]), update },
      });
      renderWithProviders(<Harness />, { route: '/orders?view=old&source=Allegro', apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
      await userEvent.click(await screen.findByRole('button', { name: 'Remove missing items and save' }));
      await waitFor(() => expect(update).toHaveBeenCalled());
      expect(update).toHaveBeenCalledWith('old', {
        definition: expect.objectContaining({ columns: ['customer'], query: 'source=Allegro' }),
        expectedRevision: 3,
      });
    });

    it('should hide the banner once dismissed', async () => {
      const apiClient = createMockApiClient({
        savedViews: { list: vi.fn().mockResolvedValue([stored({ id: 'old', name: 'Old', ...broken })]) },
      });
      renderWithProviders(<Harness />, { route: '/orders?view=old&source=Allegro', apiClient });
      await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
