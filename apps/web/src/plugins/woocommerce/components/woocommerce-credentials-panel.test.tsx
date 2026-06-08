/**
 * WooCommerceCredentialsPanel Tests
 *
 * Coverage for the rotate-API-credentials flow for WooCommerce connections.
 * Follows the same pattern as PrestashopCredentialsPanel but with both
 * consumerKey and consumerSecret fields (rotated together, not separately).
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { WoocommerceCredentialsPanel } from './woocommerce-credentials-panel';

describe('WoocommerceCredentialsPanel', () => {
  afterEach(cleanup);

  it('renders the rotate affordance for a credentials-backed connection', () => {
    renderWithProviders(
      <WoocommerceCredentialsPanel connection={sampleConnection} />
    );
    expect(screen.getByText('Rotate API credentials')).toBeInTheDocument();
  });

  it('falls back to the env-var disabled input when credentialsBacked=false', () => {
    const envBackedConnection = { ...sampleConnection, credentialsBacked: false };
    renderWithProviders(
      <WoocommerceCredentialsPanel connection={envBackedConnection} />
    );
    expect(
      screen.getByDisplayValue('Environment variable (not editable via UI)')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument();
  });

  it('sends both consumerKey and consumerSecret and surfaces a success toast', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      connections: { updateCredentials },
    });
    renderWithProviders(
      <WoocommerceCredentialsPanel connection={sampleConnection} />,
      { apiClient }
    );

    fireEvent.click(screen.getByText('Rotate API credentials'));
    const keyInput = screen.getByPlaceholderText('ck_••••••••••••••••••••••••••••••••••••••••');
    const secretInput = screen.getByPlaceholderText('cs_••••••••••••••••••••••••••••••••••••••••');
    fireEvent.change(keyInput, { target: { value: 'ck_test1234567890' } });
    fireEvent.change(secretInput, { target: { value: 'cs_test1234567890' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateCredentials).toHaveBeenCalledWith(sampleConnection.id, {
        consumerKey: 'ck_test1234567890',
        consumerSecret: 'cs_test1234567890',
      });
    });
    expect(
      await findToastTitle('Credentials rotated')
    ).toBeInTheDocument();
  });

  it('disables save while either field is empty', () => {
    renderWithProviders(
      <WoocommerceCredentialsPanel connection={sampleConnection} />
    );
    fireEvent.click(screen.getByText('Rotate API credentials'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    const keyInput = screen.getByPlaceholderText('ck_••••••••••••••••••••••••••••••••••••••••');
    fireEvent.change(keyInput, { target: { value: 'ck_test1234567890' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    const secretInput = screen.getByPlaceholderText('cs_••••••••••••••••••••••••••••••••••••••••');
    fireEvent.change(secretInput, { target: { value: 'cs_test1234567890' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('collapses the form after successful save', async () => {
    const updateCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({
      connections: { updateCredentials },
    });
    renderWithProviders(
      <WoocommerceCredentialsPanel connection={sampleConnection} />,
      { apiClient }
    );

    fireEvent.click(screen.getByText('Rotate API credentials'));
    const keyInput = screen.getByPlaceholderText('ck_••••••••••••••••••••••••••••••••••••••••');
    const secretInput = screen.getByPlaceholderText('cs_••••••••••••••••••••••••••••••••••••••••');
    fireEvent.change(keyInput, { target: { value: 'ck_test1234567890' } });
    fireEvent.change(secretInput, { target: { value: 'cs_test1234567890' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Rotate API credentials')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('ck_••••••••••••••••••••••••••••••••••••••••')).not.toBeInTheDocument();
    });
  });
});
