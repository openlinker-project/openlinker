/**
 * InfaktStructuredSection Tests
 *
 * Coverage for the baseUrl editor field and default-payment-method select
 * (#1303) shown in EditConnectionForm for inFakt connections. Tests
 * propagation to JSON config via syncStructuredToJson callback. Mirrors
 * `woocommerce-structured-section.test.tsx`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test component mocking requires flexible types */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, findToastTitle, renderWithProviders } from '../../../test/test-utils';
import { InfaktStructuredSection } from './infakt-structured-section';
import type { BankAccount } from '../../../features/connections';

describe('InfaktStructuredSection', () => {
  afterEach(cleanup);

  it('renders the baseUrl field for editing', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: 'https://api.infakt.pl' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);
    expect(screen.getByDisplayValue('https://api.infakt.pl')).toBeInTheDocument();
  });

  it('calls syncStructuredToJson with the baseUrl config key when the value changes', () => {
    const syncStructuredToJson = vi.fn();
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: 'https://api.infakt.pl' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={syncStructuredToJson}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    const input = screen.getByDisplayValue('https://api.infakt.pl');
    fireEvent.change(input, { target: { value: 'https://sandbox.infakt.pl' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith('baseUrl', 'https://sandbox.infakt.pl');
  });

  it('disables input when configIsParseable is false', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: 'https://api.infakt.pl' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={false}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    const input = screen.getByDisplayValue('https://api.infakt.pl');
    expect(input).toBeDisabled();
  });

  it('shows form error message when baseUrl has a validation error', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '' },
      });
      form.formState.errors.baseUrl = {
        message: 'Base URL must use HTTPS',
        type: 'manual',
      };
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    expect(screen.getByText('Base URL must use HTTPS')).toBeInTheDocument();
  });

  it('shows the effective payment method in the collapsed disclosure summary (#1303)', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '', infaktPaymentMethod: 'transfer' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);
    expect(screen.getByText('Payment method for invoice:')).toBeInTheDocument();
    expect(screen.getByText('Transfer', { selector: '.inline-disclosure__value' })).toBeInTheDocument();
    expect(screen.getByLabelText('Default payment method')).not.toBeVisible();
  });

  it('defaults the collapsed summary to Cash when no value is set', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '', infaktPaymentMethod: '' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);
    expect(screen.getByText('Cash', { selector: '.inline-disclosure__value' })).toBeInTheDocument();
  });

  it('renders the default payment method select once expanded (#1303)', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '', infaktPaymentMethod: 'cash' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    fireEvent.click(screen.getByText('Payment method for invoice:'));

    expect(screen.getByLabelText('Default payment method')).toHaveValue('cash');
  });

  it('calls syncStructuredToJson with the infaktPaymentMethod config key when the selection changes', () => {
    const syncStructuredToJson = vi.fn();
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '', infaktPaymentMethod: 'cash' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={true}
          syncStructuredToJson={syncStructuredToJson}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    fireEvent.click(screen.getByText('Payment method for invoice:'));
    fireEvent.change(screen.getByLabelText('Default payment method'), {
      target: { value: 'transfer' },
    });

    expect(syncStructuredToJson).toHaveBeenCalledWith('infaktPaymentMethod', 'transfer');
  });

  it('disables the payment method select when configIsParseable is false', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { baseUrl: '', infaktPaymentMethod: 'cash' },
      });
      return (
        <InfaktStructuredSection
          connection={{ id: '1' } as any}
          form={form as any}
          configIsParseable={false}
          syncStructuredToJson={vi.fn()}
        />
      );
    };
    renderWithProviders(<TestComponent />);

    fireEvent.click(screen.getByText('Payment method for invoice:'));

    expect(screen.getByLabelText('Default payment method')).toBeDisabled();
  });

  describe('bank account (#1303 follow-up)', () => {
    function renderWithTransferSelected(
      getBankAccounts: (connectionId: string) => Promise<BankAccount[]>,
    ): void {
      const apiClient = createMockApiClient({ connections: { getBankAccounts } });
      const TestComponent = (): ReactElement => {
        const form = useForm<any>({
          defaultValues: { baseUrl: '', infaktPaymentMethod: 'transfer', infaktBankAccount: null },
        });
        return (
          <InfaktStructuredSection
            connection={{ id: 'conn-1' } as any}
            form={form as any}
            configIsParseable={true}
            syncStructuredToJson={vi.fn()}
            syncInfaktBankAccountToJson={vi.fn()}
          />
        );
      };
      renderWithProviders(<TestComponent />, { apiClient });
      fireEvent.click(screen.getByText('Payment method for invoice:'));
    }

    it('does not query bank accounts when cash is selected', () => {
      const getBankAccounts = vi.fn().mockResolvedValue([]);
      const apiClient = createMockApiClient({ connections: { getBankAccounts } });
      const TestComponent = (): ReactElement => {
        const form = useForm<any>({ defaultValues: { baseUrl: '', infaktPaymentMethod: 'cash' } });
        return (
          <InfaktStructuredSection
            connection={{ id: 'conn-1' } as any}
            form={form as any}
            configIsParseable={true}
            syncStructuredToJson={vi.fn()}
          />
        );
      };
      renderWithProviders(<TestComponent />, { apiClient });

      expect(getBankAccounts).not.toHaveBeenCalled();
    });

    it('renders a select of fetched bank accounts when transfer is selected', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: true },
        { id: '2', accountNumber: '12 1090 1014 0000 0001 2345 6789', bankName: 'Santander', isDefault: false },
      ]);
      renderWithTransferSelected(getBankAccounts);

      expect(getBankAccounts).toHaveBeenCalledWith('conn-1');
      const select = await screen.findByLabelText('Bank account for Transfer invoices');
      expect(
        screen.getByText('mBank — 61 1140 2004 0000 3002 0135 5387 (default in inFakt)'),
      ).toBeInTheDocument();
      expect(screen.getByText('Santander — 12 1090 1014 0000 0001 2345 6789')).toBeInTheDocument();
      expect(select).toBeInTheDocument();
    });

    it('warns when the saved account no longer exists in the live inFakt list', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: true },
      ]);
      const apiClient = createMockApiClient({ connections: { getBankAccounts } });
      const TestComponent = (): ReactElement => {
        const form = useForm<any>({
          defaultValues: {
            baseUrl: '',
            infaktPaymentMethod: 'transfer',
            infaktBankAccount: {
              id: '99',
              accountNumber: '00 0000 0000 0000 0000 0000 0000',
              bankName: 'Deleted Bank',
            },
          },
        });
        return (
          <InfaktStructuredSection
            connection={{ id: 'conn-1' } as any}
            form={form as any}
            configIsParseable={true}
            syncStructuredToJson={vi.fn()}
            syncInfaktBankAccountToJson={vi.fn()}
          />
        );
      };
      renderWithProviders(<TestComponent />, { apiClient });
      fireEvent.click(screen.getByText('Payment method for invoice:'));

      expect(
        await screen.findByText(/no longer exists in inFakt/),
      ).toBeInTheDocument();
    });

    it('warns Transfer is not viable and points to Cash when no bank accounts are found', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([]);
      renderWithTransferSelected(getBankAccounts);

      // #1310 review, finding 2: this surface does not auto-persist a Cash
      // fallback, so the copy must not claim "invoices will use Cash" — it
      // states the saved method is still Transfer and points to the fix.
      expect(
        await screen.findByText(/No bank account is configured on this inFakt account/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/saved payment method is still Transfer/),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText('Bank account for Transfer invoices')).not.toBeInTheDocument();
    });

    it('shows a last-saved fallback message when the bank-accounts fetch fails', async () => {
      // #1310 review, finding 11: the edit screen stamps the last-saved
      // snapshot on a fetch failure, so its copy is accurate — pin it.
      const getBankAccounts = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));
      renderWithTransferSelected(getBankAccounts);

      expect(
        await screen.findByText(/invoices will use whatever was last saved/),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText('Bank account for Transfer invoices')).not.toBeInTheDocument();
    });

    it('calls syncInfaktBankAccountToJson, persists the config eagerly, then flips the inFakt default', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: false },
      ]);
      const setDefaultBankAccount = vi.fn().mockResolvedValue(undefined);
      const update = vi.fn().mockResolvedValue({ id: 'conn-1' });
      const apiClient = createMockApiClient({
        connections: { getBankAccounts, setDefaultBankAccount, update },
      });
      const syncInfaktBankAccountToJson = vi.fn();
      let capturedForm: ReturnType<typeof useForm> | null = null;
      const TestComponent = (): ReactElement => {
        const form = useForm<any>({
          defaultValues: { baseUrl: '', infaktPaymentMethod: 'transfer', infaktBankAccount: null },
        });
        capturedForm = form;
        return (
          <InfaktStructuredSection
            connection={{ id: 'conn-1', config: { defaultPaymentMethod: 'transfer' } } as any}
            form={form as any}
            configIsParseable={true}
            syncStructuredToJson={vi.fn()}
            syncInfaktBankAccountToJson={syncInfaktBankAccountToJson}
          />
        );
      };
      renderWithProviders(<TestComponent />, { apiClient });
      fireEvent.click(screen.getByText('Payment method for invoice:'));

      const select = await screen.findByLabelText('Bank account for Transfer invoices');
      fireEvent.change(select, { target: { value: '1' } });

      await waitFor(() => {
        expect(syncInfaktBankAccountToJson).toHaveBeenCalled();
      });
      expect(capturedForm!.getValues('infaktBankAccount')).toEqual({
        id: '1',
        accountNumber: '61 1140 2004 0000 3002 0135 5387',
        bankName: 'mBank',
      });
      // Eager persist — the pick must not wait for Save changes (#1310 review).
      await waitFor(() => {
        expect(update).toHaveBeenCalledWith(
          'conn-1',
          expect.objectContaining({
            config: expect.objectContaining({
              defaultPaymentMethod: 'transfer',
              bankAccount: {
                id: '1',
                accountNumber: '61 1140 2004 0000 3002 0135 5387',
                bankName: 'mBank',
              },
            }),
          }),
        );
      });
      await waitFor(() => {
        expect(setDefaultBankAccount).toHaveBeenCalledWith('conn-1', '1');
      });
    });

    it('does not re-flag the account as default in inFakt when it already is one', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: true },
      ]);
      const setDefaultBankAccount = vi.fn().mockResolvedValue(undefined);
      const update = vi.fn().mockResolvedValue({ id: 'conn-1' });
      const apiClient = createMockApiClient({
        connections: { getBankAccounts, setDefaultBankAccount, update },
      });
      const TestComponent = (): ReactElement => {
        const form = useForm<any>({
          defaultValues: { baseUrl: '', infaktPaymentMethod: 'transfer', infaktBankAccount: null },
        });
        return (
          <InfaktStructuredSection
            connection={{ id: 'conn-1' } as any}
            form={form as any}
            configIsParseable={true}
            syncStructuredToJson={vi.fn()}
            syncInfaktBankAccountToJson={vi.fn()}
          />
        );
      };
      renderWithProviders(<TestComponent />, { apiClient });
      fireEvent.click(screen.getByText('Payment method for invoice:'));

      const select = await screen.findByLabelText('Bank account for Transfer invoices');
      fireEvent.change(select, { target: { value: '1' } });

      await waitFor(() => {
        expect(update).toHaveBeenCalled();
      });
      expect(setDefaultBankAccount).not.toHaveBeenCalled();
    });

    it('shows an error toast and skips the inFakt default flip when the eager persist fails', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: false },
      ]);
      const setDefaultBankAccount = vi.fn().mockResolvedValue(undefined);
      const update = vi.fn().mockRejectedValue(new Error('500 Internal Server Error'));
      const apiClient = createMockApiClient({
        connections: { getBankAccounts, setDefaultBankAccount, update },
      });
      const TestComponent = (): ReactElement => {
        const form = useForm<any>({
          defaultValues: { baseUrl: '', infaktPaymentMethod: 'transfer', infaktBankAccount: null },
        });
        return (
          <InfaktStructuredSection
            connection={{ id: 'conn-1' } as any}
            form={form as any}
            configIsParseable={true}
            syncStructuredToJson={vi.fn()}
            syncInfaktBankAccountToJson={vi.fn()}
          />
        );
      };
      renderWithProviders(<TestComponent />, { apiClient });
      fireEvent.click(screen.getByText('Payment method for invoice:'));

      const select = await screen.findByLabelText('Bank account for Transfer invoices');
      fireEvent.change(select, { target: { value: '1' } });

      expect(await findToastTitle('Could not save the bank account')).toBeInTheDocument();
      expect(setDefaultBankAccount).not.toHaveBeenCalled();
    });

    it('shows an error toast when flipping the inFakt default fails', async () => {
      const getBankAccounts = vi.fn().mockResolvedValue([
        { id: '1', accountNumber: '61 1140 2004 0000 3002 0135 5387', bankName: 'mBank', isDefault: false },
      ]);
      const setDefaultBankAccount = vi.fn().mockRejectedValue(new Error('502 Bad Gateway'));
      const update = vi.fn().mockResolvedValue({ id: 'conn-1' });
      const apiClient = createMockApiClient({
        connections: { getBankAccounts, setDefaultBankAccount, update },
      });
      const TestComponent = (): ReactElement => {
        const form = useForm<any>({
          defaultValues: { baseUrl: '', infaktPaymentMethod: 'transfer', infaktBankAccount: null },
        });
        return (
          <InfaktStructuredSection
            connection={{ id: 'conn-1' } as any}
            form={form as any}
            configIsParseable={true}
            syncStructuredToJson={vi.fn()}
            syncInfaktBankAccountToJson={vi.fn()}
          />
        );
      };
      renderWithProviders(<TestComponent />, { apiClient });
      fireEvent.click(screen.getByText('Payment method for invoice:'));

      const select = await screen.findByLabelText('Bank account for Transfer invoices');
      fireEvent.change(select, { target: { value: '1' } });

      expect(
        await findToastTitle('Could not update the default account'),
      ).toBeInTheDocument();
    });
  });
});
