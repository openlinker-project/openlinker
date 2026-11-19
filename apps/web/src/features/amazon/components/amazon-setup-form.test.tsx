/**
 * AmazonSetupForm tests (#4186)
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { AmazonSetupForm } from './amazon-setup-form';

async function fill(): Promise<void> {
  const user = userEvent.setup();
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Amazon EU' } });
  await user.click(screen.getByRole('combobox', { name: 'Marketplaces' }));
  await user.click(screen.getByRole('option', { name: /Germany/ }));
  await user.keyboard('{Escape}');
  fireEvent.change(screen.getByLabelText('Merchant token'), { target: { value: 'A2EXAMPLE12345' } });
  fireEvent.change(screen.getByLabelText('LWA client id'), { target: { value: 'amzn1.application-oa2-client.abc' } });
  fireEvent.change(screen.getByLabelText('LWA client secret'), { target: { value: 'secret' } });
  fireEvent.change(screen.getByLabelText('Refresh token'), { target: { value: 'Atzr|token' } });
}

describe('AmazonSetupForm', () => {
  afterEach(cleanup);

  it('should offer only the marketplaces of the chosen region', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AmazonSetupForm />);

    await user.click(screen.getByRole('combobox', { name: 'Marketplaces' }));
    expect(screen.getByRole('option', { name: /Germany/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Poland/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'na' } });

    await user.click(screen.getByRole('combobox', { name: 'Marketplaces' }));
    expect(screen.queryByRole('option', { name: /Germany/ })).toBeNull();
    expect(screen.getByRole('option', { name: /United States \(USD\)/ })).toBeInTheDocument();
  });

  it('should say up front that a connection is one account in one region', () => {
    renderWithProviders(<AmazonSetupForm />);

    expect(screen.getByText('One connection is one Amazon seller account in one region')).toBeInTheDocument();
    expect(screen.getByText(/The region cannot be changed later/)).toBeInTheDocument();
  });

  it('should keep one marketplace when the Far East region is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AmazonSetupForm />);

    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'fe' } });
    expect(screen.getByText(/choose one marketplace/)).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Marketplaces' }));
    await user.click(screen.getByRole('option', { name: /Japan/ }));
    await user.click(screen.getByRole('combobox', { name: 'Marketplaces' }));
    await user.click(screen.getByRole('option', { name: /Australia/ }));

    await user.click(screen.getByRole('combobox', { name: 'Marketplaces' }));
    expect(screen.getByRole('option', { name: /Australia/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Japan/ })).toHaveAttribute('aria-selected', 'false');
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

    await fill();
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

  it('should word a failed connection test from its outcome, not the server text', async () => {
    const apiClient = createMockApiClient();
    vi.mocked(apiClient.connections.test).mockResolvedValue({
      success: false,
      status: 401,
      message: 'Amazon refused the credentials.',
      latencyMs: 12,
      outcome: 'unauthorized',
    });
    renderWithProviders(<AmazonSetupForm />, { apiClient });

    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create connection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText(/^The platform refused the credentials\. Check the key or password\./)).toBeInTheDocument();
  });
});
