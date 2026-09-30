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

  describe('archive / restore row actions (#3657)', () => {
    const adminSession = createAuthenticatedSessionAdapter();

    it('offers Archive only on a disabled row and Restore only on an archived row', async () => {
      const apiClient = createMockApiClient({
        connections: {
          list: vi.fn().mockResolvedValue([
            { ...sampleConnection, id: 'c-active', name: 'Live Shop' },
            { ...sampleConnection, id: 'c-disabled', name: 'Paused Shop', status: 'disabled' },
            { ...sampleConnection, id: 'c-archived', name: 'Old Shop', status: 'archived' },
          ]),
        },
      });
      renderWithProviders(<ConnectionsListPage />, { apiClient, sessionAdapter: adminSession });

      expect(await screen.findAllByRole('button', { name: 'Archive' })).not.toHaveLength(0);
      const pausedRow = (await screen.findAllByText('Paused Shop'))[0].closest('tr');
      const liveRow = screen.getAllByText('Live Shop')[0].closest('tr');
      const oldRow = screen.getAllByText('Old Shop')[0].closest('tr');
      expect(pausedRow?.textContent).toContain('Archive');
      expect(liveRow?.textContent).not.toContain('Archive');
      expect(liveRow?.textContent).not.toContain('Restore');
      expect(oldRow?.textContent).toContain('Restore');
    });

    it('does not open the connection when the row action is clicked', async () => {
      const apiClient = createMockApiClient({
        connections: {
          list: vi
            .fn()
            .mockResolvedValue([{ ...sampleConnection, name: 'Paused Shop', status: 'disabled' }]),
        },
      });
      renderWithProviders(<ConnectionsListPage />, { apiClient, sessionAdapter: adminSession });

      const [archiveButton] = await screen.findAllByRole('button', { name: 'Archive' });
      await userEvent.click(archiveButton);

      expect(
        await screen.findByRole('heading', { name: 'Archive this connection?' })
      ).toBeInTheDocument();
    });

    it('lists archived as a status filter option', () => {
      renderWithProviders(<ConnectionsListPage />);

      expect(screen.getByRole('option', { name: 'archived' })).toBeInTheDocument();
    });

    it('shows no row actions to a session without connections:write', async () => {
      const viewer = createAuthenticatedSessionAdapter({
        id: 'u-viewer',
        username: 'viewer',
        email: null,
        role: 'viewer',
        permissions: ['connections:read'],
      });
      const apiClient = createMockApiClient({
        connections: {
          list: vi
            .fn()
            .mockResolvedValue([{ ...sampleConnection, name: 'Paused Shop', status: 'disabled' }]),
        },
      });
      renderWithProviders(<ConnectionsListPage />, { apiClient, sessionAdapter: viewer });

      expect((await screen.findAllByText('Paused Shop')).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    });
  });

  it('renders the page heading', () => {
    renderWithProviders(<ConnectionsListPage />);
    expect(screen.getByRole('heading', { name: 'Connections' })).toBeInTheDocument();
  });

  it('displays connections returned by the API', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(await screen.findByText(sampleConnection.name)).toBeInTheDocument();
  });

  it('names the platform by its product name, not its raw slug', async () => {
    // The row used to render `connection.platformType` verbatim, so two
    // products sharing a slug prefix (`subiekt-gt` and a future
    // `subiekt-nexo`) were told apart only by whatever name the operator
    // happened to type. The registry already knows the product name.
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([sampleConnection]) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });

    expect(await screen.findByText(/PrestaShop · prestashop\.webservice\.v1/)).toBeInTheDocument();
    expect(screen.queryByText(/^prestashop · /)).not.toBeInTheDocument();
  });

  it('falls back to the raw slug for a platform no plugin declares', async () => {
    // The fallback is deliberately the raw slug rather than a title-cased
    // guess: it only fires on a misconfiguration, and an unresolved
    // identifier should read as one instead of as a plausible brand name.
    const apiClient = createMockApiClient({
      connections: {
        list: vi
          .fn()
          .mockResolvedValue([
            { ...sampleConnection, platformType: 'not-a-real-platform', adapterKey: 'x.v1' },
          ]),
      },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });

    expect(await screen.findByText(/not-a-real-platform · x\.v1/)).toBeInTheDocument();
  });

  it('shows loading state while fetching', () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(screen.getByRole('heading', { name: 'Loading connections' })).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient });
    expect(await screen.findByRole('heading', { name: 'Unable to load connections' })).toBeInTheDocument();
  });

  it('shows empty state with the Add the first connection CTA when no connections exist', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([]) },
    });
    renderWithProviders(<ConnectionsListPage />, { apiClient, sessionAdapter: createAuthenticatedSessionAdapter() });
    expect(await screen.findByRole('heading', { name: 'No connections found' })).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Add the first connection' });
    expect(cta).toHaveAttribute('href', '/connections/new');
  });

  it('shows a Clear filters button that clears platform and status params when filters are active', async () => {
    const user = userEvent.setup();
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([]) },
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
        apiClient: demoApiClient({ connections: { list: vi.fn().mockResolvedValue([sampleConnection]) } }),
        sessionAdapter: viewerSession,
      });

      const cta = await screen.findByRole('link', { name: 'New connection' });
      expect(cta).toHaveAttribute('href', '/connections/new');
    });

    it('renders "Add the first connection" visible and enabled for a demo viewer on the empty state', async () => {
      renderWithProviders(<ConnectionsListPage />, {
        apiClient: demoApiClient({ connections: { list: vi.fn().mockResolvedValue([]) } }),
        sessionAdapter: viewerSession,
      });

      const cta = await screen.findByRole('link', { name: 'Add the first connection' });
      expect(cta).toHaveAttribute('href', '/connections/new');
    });

    it('hides "New connection" for a genuinely unauthorized non-demo viewer', async () => {
      renderWithProviders(<ConnectionsListPage />, {
        apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([sampleConnection]) } }),
        sessionAdapter: viewerSession,
      });

      await screen.findByText(sampleConnection.name);
      expect(screen.queryByRole('link', { name: 'New connection' })).not.toBeInTheDocument();
    });
  });
});
