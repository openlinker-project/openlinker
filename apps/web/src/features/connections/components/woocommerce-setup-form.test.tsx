/**
 * WoocommerceSetupForm Tests
 *
 * Coverage for the single-step WooCommerce setup wizard. Tests form validation,
 * capability seeding from adapter registry, and submission flow.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import { WoocommerceSetupForm } from './woocommerce-setup-form';

describe('WoocommerceSetupForm', () => {
  afterEach(cleanup);

  it('renders all required form fields', () => {
    renderWithProviders(<WoocommerceSetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('Site URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Consumer key')).toBeInTheDocument();
    expect(screen.getByLabelText('Consumer secret')).toBeInTheDocument();
  });

  it('requires connection name to be non-empty', async () => {
    renderWithProviders(<WoocommerceSetupForm />);
    const submitButton = screen.getByRole('button', { name: 'Connect WooCommerce' });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getAllByText('Connection name is required')[0]).toBeInTheDocument();
    });
  });

  it('requires site URL to be HTTPS (or localhost for dev)', async () => {
    renderWithProviders(<WoocommerceSetupForm />);

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Store' },
    });
    fireEvent.change(screen.getByLabelText('Site URL'), {
      target: { value: 'http://example.com' }, // HTTP, not HTTPS
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect WooCommerce' }));

    await waitFor(() => {
      expect(
        screen.getAllByText('Site URL must use HTTPS (or localhost for local development)')[0]
      ).toBeInTheDocument();
    });
  });

  it('accepts localhost URLs for local development', async () => {
    const createConnection = vi.fn().mockResolvedValue({
      id: 'conn-1',
      name: 'Local Store',
    });
    const apiClient = createMockApiClient({
      connections: { create: createConnection },
    });

    renderWithProviders(<WoocommerceSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'Local Store' },
    });
    fireEvent.change(screen.getByLabelText('Site URL'), {
      target: { value: 'http://localhost:8080' },
    });
    fireEvent.change(screen.getByLabelText('Consumer key'), {
      target: { value: 'ck_test1234567890' },
    });
    fireEvent.change(screen.getByLabelText('Consumer secret'), {
      target: { value: 'cs_test1234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect WooCommerce' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalled();
    });
  });

  it('requires consumer key to start with ck_', async () => {
    renderWithProviders(<WoocommerceSetupForm />);

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Store' },
    });
    fireEvent.change(screen.getByLabelText('Site URL'), {
      target: { value: 'https://shop.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Consumer key'), {
      target: { value: 'invalid_key' }, // Should start with ck_
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect WooCommerce' }));

    await waitFor(() => {
      expect(
        screen.getAllByText('Consumer key must start with ck_')[0]
      ).toBeInTheDocument();
    });
  });

  it('requires consumer secret to start with cs_', async () => {
    renderWithProviders(<WoocommerceSetupForm />);

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Store' },
    });
    fireEvent.change(screen.getByLabelText('Site URL'), {
      target: { value: 'https://shop.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Consumer key'), {
      target: { value: 'ck_test1234567890' },
    });
    fireEvent.change(screen.getByLabelText('Consumer secret'), {
      target: { value: 'invalid_secret' }, // Should start with cs_
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect WooCommerce' }));

    await waitFor(() => {
      expect(
        screen.getAllByText('Consumer secret must start with cs_')[0]
      ).toBeInTheDocument();
    });
  });

  it('submits valid form and shows success toast', async () => {
    const createConnection = vi.fn().mockResolvedValue({
      id: 'conn-1',
      name: 'My Store',
    });
    const apiClient = createMockApiClient({
      connections: { create: createConnection },
    });

    renderWithProviders(<WoocommerceSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Store' },
    });
    fireEvent.change(screen.getByLabelText('Site URL'), {
      target: { value: 'https://shop.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Consumer key'), {
      target: { value: 'ck_test1234567890' },
    });
    fireEvent.change(screen.getByLabelText('Consumer secret'), {
      target: { value: 'cs_test1234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect WooCommerce' }));

    await waitFor(() => {
      expect(createConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Store',
          platformType: 'woocommerce',
          adapterKey: expect.any(String),
          config: expect.objectContaining({
            baseUrl: 'https://shop.example.com',
          }),
          credentials: expect.objectContaining({
            consumerKey: 'ck_test1234567890',
            consumerSecret: 'cs_test1234567890',
          }),
          enabledCapabilities: expect.any(Array),
        })
      );
    });
    expect(
      await findToastTitle('Connection created')
    ).toBeInTheDocument();
  });

  it('disables submit button during mutation', async () => {
    const createConnection = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        id: 'conn-1',
        name: 'My Store',
      }), 100))
    );
    const apiClient = createMockApiClient({
      connections: { create: createConnection },
    });

    renderWithProviders(<WoocommerceSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My Store' },
    });
    fireEvent.change(screen.getByLabelText('Site URL'), {
      target: { value: 'https://shop.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Consumer key'), {
      target: { value: 'ck_test1234567890' },
    });
    fireEvent.change(screen.getByLabelText('Consumer secret'), {
      target: { value: 'cs_test1234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect WooCommerce' }));

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /Connecting|Connect WooCommerce/ });
      expect(button).toBeDisabled();
    });
  });

  it('shows validation errors only after first submit attempt', async () => {
    renderWithProviders(<WoocommerceSetupForm />);

    // Initially no error summary
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // After submit attempt
    fireEvent.click(screen.getByRole('button', { name: 'Connect WooCommerce' }));

    await waitFor(() => {
      expect(screen.getAllByText('Connection name is required')[0]).toBeInTheDocument();
    });
  });
});
