/**
 * InfaktCredentialsPanel Tests
 *
 * Coverage for the rotate-API-key flow for inFakt connections. inFakt carries
 * a single `apiKey` credential, so the panel rotates one field. Mirrors
 * `erli-credentials-panel.test.tsx`.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { InfaktCredentialsPanel } from './infakt-credentials-panel';

const infaktConnection = { ...sampleConnection, platformType: 'infakt' };

describe('InfaktCredentialsPanel', () => {
  afterEach(cleanup);

  it('renders the rotate affordance for a credentials-backed connection', () => {
    renderWithProviders(<InfaktCredentialsPanel connection={infaktConnection} />);
    expect(screen.getByText('Rotate API key')).toBeInTheDocument();
  });

  it('falls back to the env-var disabled input when credentialsBacked=false', () => {
    const envBacked = { ...infaktConnection, credentialsBacked: false };
    renderWithProviders(<InfaktCredentialsPanel connection={envBacked} />);
    expect(
      screen.getByDisplayValue('Environment variable (not editable via UI)'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });

  it('sends the new apiKey and surfaces a success toast', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ connections: { updateCredentials } });
    renderWithProviders(<InfaktCredentialsPanel connection={infaktConnection} />, { apiClient });

    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.change(screen.getByPlaceholderText('New API key'), {
      target: { value: 'sk_new_456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new API key' }));

    await waitFor(() => {
      expect(updateCredentials).toHaveBeenCalledWith(infaktConnection.id, { apiKey: 'sk_new_456' });
    });
    expect(await findToastTitle('Credentials rotated')).toBeInTheDocument();
  });

  it('disables save while the field is empty', () => {
    renderWithProviders(<InfaktCredentialsPanel connection={infaktConnection} />);
    fireEvent.click(screen.getByText('Rotate API key'));
    expect(screen.getByRole('button', { name: 'Save new API key' })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('New API key'), {
      target: { value: 'sk_new_456' },
    });
    expect(screen.getByRole('button', { name: 'Save new API key' })).toBeEnabled();
  });

  it('collapses the form after a successful save', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ connections: { updateCredentials } });
    renderWithProviders(<InfaktCredentialsPanel connection={infaktConnection} />, { apiClient });

    fireEvent.click(screen.getByText('Rotate API key'));
    fireEvent.change(screen.getByPlaceholderText('New API key'), {
      target: { value: 'sk_new_456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new API key' }));

    await waitFor(() => {
      expect(screen.getByText('Rotate API key')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('New API key')).not.toBeInTheDocument();
    });
  });
});
