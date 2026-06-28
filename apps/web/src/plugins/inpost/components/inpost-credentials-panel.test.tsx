/**
 * InpostCredentialsPanel Tests (#771)
 *
 * Pins the enter/rotate-API-token flow for the InPost plugin's own surface:
 * the rotate affordance, the env-var fallback, the `{ apiToken }` mutation
 * body, and the empty-input disable gate. Mirrors the PrestaShop / DPD panel
 * tests.
 *
 * @module plugins/inpost/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { InpostCredentialsPanel } from './inpost-credentials-panel';

describe('InpostCredentialsPanel', () => {
  afterEach(cleanup);

  it('renders the rotate affordance for a credentials-backed connection', () => {
    renderWithProviders(<InpostCredentialsPanel connection={sampleConnection} />);
    expect(screen.getByText('Rotate API token')).toBeInTheDocument();
  });

  it('falls back to the env-var disabled input when credentialsBacked=false', () => {
    const envBackedConnection = { ...sampleConnection, credentialsBacked: false };
    renderWithProviders(<InpostCredentialsPanel connection={envBackedConnection} />);
    expect(
      screen.getByDisplayValue('Environment variable (not editable via UI)'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });

  it('sends the rotated token as `apiToken` and surfaces a success toast', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      connections: { updateCredentials },
    });
    renderWithProviders(<InpostCredentialsPanel connection={sampleConnection} />, {
      apiClient,
    });

    fireEvent.click(screen.getByText('Rotate API token'));
    fireEvent.change(screen.getByPlaceholderText('New ShipX API token'), {
      target: { value: 'shipx-token-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new token' }));

    await waitFor(() => {
      expect(updateCredentials).toHaveBeenCalledWith(sampleConnection.id, {
        apiToken: 'shipx-token-123',
      });
    });
    expect(await findToastTitle('Credentials rotated')).toBeInTheDocument();
  });

  it('disables save while the rotate input is empty', () => {
    renderWithProviders(<InpostCredentialsPanel connection={sampleConnection} />);
    fireEvent.click(screen.getByText('Rotate API token'));
    expect(screen.getByRole('button', { name: 'Save new token' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('New ShipX API token'), {
      target: { value: 't' },
    });
    expect(screen.getByRole('button', { name: 'Save new token' })).toBeEnabled();
  });
});
