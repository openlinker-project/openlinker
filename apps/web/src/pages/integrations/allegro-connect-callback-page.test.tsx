import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { ApiError } from '../../shared/api/api-error';
import { AllegroConnectCallbackPage } from './allegro-connect-callback-page';

const CALLBACK_ROUTE = '/integrations/allegro/connect/callback';

describe('AllegroConnectCallbackPage', () => {
  it('shows error state when Allegro returns ?error param', () => {
    renderWithProviders(<AllegroConnectCallbackPage />, {
      route: `${CALLBACK_ROUTE}?error=access_denied`,
    });

    expect(screen.getByRole('heading', { name: 'Authorization denied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start over/i })).toHaveAttribute(
      'href',
      '/connections/new/allegro',
    );
  });

  it('shows error state when code or state params are missing', () => {
    renderWithProviders(<AllegroConnectCallbackPage />, {
      route: `${CALLBACK_ROUTE}?state=abc123`,
    });

    expect(screen.getByRole('heading', { name: 'Invalid callback' })).toBeInTheDocument();
  });

  it('shows loading state while mutation is pending', () => {
    const apiClient = createMockApiClient({
      allegro: { handleCallback: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    renderWithProviders(<AllegroConnectCallbackPage />, {
      apiClient,
      route: `${CALLBACK_ROUTE}?code=auth_code&state=csrf_state`,
    });

    expect(screen.getByRole('heading', { name: 'Completing authorization' })).toBeInTheDocument();
  });

  it('shows success panel with connection details on mutation success', async () => {
    const apiClient = createMockApiClient({
      allegro: {
        handleCallback: vi.fn().mockResolvedValue({
          message: 'Connection created.',
          connectionId: 'conn_allegro_1',
          connectionName: 'Allegro sandbox',
        }),
      },
    });
    renderWithProviders(<AllegroConnectCallbackPage />, {
      apiClient,
      route: `${CALLBACK_ROUTE}?code=auth_code&state=csrf_state`,
    });

    expect(await screen.findByRole('heading', { name: 'Connection created' })).toBeInTheDocument();
    expect(screen.getByText('Allegro sandbox')).toBeInTheDocument();
    expect(screen.getByText('conn_allegro_1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to connection/i })).toHaveAttribute(
      'href',
      '/connections/conn_allegro_1',
    );
  });

  it('shows error state on mutation failure with generic error', async () => {
    const apiClient = createMockApiClient({
      allegro: {
        handleCallback: vi.fn().mockRejectedValue(new Error('Token exchange failed')),
      },
    });
    renderWithProviders(<AllegroConnectCallbackPage />, {
      apiClient,
      route: `${CALLBACK_ROUTE}?code=auth_code&state=some_state`,
    });

    expect(await screen.findByRole('heading', { name: 'Authorization failed' })).toBeInTheDocument();
    expect(screen.getByText('Token exchange failed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /try again/i })).toHaveAttribute(
      'href',
      '/connections/new/allegro',
    );
  });

  it('shows friendly message when OAuth state was already used', async () => {
    const apiClient = createMockApiClient({
      allegro: {
        handleCallback: vi.fn().mockRejectedValue(
          new ApiError('Invalid or expired OAuth state parameter', 400, {
            message: 'Invalid or expired OAuth state parameter',
            code: 'OAUTH_STATE_INVALID',
          }),
        ),
      },
    });
    renderWithProviders(<AllegroConnectCallbackPage />, {
      apiClient,
      route: `${CALLBACK_ROUTE}?code=auth_code&state=expired_state`,
    });

    expect(await screen.findByRole('heading', { name: 'Authorization already completed' })).toBeInTheDocument();
    expect(screen.getByText(/This authorization link was already used/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view connections/i })).toHaveAttribute(
      'href',
      '/connections',
    );
  });
});
