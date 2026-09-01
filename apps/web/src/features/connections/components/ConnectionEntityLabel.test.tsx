import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionEntityLabel } from './ConnectionEntityLabel';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

describe('ConnectionEntityLabel', () => {
  afterEach(cleanup);

  it('shows a loading placeholder while the connection is fetching', () => {
    const api = createMockApiClient({
      connections: {
        getById: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<ConnectionEntityLabel connectionId="ol_connection_abc" />, {
      apiClient: api,
    });

    expect(screen.getByText('…')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the resolved connection name with a link to the detail page', async () => {
    const api = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue({
          id: 'ol_connection_abc',
          name: 'Allegro sandbox',
          platformType: 'allegro',
          status: 'active',
          config: {},
          credentialsBacked: true,
          enabledCapabilities: [],
          supportedCapabilities: [],
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        }),
      },
    });

    renderWithProviders(<ConnectionEntityLabel connectionId="ol_connection_abc" />, {
      apiClient: api,
    });

    const link = await screen.findByRole('link', { name: 'Allegro sandbox' });
    expect(link).toHaveAttribute('href', '/connections/ol_connection_abc');
  });

  it('renders the caller-supplied name without fetching the connection', async () => {
    const getById = vi.fn();
    const api = createMockApiClient({ connections: { getById } });

    renderWithProviders(
      <ConnectionEntityLabel connectionId="ol_connection_abc" name="Warehouse EU" />,
      { apiClient: api },
    );

    expect(await screen.findByRole('link', { name: 'Warehouse EU' })).toBeInTheDocument();
    expect(getById).not.toHaveBeenCalled();
  });

  it('renders Unknown without fetching when the caller supplies name={null}', () => {
    const getById = vi.fn();
    const api = createMockApiClient({ connections: { getById } });

    renderWithProviders(<ConnectionEntityLabel connectionId="ol_connection_abc" name={null} />, {
      apiClient: api,
    });

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(getById).not.toHaveBeenCalled();
  });

  it('shows a loading placeholder when the caller drives the loading flag', () => {
    const getById = vi.fn();
    const api = createMockApiClient({ connections: { getById } });

    renderWithProviders(
      <ConnectionEntityLabel connectionId="ol_connection_abc" name={null} loading />,
      { apiClient: api },
    );

    expect(screen.getByText('…')).toHaveAttribute('aria-busy', 'true');
    expect(getById).not.toHaveBeenCalled();
  });

  it('falls back to Unknown when the API errors', async () => {
    const api = createMockApiClient({
      connections: {
        getById: vi.fn().mockRejectedValue(new Error('not found')),
      },
    });

    renderWithProviders(<ConnectionEntityLabel connectionId="ol_connection_xyz" />, {
      apiClient: api,
    });

    expect(await screen.findByText('Unknown')).toBeInTheDocument();
  });

  it('renders System without fetching for the all-zero system connection id', () => {
    const getById = vi.fn();
    const api = createMockApiClient({ connections: { getById } });

    renderWithProviders(
      <ConnectionEntityLabel connectionId="00000000-0000-0000-0000-000000000000" />,
      { apiClient: api },
    );

    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(getById).not.toHaveBeenCalled();
  });

  it('renders nothing when connectionId is empty', () => {
    const api = createMockApiClient({
      connections: {
        getById: vi.fn(),
      },
    });

    const { container } = renderWithProviders(<ConnectionEntityLabel connectionId="" />, {
      apiClient: api,
    });

    expect(container.querySelector('.entity-label')).toBeNull();
  });

  it('hides the id when showId={false}', async () => {
    const api = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue({
          id: 'ol_connection_abc',
          name: 'Allegro sandbox',
          platformType: 'allegro',
          status: 'active',
          config: {},
          credentialsBacked: true,
          enabledCapabilities: [],
          supportedCapabilities: [],
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        }),
      },
    });

    renderWithProviders(
      <ConnectionEntityLabel connectionId="ol_connection_abc" showId={false} />,
      { apiClient: api },
    );

    await screen.findByRole('link', { name: 'Allegro sandbox' });
    expect(screen.queryByText(/ol_conne/)).toBeNull();
  });

  it('renders a span (not a link) when linkToDetail={false}', async () => {
    const api = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue({
          id: 'ol_connection_abc',
          name: 'Allegro sandbox',
          platformType: 'allegro',
          status: 'active',
          config: {},
          credentialsBacked: true,
          enabledCapabilities: [],
          supportedCapabilities: [],
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        }),
      },
    });

    renderWithProviders(
      <ConnectionEntityLabel connectionId="ol_connection_abc" linkToDetail={false} />,
      { apiClient: api },
    );

    expect(await screen.findByText('Allegro sandbox')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('drops the link when the current path already matches the connection detail', async () => {
    const api = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue({
          id: 'ol_connection_abc',
          name: 'Allegro sandbox',
          platformType: 'allegro',
          status: 'active',
          config: {},
          credentialsBacked: true,
          enabledCapabilities: [],
          supportedCapabilities: [],
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        }),
      },
    });

    renderWithProviders(<ConnectionEntityLabel connectionId="ol_connection_abc" />, {
      apiClient: api,
      route: '/connections/ol_connection_abc',
    });

    expect(await screen.findByText('Allegro sandbox')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
