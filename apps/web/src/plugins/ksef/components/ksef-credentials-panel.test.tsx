/**
 * KsefCredentialsPanel Tests
 *
 * Coverage for the write-only rotate-secret flow for KSeF connections. Verifies
 * the env-var fallback, the auth-type + secret payload shape, and that the
 * secret field is rendered write-only (password input).
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { KsefCredentialsPanel } from './ksef-credentials-panel';

describe('KsefCredentialsPanel', () => {
  afterEach(cleanup);

  it('renders the rotate affordance for a credentials-backed connection', () => {
    renderWithProviders(<KsefCredentialsPanel connection={sampleConnection} />);
    expect(screen.getByText('Rotate authentication secret')).toBeInTheDocument();
  });

  it('falls back to the env-var disabled input when credentialsBacked=false', () => {
    const envBacked = { ...sampleConnection, credentialsBacked: false };
    renderWithProviders(<KsefCredentialsPanel connection={envBacked} />);
    expect(
      screen.getByDisplayValue('Environment variable (not editable via UI)'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });

  it('sends authType + secret (write-only) and surfaces a success toast', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ connections: { updateCredentials } });
    renderWithProviders(<KsefCredentialsPanel connection={sampleConnection} />, { apiClient });

    fireEvent.click(screen.getByText('Rotate authentication secret'));
    const secretInput = screen.getByPlaceholderText('New authentication secret');
    expect(secretInput).toHaveAttribute('type', 'password');
    fireEvent.change(secretInput, { target: { value: 'new-token-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new secret' }));

    await waitFor(() => {
      expect(updateCredentials).toHaveBeenCalledWith(sampleConnection.id, {
        authType: 'ksef-token',
        secret: 'new-token-value',
      });
    });
    expect(await findToastTitle('Credentials rotated')).toBeInTheDocument();
  });

  it('disables save while the secret is empty', () => {
    renderWithProviders(<KsefCredentialsPanel connection={sampleConnection} />);
    fireEvent.click(screen.getByText('Rotate authentication secret'));
    expect(screen.getByRole('button', { name: 'Save new secret' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('New authentication secret'), {
      target: { value: 'x' },
    });
    expect(screen.getByRole('button', { name: 'Save new secret' })).toBeEnabled();
  });
});
