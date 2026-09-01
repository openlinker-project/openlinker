import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionCell } from './ConnectionCell';
import { SYSTEM_CONNECTION_ID, type Connection } from '../api/connections.types';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

const CONNECTION_ID = 'aa966882-0d21-4e2f-9d5a-71c4a5f14cfb';

function mockConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: CONNECTION_ID,
    name: 'Erli Demo',
    platformType: 'erli',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('ConnectionCell', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the connection name as a link to the connection detail page', async () => {
    const api = createMockApiClient({
      connections: { getById: vi.fn().mockResolvedValue(mockConnection()) },
    });

    renderWithProviders(<ConnectionCell connectionId={CONNECTION_ID} />, { apiClient: api });

    const link = await screen.findByRole('link', { name: 'Erli Demo' });
    expect(link).toHaveAttribute('href', `/connections/${CONNECTION_ID}`);
  });

  it('renders the shortened connection id alongside the name', async () => {
    const api = createMockApiClient({
      connections: { getById: vi.fn().mockResolvedValue(mockConnection()) },
    });

    renderWithProviders(<ConnectionCell connectionId={CONNECTION_ID} />, { apiClient: api });

    await screen.findByRole('link', { name: 'Erli Demo' });
    expect(screen.getByText('aa966882…4cfb')).toBeInTheDocument();
  });

  it('uses the page-supplied connection without fetching it', async () => {
    const getById = vi.fn();
    const api = createMockApiClient({ connections: { getById } });

    renderWithProviders(
      <ConnectionCell
        connectionId={CONNECTION_ID}
        connection={{ name: 'Warehouse EU', status: 'active' }}
      />,
      { apiClient: api },
    );

    expect(await screen.findByRole('link', { name: 'Warehouse EU' })).toBeInTheDocument();
    expect(getById).not.toHaveBeenCalled();
  });

  it('surfaces the status note from the page-supplied connection', async () => {
    const getById = vi.fn();
    const api = createMockApiClient({ connections: { getById } });

    renderWithProviders(
      <ConnectionCell
        connectionId={CONNECTION_ID}
        connection={{ name: 'Warehouse EU', status: 'needs_reauth' }}
      />,
      { apiClient: api },
    );

    expect(await screen.findByText('Re-auth')).toBeInTheDocument();
    expect(getById).not.toHaveBeenCalled();
  });

  it('renders Unknown without fetching when the page reports the connection as unknown', () => {
    const getById = vi.fn();
    const api = createMockApiClient({ connections: { getById } });

    renderWithProviders(<ConnectionCell connectionId={CONNECTION_ID} connection={null} />, {
      apiClient: api,
    });

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Re-auth')).toBeNull();
    expect(getById).not.toHaveBeenCalled();
  });

  it('renders the loading state rather than Unknown while the page reports its batch as loading', () => {
    const getById = vi.fn();
    const api = createMockApiClient({ connections: { getById } });

    renderWithProviders(
      <ConnectionCell connectionId={CONNECTION_ID} connection={null} loading />,
      { apiClient: api },
    );

    expect(screen.getByText('…')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Unknown')).toBeNull();
    expect(getById).not.toHaveBeenCalled();
  });

  it('renders the single copy button with a human-readable accessible name', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const api = createMockApiClient({
      connections: { getById: vi.fn().mockResolvedValue(mockConnection()) },
    });

    renderWithProviders(<ConnectionCell connectionId={CONNECTION_ID} />, { apiClient: api });

    await screen.findByRole('link', { name: 'Erli Demo' });

    const copyButtons = screen.getAllByRole('button');
    expect(copyButtons).toHaveLength(1);

    const copyButton = screen.getByRole('button', {
      name: 'Copy connection ID for Erli Demo',
    });
    fireEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(CONNECTION_ID);
    expect(
      await screen.findByRole('button', { name: 'Copied connection ID for Erli Demo' }),
    ).toBeInTheDocument();
  });

  it('shows a loading placeholder while the connection is fetching', () => {
    const api = createMockApiClient({
      connections: { getById: vi.fn().mockReturnValue(new Promise(() => {})) },
    });

    renderWithProviders(<ConnectionCell connectionId={CONNECTION_ID} />, { apiClient: api });

    expect(screen.getByText('…')).toHaveAttribute('aria-busy', 'true');
  });

  it('falls back to Unknown when the connection name cannot be resolved', async () => {
    const api = createMockApiClient({
      connections: { getById: vi.fn().mockRejectedValue(new Error('not found')) },
    });

    renderWithProviders(<ConnectionCell connectionId={CONNECTION_ID} />, { apiClient: api });

    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('aa966882…4cfb')).toBeInTheDocument();
  });

  it('drops the link when the current path already matches the connection', async () => {
    const api = createMockApiClient({
      connections: { getById: vi.fn().mockResolvedValue(mockConnection()) },
    });

    renderWithProviders(<ConnectionCell connectionId={CONNECTION_ID} />, {
      apiClient: api,
      route: `/connections/${CONNECTION_ID}`,
    });

    expect(await screen.findByText('Erli Demo')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Erli Demo' })).toBeNull();
  });

  it('surfaces a status note when the connection needs attention', async () => {
    const api = createMockApiClient({
      connections: {
        getById: vi.fn().mockResolvedValue(mockConnection({ status: 'needs_reauth' })),
      },
    });

    renderWithProviders(<ConnectionCell connectionId={CONNECTION_ID} />, { apiClient: api });

    expect(await screen.findByText('Re-auth')).toBeInTheDocument();
  });

  it('renders no status note for a healthy connection', async () => {
    const api = createMockApiClient({
      connections: { getById: vi.fn().mockResolvedValue(mockConnection()) },
    });

    renderWithProviders(<ConnectionCell connectionId={CONNECTION_ID} />, { apiClient: api });

    await screen.findByRole('link', { name: 'Erli Demo' });
    expect(screen.queryByText('Re-auth')).toBeNull();
    expect(screen.queryByText('Disabled')).toBeNull();
    expect(screen.queryByText('Error')).toBeNull();
  });

  it('renders an empty-value placeholder when connectionId is empty', () => {
    const api = createMockApiClient({ connections: { getById: vi.fn() } });

    renderWithProviders(<ConnectionCell connectionId="" />, { apiClient: api });

    expect(screen.getByLabelText('No value')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders System with no copyable id or status note for the system placeholder id, without fetching', () => {
    const getById = vi.fn();
    const api = createMockApiClient({ connections: { getById } });

    renderWithProviders(<ConnectionCell connectionId={SYSTEM_CONNECTION_ID} />, { apiClient: api });

    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Re-auth')).toBeNull();
    expect(getById).not.toHaveBeenCalled();
  });

  it('renders an adornment when provided', async () => {
    const api = createMockApiClient({
      connections: { getById: vi.fn().mockResolvedValue(mockConnection()) },
    });

    renderWithProviders(
      <ConnectionCell connectionId={CONNECTION_ID} adornment={<span>pill</span>} />,
      { apiClient: api },
    );

    await screen.findByRole('link', { name: 'Erli Demo' });
    expect(screen.getByText('pill')).toBeInTheDocument();
  });
});
