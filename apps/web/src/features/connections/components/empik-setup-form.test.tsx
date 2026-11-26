/**
 * EmpikSetupForm Tests
 *
 * The two-step Empik wizard: validation, the create payload, and the
 * post-create connection test.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, findToastTitle, renderWithProviders } from '../../../test/test-utils';
import { EmpikSetupForm } from './empik-setup-form';

async function fillAndReachReview(
  overrides: { environment?: string; shopId?: string } = {},
): Promise<void> {
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'My Empik shop' } });
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'key-123' } });
  if (overrides.environment) {
    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: overrides.environment } });
  }
  if (overrides.shopId !== undefined) {
    fireEvent.change(screen.getByLabelText('Shop ID (optional)'), { target: { value: overrides.shopId } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('button', { name: 'Connect Empik Marketplace' });
}

describe('EmpikSetupForm', () => {
  afterEach(cleanup);

  it('should show the fields, the key hint and the shipping-zone warning', () => {
    renderWithProviders(<EmpikSetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    expect(screen.getByLabelText('Environment')).toHaveValue('production');
    expect(screen.getByLabelText('Shop ID (optional)')).toBeInTheDocument();
    expect(screen.getByText('Set up shipping in the Empik seller panel')).toBeInTheDocument();
  });

  it('should require the API key when moving on', async () => {
    renderWithProviders(<EmpikSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'My Empik shop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getAllByText('API key is required')[0]).toBeInTheDocument();
    });
  });

  it('should refuse a shop id that is not a positive whole number', async () => {
    renderWithProviders(<EmpikSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'My Empik shop' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'key-123' } });
    fireEvent.change(screen.getByLabelText('Shop ID (optional)'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getAllByText('Shop ID must be a whole number greater than 0')[0]).toBeInTheDocument();
    });
  });

  it('should create the connection with the staging environment and shop id', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Empik shop' });
    const apiClient = createMockApiClient({ connections: { create } });
    renderWithProviders(<EmpikSetupForm />, { apiClient });

    await fillAndReachReview({ environment: 'staging', shopId: '6881' });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Empik Marketplace' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        name: 'My Empik shop',
        platformType: 'empik',
        adapterKey: 'empik.mirakl.v1',
        credentials: { apiKey: 'key-123' },
        config: { environment: 'staging', shopId: '6881' },
      });
    });
    expect(await findToastTitle('Connection created')).toBeInTheDocument();
  });

  it('should show a passing connection test after the connection is created', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Empik shop' });
    const test = vi.fn().mockResolvedValue({ success: true, status: 200, message: 'ok', latencyMs: 12 });
    const apiClient = createMockApiClient({ connections: { create, test } });
    renderWithProviders(<EmpikSetupForm />, { apiClient });

    await fillAndReachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Empik Marketplace' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('Connection test passed')).toBeInTheDocument();
    expect(test).toHaveBeenCalledWith('conn-1');
  });

  it('should show a failing connection test when the key is rejected', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Empik shop' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: false, status: 401, message: 'x', latencyMs: 8, outcome: 'unauthorized' });
    const apiClient = createMockApiClient({ connections: { create, test } });
    renderWithProviders(<EmpikSetupForm />, { apiClient });

    await fillAndReachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Empik Marketplace' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();
  });
});
