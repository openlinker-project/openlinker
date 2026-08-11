import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionCell } from './ConnectionCell';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

const CONNECTION_ID = 'aa966882-0d21-4e2f-9d5a-71c4a5f14cfb';

function mockConnection(overrides: Partial<{ name: string }> = {}): {
  id: string;
  name: string;
  platformType: string;
  status: 'active';
  config: Record<string, never>;
  credentialsBacked: boolean;
  enabledCapabilities: never[];
  supportedCapabilities: never[];
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: CONNECTION_ID,
    name: overrides.name ?? 'Erli Demo',
    platformType: 'erli',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
  };
}

describe('ConnectionCell', () => {
  afterEach(cleanup);

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

  it('copies the full connection id when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const api = createMockApiClient({
      connections: { getById: vi.fn().mockResolvedValue(mockConnection()) },
    });

    const { container } = renderWithProviders(<ConnectionCell connectionId={CONNECTION_ID} />, {
      apiClient: api,
    });

    await screen.findByRole('link', { name: 'Erli Demo' });

    // `EntityLabel` always renders its own Copy button too (suppressed only
    // by CSS, which jsdom doesn't apply) — scope to the `CopyableId` line so
    // this exercises the cell's intended, hover-revealed copy control.
    const copyableId = container.querySelector('.copyable-id');
    expect(copyableId).not.toBeNull();
    const copyButton = within(copyableId as HTMLElement).getByRole('button', {
      name: `Copy ${CONNECTION_ID}`,
    });

    fireEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(CONNECTION_ID);
    expect(
      await within(copyableId as HTMLElement).findByRole('button', {
        name: `Copied ${CONNECTION_ID}`,
      }),
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

  it('renders nothing when connectionId is empty', () => {
    const api = createMockApiClient({
      connections: { getById: vi.fn() },
    });

    const { container } = renderWithProviders(<ConnectionCell connectionId="" />, {
      apiClient: api,
    });

    expect(container.querySelector('.connection-cell')).toBeNull();
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
