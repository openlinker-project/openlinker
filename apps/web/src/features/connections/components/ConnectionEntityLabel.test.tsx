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
});
