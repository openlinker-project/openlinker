/**
 * PrestashopCredentialsPanel Tests
 *
 * Localized regression coverage for the rotate-webservice-key flow that
 * was previously inlined in `EditConnectionForm`. The form-level test
 * still exercises the full mount path via the plugin slot; these tests
 * pin the plugin's own surface so future refactors land here first.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { PrestashopCredentialsPanel } from './prestashop-credentials-panel';

describe('PrestashopCredentialsPanel', () => {
  afterEach(cleanup);

  it('renders the rotate affordance for a credentials-backed connection', () => {
    renderWithProviders(<PrestashopCredentialsPanel connection={sampleConnection} />);
    expect(screen.getByText('Rotate webservice key')).toBeInTheDocument();
  });

  it('falls back to the env-var disabled input when credentialsBacked=false', () => {
    const envBackedConnection = { ...sampleConnection, credentialsBacked: false };
    renderWithProviders(<PrestashopCredentialsPanel connection={envBackedConnection} />);
    expect(
      screen.getByDisplayValue('Environment variable (not editable via UI)'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });

  it('sends the rotated key as `webserviceApiKey` and surfaces a success toast', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      connections: { updateCredentials },
    });
    renderWithProviders(<PrestashopCredentialsPanel connection={sampleConnection} />, {
      apiClient,
    });

    fireEvent.click(screen.getByText('Rotate webservice key'));
    const newKeyInput = screen.getByPlaceholderText('New webservice key');
    fireEvent.change(newKeyInput, { target: { value: 'new-secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new key' }));

    await waitFor(() => {
      expect(updateCredentials).toHaveBeenCalledWith(sampleConnection.id, {
        webserviceApiKey: 'new-secret-key',
      });
    });
    expect(await findToastTitle('Credentials rotated')).toBeInTheDocument();
  });

  it('disables save while the rotate input is empty and while the mutation is pending', () => {
    renderWithProviders(<PrestashopCredentialsPanel connection={sampleConnection} />);
    fireEvent.click(screen.getByText('Rotate webservice key'));
    expect(screen.getByRole('button', { name: 'Save new key' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('New webservice key'), {
      target: { value: 'k' },
    });
    expect(screen.getByRole('button', { name: 'Save new key' })).toBeEnabled();
  });
});
