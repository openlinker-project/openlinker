import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { AllegroSetupForm } from './AllegroSetupForm';

function fillForm(
  container: HTMLElement,
  overrides: { name?: string; clientId?: string; clientSecret?: string } = {},
): void {
  const { name = 'Allegro sandbox', clientId = 'test-client-id', clientSecret = 'test-secret' } =
    overrides;
  const scope = within(container);

  fireEvent.change(scope.getByLabelText(/connection name/i), { target: { value: name } });
  fireEvent.change(scope.getByLabelText(/client id/i), { target: { value: clientId } });
  fireEvent.change(scope.getByLabelText(/client secret/i), { target: { value: clientSecret } });
}

describe('AllegroSetupForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders all four form fields', () => {
    const { container } = renderWithProviders(<AllegroSetupForm />);
    const scope = within(container);

    expect(scope.getByLabelText(/connection name/i)).toBeInTheDocument();
    expect(scope.getByLabelText(/environment/i)).toBeInTheDocument();
    expect(scope.getByLabelText(/client id/i)).toBeInTheDocument();
    expect(scope.getByLabelText(/client secret/i)).toBeInTheDocument();
  });

  it('disables submit button while mutation is pending', async () => {
    const apiClient = createMockApiClient({
      allegro: { startOAuth: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient });

    fillForm(container);
    fireEvent.click(within(container).getByRole('button', { name: /connect with allegro/i }));

    expect(
      await within(container).findByRole('button', { name: /connecting/i }),
    ).toBeDisabled();
  });

  it('shows API error when mutation fails', async () => {
    const apiClient = createMockApiClient({
      allegro: { startOAuth: vi.fn().mockRejectedValue(new Error('Invalid client credentials')) },
    });
    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient });

    fillForm(container);
    fireEvent.click(within(container).getByRole('button', { name: /connect with allegro/i }));

    expect(await screen.findByText('Invalid client credentials')).toBeInTheDocument();
  });

  it('calls startOAuth with correct input on valid submission', async () => {
    const startOAuth = vi.fn().mockResolvedValue({
      authorizationUrl: 'https://allegro.pl/auth',
      state: 'abc123',
    });
    const apiClient = createMockApiClient({ allegro: { startOAuth } });
    vi.stubGlobal('location', { origin: 'http://localhost:5173', assign: vi.fn() });

    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient });
    fillForm(container);
    fireEvent.click(within(container).getByRole('button', { name: /connect with allegro/i }));

    await waitFor(() => {
      expect(startOAuth).toHaveBeenCalledWith({
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        redirectUri: 'http://localhost:5173/integrations/allegro/connect/callback',
        environment: 'sandbox',
        connectionName: 'Allegro sandbox',
      });
    });
  });

  it('redirects to authorizationUrl on success', async () => {
    const assignMock = vi.fn();
    vi.stubGlobal('location', { origin: 'http://localhost:5173', assign: assignMock });
    const apiClient = createMockApiClient({
      allegro: {
        startOAuth: vi.fn().mockResolvedValue({
          authorizationUrl: 'https://allegro.pl/auth?state=y',
          state: 'y',
        }),
      },
    });

    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient });
    fillForm(container);
    fireEvent.click(within(container).getByRole('button', { name: /connect with allegro/i }));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith('https://allegro.pl/auth?state=y');
    });
  });
});
