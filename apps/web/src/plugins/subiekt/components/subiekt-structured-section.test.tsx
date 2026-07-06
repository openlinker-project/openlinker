/**
 * SubiektStructuredSection tests (#759 + #1324)
 *
 * Renders the plugin-owned structured section the way EditConnectionForm does
 * (via renderWithProviders, so usePlatform('subiekt') resolves the registered
 * plugin and its capabilityDescriptors). The #1324 payment/bank/cash-register
 * queries are mocked at the feature-hook boundary so no real HTTP fires.
 *
 * @module plugins/subiekt/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type * as ConnectionsModule from '../../../features/connections';
import type { Connection, SubiektBankAccount, SubiektCashRegister } from '../../../features/connections';
import { SubiektStructuredSection } from './subiekt-structured-section';

// --- feature-hook mocks (#1324): keep the real barrel (CapabilityTogglesSection
// etc.) but override the three Subiekt data hooks so no real query fires. ---
const bankAccountsResult = { data: [] as SubiektBankAccount[], isLoading: false, isError: false };
const cashRegistersResult = { data: [] as SubiektCashRegister[], isLoading: false, isError: false };
// The section fires the default-sync fire-and-forget via `.mutate()` (not
// `mutateAsync`) so a bridge failure is toasted by the hook, never an unhandled
// rejection (PR review IMPORTANT #4).
const setDefaultMutate = vi.fn();

vi.mock('../../../features/connections', async (importOriginal) => {
  const actual = await importOriginal<typeof ConnectionsModule>();
  return {
    ...actual,
    useSubiektBankAccountsQuery: () => bankAccountsResult,
    useSubiektCashRegistersQuery: () => cashRegistersResult,
    useSetDefaultBankAccountMutation: () => ({ mutate: setDefaultMutate }),
  };
});

const subiektConnection: Connection = {
  ...sampleConnection,
  id: 'subiekt_1',
  name: 'Subiekt GT',
  platformType: 'subiekt',
  config: {},
  adapterKey: 'subiekt.bridge.v1',
};

interface HarnessProps {
  configIsParseable?: boolean;
  syncStructuredToJson?: (field: string, value: string) => void;
  defaultValues?: Record<string, unknown>;
}

function Harness({
  configIsParseable = true,
  syncStructuredToJson = vi.fn(),
  defaultValues = {},
}: HarnessProps): ReactElement {
  const form = useForm<any>({
    defaultValues: {
      subiektBridgeUrl: '',
      subiektTriggerModel: '',
      subiektPaymentMethod: '',
      subiektBankAccountId: '',
      subiektStanowiskoKasoweId: '',
      subiektCapabilities: {},
      ...defaultValues,
    },
  });
  return (
    <SubiektStructuredSection
      connection={subiektConnection}
      form={form as any}
      configIsParseable={configIsParseable}
      syncStructuredToJson={syncStructuredToJson}
      syncObjectToJson={vi.fn()}
    />
  );
}

function account(over: Partial<SubiektBankAccount>): SubiektBankAccount {
  return {
    id: '1',
    accountNumber: '00 0000',
    bankName: 'Bank',
    isDefault: false,
    ownerPodmiotId: 1,
    ownerName: 'Firma A',
    ...over,
  };
}

describe('SubiektStructuredSection', () => {
  beforeEach(() => {
    bankAccountsResult.data = [];
    bankAccountsResult.isLoading = false;
    bankAccountsResult.isError = false;
    cashRegistersResult.data = [];
    cashRegistersResult.isLoading = false;
    cashRegistersResult.isError = false;
    setDefaultMutate.mockClear();
  });
  afterEach(cleanup);

  it('propagates Bridge URL changes via syncStructuredToJson under the subiektBridgeUrl key', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    const input = screen.getByPlaceholderText('https://localhost:5005');
    fireEvent.change(input, { target: { value: 'https://bridge.example.com' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith(
      'subiektBridgeUrl',
      'https://bridge.example.com',
    );
  });

  it('renders the 4 trigger options with the AC-2 labels', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('option', { name: 'Manual' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Auto on order paid' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Auto on order shipped' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Batched' })).toBeInTheDocument();
  });

  it('routes the trigger Select change to the subiektTriggerModel field', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    const select = screen.getByLabelText('Invoice trigger');
    fireEvent.change(select, { target: { value: 'auto-on-paid' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith('subiektTriggerModel', 'auto-on-paid');
  });

  it('renders one capability toggle per adapter descriptor entry', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getByText('Show KSeF status badge')).toBeInTheDocument();
  });

  it('capability label "Show KSeF status badge" comes from the descriptor module (AC-8) and is ABSENT from the shared CapabilityTogglesSection source', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByText('Show KSeF status badge')).toBeInTheDocument();

    const sharedSource = readFileSync(
      resolve(process.cwd(), 'src/features/connections/components/CapabilityTogglesSection.tsx'),
      'utf8',
    );
    expect(sharedSource).not.toContain('KSeF');
  });

  it('disables Bridge URL, trigger Select, and toggles when configText is unparseable', () => {
    renderWithProviders(<Harness configIsParseable={false} />);
    expect(screen.getByPlaceholderText('https://localhost:5005')).toBeDisabled();
    expect(screen.getByLabelText('Invoice trigger')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('pre-selects the trigger dropdown from the hydrated form value', () => {
    renderWithProviders(<Harness defaultValues={{ subiektTriggerModel: 'batched' }} />);
    expect(screen.getByLabelText('Invoice trigger')).toHaveValue('batched');
  });

  // --- #1324 payment method / bank account ---

  it('routes the payment-method Select change to subiektPaymentMethod', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    fireEvent.change(screen.getByLabelText('Default payment method'), {
      target: { value: 'transfer' },
    });
    expect(syncStructuredToJson).toHaveBeenCalledWith('subiektPaymentMethod', 'transfer');
  });

  it('offers an explicit "Not set" payment option and hides the bank select when unset (tri-state)', () => {
    bankAccountsResult.data = [account({})];
    renderWithProviders(<Harness defaultValues={{ subiektPaymentMethod: '' }} />);

    // The unset option exists and is the current value — no forced "Cash".
    expect(
      screen.getByRole('option', { name: 'Not set (Subiekt default)' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Default payment method')).toHaveValue('');
    // Bank-account picker is transfer-only, so it stays hidden when unset.
    expect(screen.queryByLabelText('Bank account for Transfer invoices')).not.toBeInTheDocument();
  });

  it('hides the bank-account select when payment method is Cash', () => {
    bankAccountsResult.data = [account({})];
    renderWithProviders(<Harness defaultValues={{ subiektPaymentMethod: 'cash' }} />);
    expect(screen.queryByLabelText('Bank account for Transfer invoices')).not.toBeInTheDocument();
  });

  it('shows a flat bank-account list and NO payer warning for a single-payer install', () => {
    bankAccountsResult.data = [
      account({ id: '1', ownerPodmiotId: 7, ownerName: 'Firma A' }),
      account({ id: '2', ownerPodmiotId: 7, ownerName: 'Firma A' }),
    ];
    renderWithProviders(<Harness defaultValues={{ subiektPaymentMethod: 'transfer' }} />);

    expect(screen.getByLabelText('Bank account for Transfer invoices')).toBeInTheDocument();
    // no optgroup + no multi-payer warning
    expect(document.querySelector('optgroup')).toBeNull();
    expect(screen.queryByText(/more than one płatnik/i)).not.toBeInTheDocument();
  });

  it('groups accounts by owner and shows the payer warning ONLY when >1 payer', () => {
    bankAccountsResult.data = [
      account({ id: '1', ownerPodmiotId: 1, ownerName: 'Firma A' }),
      account({ id: '2', ownerPodmiotId: 2, ownerName: 'Oddział B' }),
    ];
    renderWithProviders(<Harness defaultValues={{ subiektPaymentMethod: 'transfer' }} />);

    expect(document.querySelectorAll('optgroup')).toHaveLength(2);
    expect(screen.getByText(/more than one płatnik/i)).toBeInTheDocument();
  });

  it('fires the set-default mutation when a non-default account is picked', () => {
    bankAccountsResult.data = [
      account({ id: '1', isDefault: true }),
      account({ id: '2', isDefault: false }),
    ];
    const syncStructuredToJson = vi.fn();
    renderWithProviders(
      <Harness
        syncStructuredToJson={syncStructuredToJson}
        defaultValues={{ subiektPaymentMethod: 'transfer' }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Bank account for Transfer invoices'), {
      target: { value: '2' },
    });
    expect(syncStructuredToJson).toHaveBeenCalledWith('subiektBankAccountId', '2');
    expect(setDefaultMutate).toHaveBeenCalledWith({ connectionId: 'subiekt_1', accountId: '2' });
  });

  it('does NOT fire the set-default mutation when the picked account is already default', () => {
    bankAccountsResult.data = [account({ id: '1', isDefault: true })];
    renderWithProviders(<Harness defaultValues={{ subiektPaymentMethod: 'transfer' }} />);

    fireEvent.change(screen.getByLabelText('Bank account for Transfer invoices'), {
      target: { value: '1' },
    });
    expect(setDefaultMutate).not.toHaveBeenCalled();
  });

  // --- #1324 cash register (Stanowisko Kasowe) — NO Oddział selector ---

  it('renders the cash-register select with the Centrala help text and no Oddział field', () => {
    cashRegistersResult.data = [
      { id: 100065, name: 'Kasa Centralna', symbol: 'CENTR', oddzialId: 100000 },
    ];
    renderWithProviders(<Harness />);

    expect(screen.getByLabelText('Cash register (Stanowisko Kasowe)')).toBeInTheDocument();
    expect(screen.getByText(/switching Oddział/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Kasa Centralna (CENTR)' })).toBeInTheDocument();
    // no branch/Oddział selector anywhere
    expect(screen.queryByLabelText(/Oddział/i)).not.toBeInTheDocument();
  });

  it('routes the cash-register Select change to subiektStanowiskoKasoweId', () => {
    cashRegistersResult.data = [
      { id: 100065, name: 'Kasa Centralna', symbol: 'CENTR', oddzialId: null },
    ];
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    fireEvent.change(screen.getByLabelText('Cash register (Stanowisko Kasowe)'), {
      target: { value: '100065' },
    });
    expect(syncStructuredToJson).toHaveBeenCalledWith('subiektStanowiskoKasoweId', '100065');
  });
});
