/**
 * AmazonSetupForm tests (#4186)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { AmazonSetupForm } from './amazon-setup-form';

function fill(): void {
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Amazon EU' } });
  fireEvent.click(screen.getByLabelText(/Germany/));
  fireEvent.change(screen.getByLabelText('Merchant token'), { target: { value: 'A2EXAMPLE12345' } });
  fireEvent.change(screen.getByLabelText('LWA client id'), { target: { value: 'amzn1.application-oa2-client.abc' } });
  fireEvent.change(screen.getByLabelText('LWA client secret'), { target: { value: 'secret' } });
  fireEvent.change(screen.getByLabelText('Refresh token'), { target: { value: 'Atzr|token' } });
}

describe('AmazonSetupForm', () => {
  afterEach(cleanup);

  it('should offer only the marketplaces of the chosen region', () => {
    renderWithProviders(<AmazonSetupForm />);

    expect(screen.getByLabelText(/Germany/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Poland/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'na' } });

    expect(screen.queryByLabelText(/Germany/)).toBeNull();
    expect(screen.getByText('OpenLinker does not list marketplaces for this region yet.')).toBeInTheDocument();
  });

  it('should show the sandbox notice and keep the master role unavailable', () => {
    renderWithProviders(<AmazonSetupForm />);

    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'sandbox' } });

    expect(screen.getByText(/sample data only/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Catalogue master/ })).toBeDisabled();
    expect(screen.getByLabelText(/^Orders/)).toBeChecked();
    expect(screen.getByLabelText(/^Offers/)).toBeChecked();
  });

  it('should refuse to submit without the required fields', async () => {
    const apiClient = createMockApiClient();
    renderWithProviders(<AmazonSetupForm />, { apiClient });

    fireEvent.click(screen.getByRole('button', { name: 'Create connection' }));

    expect((await screen.findAllByText('Choose at least one marketplace.')).length).toBeGreaterThan(0);
    expect(apiClient.connections.create).not.toHaveBeenCalled();
  });

  it('should create the connection and run the connection test', async () => {
    const apiClient = createMockApiClient();
    const created = await apiClient.connections.create({} as never);
    vi.mocked(apiClient.connections.create).mockClear();
    renderWithProviders(<AmazonSetupForm />, { apiClient });

    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create connection' }));

    expect(await screen.findByText('Amazon connection created')).toBeInTheDocument();
    expect(apiClient.connections.create).toHaveBeenCalledWith(
      expect.objectContaining({
        platformType: 'amazon',
        config: { region: 'eu', environment: 'production', marketplaceIds: ['A1PA6795UKMFR9'], sellerId: 'A2EXAMPLE12345' },
        enabledCapabilities: ['OrderSource', 'OfferManager'],
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(apiClient.connections.test).toHaveBeenCalledWith(created.id));
    expect(await screen.findByText('The connection works')).toBeInTheDocument();
  });
});
