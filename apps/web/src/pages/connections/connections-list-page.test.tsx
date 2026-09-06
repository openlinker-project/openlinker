import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthenticatedSessionAdapter, createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ConnectionsListPage } from './connections-list-page';

const captureDemoEvent = vi.fn();
vi.mock('../../features/demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

describe('ConnectionsListPage', () => {
  beforeEach(() => {
    captureDemoEvent.mockClear();
  });
  afterEach(cleanup);

  it('captures demo_connections_filtered when the status filter changes (#1789)', () => {
    renderWithProviders(<ConnectionsListPage />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), {
      target: { value: 'active' },
    });

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_connections_filtered', {
      filter: 'status',
      value: 'active',
    });
  });

  it('renders the page heading', () => {
    renderWithProviders(<ConnectionsListPage />);
    expect(screen.getByRole('heading', { name: 'Connections' })).toBeInTheDocument();
  });

  it('displays connections returned by the API', async () => {
    const apiClient = createMockApiClient({
      connections: { listPaginated: vi.fn().mockResolvedValue({ items: [sampleConnection], total: 1, limit: 20, offset: 0 }) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(await screen.findByText(sampleConnection.name)).toBeInTheDocument();
  });

  describe('pagination (#2937)', () => {
    it('requests limit/offset from the paginated read and renders the page summary', async () => {
      const listPaginated = vi
        .fn()
        .mockResolvedValue({ items: [sampleConnection], total: 45, limit: 20, offset: 0 });
      const apiClient = createMockApiClient({ connections: { listPaginated } });
      renderWithProviders(<ConnectionsListPage />, { apiClient });

      await screen.findByText(sampleConnection.name);

      expect(listPaginated).toHaveBeenCalledWith(expect.anything(), { limit: 20, offset: 0 });
      expect(screen.getByText('Showing 1–20 of 45')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    });

    it('advances the offset param when Next is clicked', async () => {
      const user = userEvent.setup();
      const listPaginated = vi
        .fn()
        .mockResolvedValue({ items: [sampleConnection], total: 45, limit: 20, offset: 0 });
      const apiClient = createMockApiClient({ connections: { listPaginated } });
      renderWithProviders(<ConnectionsListPage />, { apiClient });

      await screen.findByText(sampleConnection.name);
      await user.click(screen.getByRole('button', { name: 'Next' }));

      expect(listPaginated).toHaveBeenLastCalledWith(expect.anything(), { limit: 20, offset: 20 });
    });

    it('disables Next on the final page', async () => {
      const apiClient = createMockApiClient({
        connections: {
          listPaginated: vi
            .fn()
            .mockResolvedValue({ items: [sampleConnection], total: 5, limit: 20, offset: 0 }),
        },
      });
      renderWithProviders(<ConnectionsListPage />, { apiClient });

      await screen.findByText(sampleConnection.name);
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    });
  });

  it('shows loading state while fetching', () => {
    const apiClient = createMockApiClient({
      connections: { listPaginated: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(screen.getByRole('heading', { name: 'Loading connections' })).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    const apiClient = createMockApiClient({
      connections: { listPaginated: vi.fn().mockRejectedValue(new Error('Network error')) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(await screen.findByRole('heading', { name: 'Unable to load connections' })).toBeInTheDocument();
  });

  it('shows empty state with the Add the first connection CTA when no connections exist', async () => {
    const apiClient = createMockApiClient({
      connections: { listPaginated: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
    expect(await screen.findByRole('heading', { name: 'No connections found' })).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Add the first connection' });
    expect(cta).toHaveAttribute('href', '/connections/new');
  });

  it('shows a Clear filters button that clears platform and status params when filters are active', async () => {
    const user = userEvent.setup();
    const apiClient = createMockApiClient({
      connections: { listPaginated: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
    });
    renderWithProviders(<ConnectionsListPage />, {
      apiClient,
      route: '/connections?platformType=allegro&status=active',
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('No connections match the current filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('link', { name: 'Add the first connection' })).toBeInTheDocument();
  });

  it('renders platform and status filter dropdowns', () => {
    renderWithProviders(<ConnectionsListPage />);
    expect(screen.getByRole('combobox', { name: 'Filter by platform' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument();
  });

  describe('demo read-only viewer (#1667)', () => {
    const viewerSession = createAuthenticatedSessionAdapter({
      id: 'u2',
      username: 'viewer',
      email: null,
      role: 'viewer',
      permissions: ['connections:read'],
    });

    function demoApiClient(
      overrides: Parameters<typeof createMockApiClient>[0] = {},
    ): ReturnType<typeof createMockApiClient> {
      return createMockApiClient({
        ...overrides,
        system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) },
      });
    }

    it('renders "New connection" visible and enabled for a demo viewer', async () => {
      renderWithProviders(<ConnectionsListPage />, {
        apiClient: demoApiClient({ connections: { listPaginated: vi.fn().mockResolvedValue({ items: [sampleConnection], total: 1, limit: 20, offset: 0 }) } }),
        sessionAdapter: viewerSession,
      });

      const cta = await screen.findByRole('link', { name: 'New connection' });
      expect(cta).toHaveAttribute('href', '/connections/new');
    });

    it('renders "Add the first connection" visible and enabled for a demo viewer on the empty state', async () => {
      renderWithProviders(<ConnectionsListPage />, {
        apiClient: demoApiClient({ connections: { listPaginated: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) } }),
        sessionAdapter: viewerSession,
      });

      const cta = await screen.findByRole('link', { name: 'Add the first connection' });
      expect(cta).toHaveAttribute('href', '/connections/new');
    });

    it('hides "New connection" for a genuinely unauthorized non-demo viewer', async () => {
      renderWithProviders(<ConnectionsListPage />, {
        apiClient: createMockApiClient({ connections: { listPaginated: vi.fn().mockResolvedValue({ items: [sampleConnection], total: 1, limit: 20, offset: 0 }) } }),
        sessionAdapter: viewerSession,
      });

      await screen.findByText(sampleConnection.name);
      expect(screen.queryByRole('link', { name: 'New connection' })).not.toBeInTheDocument();
    });
  });
});
