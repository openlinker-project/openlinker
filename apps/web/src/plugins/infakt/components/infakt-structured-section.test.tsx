/**
 * InfaktStructuredSection Tests
 *
 * Coverage for the environment select (#2174) and default-payment-method
 * select (#1303) shown in EditConnectionForm for inFakt connections. Tests
 * propagation to JSON config via syncStructuredToJson callback. Mirrors
 * `woocommerce-structured-section.test.tsx`.
 *
 * The legacy-Base-URL-override block additionally pins the host-preserving
 * clear (#2179 review round 3, Important #2): clearing an override must never
 * silently move a sandbox connection onto production.
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

  it('renders the environment field for editing', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { infaktEnvironment: 'sandbox' },
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
    expect(screen.getByLabelText('Environment')).toHaveValue('sandbox');
  });

  it('calls syncStructuredToJson with the infaktEnvironment config key when the value changes', () => {
    const syncStructuredToJson = vi.fn();
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { infaktEnvironment: 'sandbox' },
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

    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'production' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith('infaktEnvironment', 'production');
  });

  it('disables the environment select when configIsParseable is false', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { infaktEnvironment: 'sandbox' },
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

    expect(screen.getByLabelText('Environment')).toBeDisabled();
  });

  it('shows form error message when infaktEnvironment has a validation error', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { infaktEnvironment: '' },
      });
      form.formState.errors.infaktEnvironment = {
        message: 'must be one of: sandbox, production',
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

    expect(screen.getByText('must be one of: sandbox, production')).toBeInTheDocument();
  });

  describe('legacy Base URL override banner (#2179 review, Important #1)', () => {
    function renderBanner(options: {
      infaktEnvironment: string;
      baseUrl: string;
      syncStructuredToJson?: (field: string, value: string) => void;
      configIsParseable?: boolean;
    }): void {
      const TestComponent = (): ReactElement => {
        const form = useForm<any>({
          defaultValues: {
            infaktEnvironment: options.infaktEnvironment,
            baseUrl: options.baseUrl,
          },
        });
        return (
          <InfaktStructuredSection
            connection={{ id: '1' } as any}
            form={form as any}
            configIsParseable={options.configIsParseable ?? true}
            syncStructuredToJson={(options.syncStructuredToJson ?? vi.fn()) as any}
          />
        );
      };
      renderWithProviders(<TestComponent />);
    }

    it('does not render the banner when no legacy baseUrl is set', () => {
      const TestComponent = (): ReactElement => {
        const form = useForm<any>({
          defaultValues: { infaktEnvironment: 'sandbox', baseUrl: '' },
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

      expect(screen.queryByText('Legacy Base URL override in effect')).not.toBeInTheDocument();
    });

    it('renders the banner with the legacy value when connection.config.baseUrl is set', () => {
      const TestComponent = (): ReactElement => {
        const form = useForm<any>({
          defaultValues: {
            infaktEnvironment: 'production',
            baseUrl: 'https://custom.infakt.example/api/v3',
          },
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

      expect(screen.getByText('Legacy Base URL override in effect')).toBeInTheDocument();
      expect(screen.getByText('https://custom.infakt.example/api/v3')).toBeInTheDocument();
    });

    it('clears the legacy baseUrl via syncStructuredToJson when the clear action is clicked', () => {
      const syncStructuredToJson = vi.fn();
      renderBanner({
        infaktEnvironment: 'production',
        baseUrl: 'https://custom.infakt.example/api/v3',
        syncStructuredToJson,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Clear override (use Production)' }));

      expect(syncStructuredToJson).toHaveBeenCalledWith('baseUrl', '');
    });

    it('disables the clear action when configIsParseable is false', () => {
      renderBanner({
        infaktEnvironment: 'production',
        baseUrl: 'https://custom.infakt.example/api/v3',
        configIsParseable: false,
      });

      expect(screen.getByRole('button', { name: 'Clear override (use Production)' })).toBeDisabled();
    });

    it('keeps a sandbox-host override on Sandbox by syncing the environment before clearing', () => {
      const syncStructuredToJson = vi.fn();
      renderBanner({
        // Never had `config.environment` - a bare clear would resolve to production.
        infaktEnvironment: '',
        baseUrl: 'https://api.sandbox-infakt.pl/api/v3',
        syncStructuredToJson,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Clear override (keep Sandbox)' }));

      expect(syncStructuredToJson).toHaveBeenNthCalledWith(1, 'infaktEnvironment', 'sandbox');
      expect(syncStructuredToJson).toHaveBeenNthCalledWith(2, 'baseUrl', '');
    });

    it('keeps a production-host override on Production', () => {
      const syncStructuredToJson = vi.fn();
      renderBanner({
        infaktEnvironment: '',
        baseUrl: 'https://api.infakt.pl/api/v3',
        syncStructuredToJson,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Clear override (keep Production)' }));

      expect(syncStructuredToJson).toHaveBeenNthCalledWith(1, 'infaktEnvironment', 'production');
      expect(syncStructuredToJson).toHaveBeenNthCalledWith(2, 'baseUrl', '');
    });

    it('disables the clear action and asks for an Environment when the host is unrecognised and none is picked', () => {
      const syncStructuredToJson = vi.fn();
      renderBanner({
        infaktEnvironment: '',
        baseUrl: 'https://proxy.internal.example/api/v3',
        syncStructuredToJson,
      });

      expect(screen.getByRole('button', { name: 'Clear override' })).toBeDisabled();
      expect(screen.getByText(/Pick an Environment below first/)).toBeInTheDocument();
      expect(syncStructuredToJson).not.toHaveBeenCalled();
    });

    it('clears an unrecognised-host override to the picked Environment and names the outcome', () => {
      const syncStructuredToJson = vi.fn();
      renderBanner({
        infaktEnvironment: 'sandbox',
        baseUrl: 'https://proxy.internal.example/api/v3',
        syncStructuredToJson,
      });

      expect(screen.getByText(/switches this connection to Sandbox/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Clear override (use Sandbox)' }));

      expect(syncStructuredToJson).toHaveBeenCalledTimes(1);
      expect(syncStructuredToJson).toHaveBeenCalledWith('baseUrl', '');
    });
  });

  it('shows the effective payment method in the collapsed disclosure summary (#1303)', () => {
    const TestComponent = (): ReactElement => {
      const form = useForm<any>({
        defaultValues: { infaktPaymentMethod: 'transfer' },
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
        defaultValues: { infaktPaymentMethod: '' },
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
        defaultValues: { infaktPaymentMethod: 'cash' },
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
        defaultValues: { infaktPaymentMethod: 'cash' },
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
        defaultValues: { infaktPaymentMethod: 'cash' },
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
          defaultValues: { infaktPaymentMethod: 'transfer', infaktBankAccount: null },
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
        const form = useForm<any>({ defaultValues: { infaktPaymentMethod: 'cash' } });
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
          defaultValues: { infaktPaymentMethod: 'transfer', infaktBankAccount: null },
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
          defaultValues: { infaktPaymentMethod: 'transfer', infaktBankAccount: null },
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
          defaultValues: { infaktPaymentMethod: 'transfer', infaktBankAccount: null },
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
          defaultValues: { infaktPaymentMethod: 'transfer', infaktBankAccount: null },
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
