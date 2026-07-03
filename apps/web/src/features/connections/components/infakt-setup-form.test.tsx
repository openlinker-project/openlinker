/**
 * InfaktSetupForm Tests
 *
 * Coverage for the single-step inFakt setup wizard. Tests form validation,
 * submission via the generic create-connection mutation, and the post-create
 * "Test connection" flow that surfaces a ConnectionTestResult. Mirrors
 * `erli-setup-form.test.tsx`.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import { InfaktSetupForm } from './infakt-setup-form';
import type { BankAccount } from '../api/connections.types';

describe('InfaktSetupForm', () => {
  afterEach(cleanup);

  it('renders the required form fields', () => {
    renderWithProviders(<InfaktSetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    expect(screen.getByLabelText('Base URL (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Default payment method')).toBeInTheDocument();
  });

  it('defaults the payment method to cash', () => {
    renderWithProviders(<InfaktSetupForm />);
    expect(screen.getByLabelText('Default payment method')).toHaveValue('cash');
  });

  it('requires connection name to be non-empty', async () => {
    renderWithProviders(<InfaktSetupForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(screen.getAllByText('Connection name is required')[0]).toBeInTheDocument();
    });
  });

  it('requires the API key to be non-empty', async () => {
    renderWithProviders(<InfaktSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(screen.getAllByText('API key is required')[0]).toBeInTheDocument();
    });
  });

  it('rejects a non-HTTPS base URL override', async () => {
    renderWithProviders(<InfaktSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.change(screen.getByLabelText('Base URL (optional)'), {
      target: { value: 'http://api.infakt.pl' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(screen.getAllByText('Base URL must use HTTPS')[0]).toBeInTheDocument();
    });
  });

  it('submits the API key and a cash-default config when no base URL is given', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My inFakt Account',
          platformType: 'infakt',
          adapterKey: 'infakt.accounting.v1',
          config: { defaultPaymentMethod: 'cash' },
          credentials: { apiKey: 'sk_test_123' },
        }),
      );
    });
    expect(await findToastTitle('Connection created')).toBeInTheDocument();
  });

  it('includes baseUrl in config when supplied', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.change(screen.getByLabelText('Base URL (optional)'), {
      target: { value: 'https://sandbox.infakt.pl' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { defaultPaymentMethod: 'cash', baseUrl: 'https://sandbox.infakt.pl' },
        }),
      );
    });
  });

  it('submits transfer when selected in the payment method field', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.change(screen.getByLabelText('Default payment method'), {
      target: { value: 'transfer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { defaultPaymentMethod: 'transfer' },
        }),
      );
    });
  });

  it('surfaces the test-connection result after a successful create', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: true, status: 200, message: 'OK', latencyMs: 42 });
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    // After create, the test affordance replaces the connect button.
    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(test).toHaveBeenCalledWith('conn-1');
    });
    expect(await screen.findByText('Connection test passed')).toBeInTheDocument();
  });

  it('surfaces a failing test-connection result', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const test = vi
      .fn()
      .mockResolvedValue({ success: false, status: 401, message: 'Unauthorized', latencyMs: 10 });
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();
    expect(screen.getByText(/Unauthorized/)).toBeInTheDocument();
  });

  it('surfaces the "Unable to test connection" alert when the test request rejects', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account' });
    const test = vi.fn().mockRejectedValue(new Error('Network unreachable'));
    const apiClient = createMockApiClient({ connections: { create, test } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    const testButton = await screen.findByRole('button', { name: 'Test connection' });
    fireEvent.click(testButton);

    expect(await screen.findByText('Unable to test connection')).toBeInTheDocument();
    expect(screen.getByText(/Network unreachable/)).toBeInTheDocument();
    expect(screen.queryByText('Connection test passed')).not.toBeInTheDocument();
    expect(screen.queryByText('Connection test failed')).not.toBeInTheDocument();
  });

  it('disables the submit button during the create mutation', async () => {
    const create = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ id: 'conn-1', name: 'My inFakt Account' }), 100),
          ),
      );
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<InfaktSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My inFakt Account' },
    });
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk_test_123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /Connecting|Connect inFakt/ });
      expect(button).toBeDisabled();
    });
  });

  describe('bank-account picker (#1303 follow-up)', () => {
    async function createConnection(
      getBankAccounts: (connectionId: string) => Promise<BankAccount[]>,
      config: Record<string, unknown> = { defaultPaymentMethod: 'transfer' },
      setDefaultBankAccount: (connectionId: string, accountId: string) => Promise<void> = vi
        .fn()
        .mockResolvedValue(undefined),
    ): Promise<ReturnType<typeof vi.fn>> {
      const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account', config });
      const update = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My inFakt Account', config });
      const apiClient = createMockApiClient({
        connections: { create, update, getBankAccounts, setDefaultBankAccount },
      });

      renderWithProviders(<InfaktSetupForm />, { apiClient });

      fireEvent.change(screen.getByLabelText('Connection name'), {
        target: { value: 'My inFakt Account' },
      });
      fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk_test_123' } });
      // The picker is gated on Transfer (mirroring the edit screen), so the
      // helper drives the payment-method select to match the config fixture.
      fireEvent.change(screen.getByLabelText('Default payment method'), {
        target: { value: config.defaultPaymentMethod ?? 'cash' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Connect inFakt' }));
      await screen.findByRole('button', { name: 'Test connection' });
      return update;
    }

    it('defaults to whichever account inFakt marks as default and persists it', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: false },
        { id: '2', accountNumber: '12 1090 1014 0000 0001 2345 6789', bankName: 'Santander', isDefault: true },
      ]);
      const update = await createConnection(getBankAccounts);

      const select = await screen.findByLabelText('Bank account for Transfer invoices');
      expect(select).toHaveValue('2');
      await waitFor(() => {
        expect(update).toHaveBeenCalledWith(
          'conn-1',
          expect.objectContaining({
            config: expect.objectContaining({
              bankAccount: {
                id: '2',
                accountNumber: '12 1090 1014 0000 0001 2345 6789',
                bankName: 'Santander',
              },
            }),
          }),
        );
      });
    });

    it('shows a Cash-only message and forces the payment method to cash when no accounts are found', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([]);
      const update = await createConnection(getBankAccounts);

      expect(
        await screen.findByText(/No bank account is configured on this inFakt account/),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText('Bank account for Transfer invoices')).not.toBeInTheDocument();
      // The form control must agree with the persisted fallback — not keep
      // showing "Transfer" while the server issues everything as cash.
      expect(screen.getByLabelText('Default payment method')).toHaveValue('cash');
      await waitFor(() => {
        expect(update).toHaveBeenCalledWith(
          'conn-1',
          expect.objectContaining({ config: expect.objectContaining({ defaultPaymentMethod: 'cash' }) }),
        );
      });
    });

    it('locks the payment-method select once the connection is created', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: true },
      ]);
      await createConnection(getBankAccounts);

      // Post-create picks would never be persisted (the create payload is
      // already sent) — the select locks and points at the edit screen instead
      // of silently drifting from the server config.
      expect(screen.getByLabelText('Default payment method')).toBeDisabled();
      expect(
        screen.getByText(/change the payment method from the connection's edit screen/i),
      ).toBeInTheDocument();
    });

    it('hides the picker entirely and does not fetch accounts when cash is selected', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([]);
      const update = await createConnection(getBankAccounts, { defaultPaymentMethod: 'cash' });

      expect(getBankAccounts).not.toHaveBeenCalled();
      expect(
        screen.queryByText(/No bank account is configured on this inFakt account/),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Bank account for Transfer invoices')).not.toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    });

    it('lets the operator switch between fetched bank accounts, syncing the new default to inFakt', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: true },
        { id: '2', accountNumber: '12 1090 1014 0000 0001 2345 6789', bankName: 'Santander', isDefault: false },
      ]);
      const setDefaultBankAccount = vi.fn().mockResolvedValue(undefined);
      const update = await createConnection(
        getBankAccounts,
        { defaultPaymentMethod: 'transfer' },
        setDefaultBankAccount,
      );
      const select = await screen.findByLabelText('Bank account for Transfer invoices');
      update.mockClear();

      fireEvent.change(select, { target: { value: '2' } });

      await waitFor(() => {
        expect(update).toHaveBeenCalledWith(
          'conn-1',
          expect.objectContaining({
            config: expect.objectContaining({
              bankAccount: { id: '2', accountNumber: '12 1090 1014 0000 0001 2345 6789', bankName: 'Santander' },
            }),
          }),
        );
      });
      // The default flip is gated on the config persist succeeding, so it
      // may land a tick after the update above.
      await waitFor(() => {
        expect(setDefaultBankAccount).toHaveBeenCalledWith('conn-1', '2');
      });
    });

    it('shows a fallback message when the bank-accounts fetch fails', async () => {
      const getBankAccounts = vi.fn().mockRejectedValue(new Error('501 Not Implemented'));
      await createConnection(getBankAccounts);

      expect(
        await screen.findByText(/Couldn't check inFakt for bank accounts/),
      ).toBeInTheDocument();
    });

    it('shows an error toast and skips the inFakt default flip when persisting the pick fails', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: true },
        { id: '2', accountNumber: '12 1090 1014 0000 0001 2345 6789', bankName: 'Santander', isDefault: false },
      ]);
      const setDefaultBankAccount = vi.fn().mockResolvedValue(undefined);
      const update = await createConnection(
        getBankAccounts,
        { defaultPaymentMethod: 'transfer' },
        setDefaultBankAccount,
      );
      const select = await screen.findByLabelText('Bank account for Transfer invoices');
      update.mockRejectedValue(new Error('500 Internal Server Error'));

      fireEvent.change(select, { target: { value: '2' } });

      expect(await findToastTitle('Could not save the bank account')).toBeInTheDocument();
      expect(setDefaultBankAccount).not.toHaveBeenCalled();
    });

    it('shows an error toast when flipping the inFakt default fails', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: true },
        { id: '2', accountNumber: '12 1090 1014 0000 0001 2345 6789', bankName: 'Santander', isDefault: false },
      ]);
      const setDefaultBankAccount = vi.fn().mockRejectedValue(new Error('502 Bad Gateway'));
      await createConnection(
        getBankAccounts,
        { defaultPaymentMethod: 'transfer' },
        setDefaultBankAccount,
      );
      const select = await screen.findByLabelText('Bank account for Transfer invoices');

      fireEvent.change(select, { target: { value: '2' } });

      expect(
        await findToastTitle('Could not update the inFakt default account'),
      ).toBeInTheDocument();
    });
  });
});
