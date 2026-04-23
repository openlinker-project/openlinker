import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { AllegroSetupForm } from './AllegroSetupForm';

// Allegro tests use an empty connection list so no ProductMaster auto-select
// fires — auto-selecting the default sampleConnection (id="conn_1") would make
// the UUID validator on masterCatalogConnectionId trip the Next button on
// step 3.
function defaultApiClient(
  overrides: Parameters<typeof createMockApiClient>[0] = {},
): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    ...overrides,
    connections: {
      list: vi.fn().mockResolvedValue([]),
      ...overrides.connections,
    },
  });
}

function fillCredentialsStep(
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

async function advanceOneStep(container: HTMLElement, expectedStepLabel: string): Promise<void> {
  fireEvent.click(within(container).getByRole('button', { name: 'Next' }));
  await within(container).findByText(expectedStepLabel, { selector: '[aria-current="step"] .setup-stepper__label' });
}

describe('AllegroSetupForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(cleanup);

  it('renders the "Before you start" info callout on step 1', () => {
    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient: defaultApiClient() });
    const scope = within(container);

    expect(scope.getByText(/before you start/i)).toBeInTheDocument();
    expect(scope.getByRole('link', { name: /allegro developer portal/i })).toHaveAttribute(
      'href',
      'https://developer.allegro.pl/',
    );
    // Redirect URI is rendered inside an inline .mono-text span; simplest
    // cross-node substring assertion is on container.textContent.
    expect(container.textContent).toContain('/integrations/allegro/connect/callback');
  });

  it('renders the credentials step fields first', () => {
    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient: defaultApiClient() });
    const scope = within(container);

    expect(scope.getByLabelText(/connection name/i)).toBeInTheDocument();
    expect(scope.getByLabelText(/client id/i)).toBeInTheDocument();
    expect(scope.getByLabelText(/client secret/i)).toBeInTheDocument();
    // Environment belongs to step 2, not the first step
    expect(scope.queryByLabelText(/environment/i)).toBeNull();
  });

  it('advances through every step and reveals the environment and catalog inputs', async () => {
    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient: defaultApiClient() });
    fillCredentialsStep(container);

    await advanceOneStep(container, 'Environment');
    expect(within(container).getByLabelText(/environment/i)).toBeInTheDocument();

    await advanceOneStep(container, 'Product catalog');
    expect(within(container).getByLabelText(/product catalog connection/i)).toBeInTheDocument();

    await advanceOneStep(container, 'Review & connect');
    expect(
      within(container).getByRole('button', { name: /connect with allegro/i }),
    ).toBeInTheDocument();
  });

  it('disables submit button while mutation is pending', async () => {
    const apiClient = defaultApiClient({
      allegro: { startOAuth: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient });

    fillCredentialsStep(container);
    await advanceOneStep(container, 'Environment');
    await advanceOneStep(container, 'Product catalog');
    await advanceOneStep(container, 'Review & connect');
    fireEvent.click(within(container).getByRole('button', { name: /connect with allegro/i }));

    expect(
      await within(container).findByRole('button', { name: /connecting/i }),
    ).toBeDisabled();
  });

  it('shows API error when mutation fails', async () => {
    const apiClient = defaultApiClient({
      allegro: { startOAuth: vi.fn().mockRejectedValue(new Error('Invalid client credentials')) },
    });
    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient });

    fillCredentialsStep(container);
    await advanceOneStep(container, 'Environment');
    await advanceOneStep(container, 'Product catalog');
    await advanceOneStep(container, 'Review & connect');
    fireEvent.click(within(container).getByRole('button', { name: /connect with allegro/i }));

    expect(await screen.findByText('Invalid client credentials')).toBeInTheDocument();
  });

  it('calls startOAuth with correct input on valid submission', async () => {
    const startOAuth = vi.fn().mockResolvedValue({
      authorizationUrl: 'https://allegro.pl/auth',
      state: 'abc123',
    });
    const apiClient = defaultApiClient({ allegro: { startOAuth } });
    vi.stubGlobal('location', { origin: 'http://localhost:5173', assign: vi.fn() });

    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient });
    fillCredentialsStep(container);
    await advanceOneStep(container, 'Environment');
    await advanceOneStep(container, 'Product catalog');
    await advanceOneStep(container, 'Review & connect');
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
    const apiClient = defaultApiClient({
      allegro: {
        startOAuth: vi.fn().mockResolvedValue({
          authorizationUrl: 'https://allegro.pl/auth?state=y',
          state: 'y',
        }),
      },
    });

    const { container } = renderWithProviders(<AllegroSetupForm />, { apiClient });
    fillCredentialsStep(container);
    await advanceOneStep(container, 'Environment');
    await advanceOneStep(container, 'Product catalog');
    await advanceOneStep(container, 'Review & connect');
    fireEvent.click(within(container).getByRole('button', { name: /connect with allegro/i }));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith('https://allegro.pl/auth?state=y');
    });
  });
});
