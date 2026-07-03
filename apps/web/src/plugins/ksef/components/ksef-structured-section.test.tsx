/**
 * KsefStructuredSection tests (#1152, #1223, #1311)
 *
 * Renders the plugin-owned structured section the way EditConnectionForm does
 * (via renderWithProviders, so usePlatform('ksef') resolves and i18n is
 * provided). Pins the flat-field sync routing for environment, seller profile,
 * and the payment fields (#1311) added on top.
 *
 * @module plugins/ksef/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../../features/connections';
import { KsefStructuredSection } from './ksef-structured-section';

const ksefConnection: Connection = {
  ...sampleConnection,
  id: 'ksef_1',
  name: 'KSeF',
  platformType: 'ksef',
  config: { env: 'test' },
  adapterKey: 'ksef.publicapi.v2',
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
      ksefEnvironment: '',
      sellerNip: '',
      sellerName: '',
      sellerAddressLine1: '',
      sellerAddressLine2: '',
      sellerCity: '',
      sellerPostalCode: '',
      sellerCountryIso2: '',
      contextIdentifier: '',
      paymentFormaPlatnosci: '',
      paymentBankAccountNrRb: '',
      paymentBankAccountBankName: '',
      paymentBankAccountSwift: '',
      paymentTermDays: '',
      paymentSkontoConditions: '',
      paymentSkontoAmount: '',
      ...defaultValues,
    },
  });
  return (
    <KsefStructuredSection
      connection={ksefConnection}
      form={form as any}
      configIsParseable={configIsParseable}
      syncStructuredToJson={syncStructuredToJson}
    />
  );
}

describe('KsefStructuredSection — payment fields (#1311)', () => {
  afterEach(cleanup);

  it('routes the payment-method Select change to the paymentFormaPlatnosci field', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    fireEvent.change(screen.getByLabelText('Default payment method'), { target: { value: '6' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith('paymentFormaPlatnosci', '6');
  });

  it('routes bank account number changes to the paymentBankAccountNrRb field', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    fireEvent.change(screen.getByLabelText('Bank account number'), {
      target: { value: '61109010140000000099999999' },
    });

    expect(syncStructuredToJson).toHaveBeenCalledWith(
      'paymentBankAccountNrRb',
      '61109010140000000099999999',
    );
  });

  it('routes bank name changes to the paymentBankAccountBankName field', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    fireEvent.change(screen.getByLabelText('Bank name'), { target: { value: 'Santander' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith('paymentBankAccountBankName', 'Santander');
  });

  it('routes SWIFT changes to the paymentBankAccountSwift field', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    fireEvent.change(screen.getByLabelText('SWIFT'), { target: { value: 'WBKPPLPP' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith('paymentBankAccountSwift', 'WBKPPLPP');
  });

  it('routes payment term changes to the paymentTermDays field', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    fireEvent.change(screen.getByLabelText('Default payment term (days)'), {
      target: { value: '14' },
    });

    expect(syncStructuredToJson).toHaveBeenCalledWith('paymentTermDays', '14');
  });

  it('routes skonto conditions/amount changes to their fields', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    fireEvent.change(screen.getByLabelText('Early-payment discount conditions'), {
      target: { value: 'paid within 7 days' },
    });
    fireEvent.change(screen.getByLabelText('Early-payment discount amount'), {
      target: { value: '2%' },
    });

    expect(syncStructuredToJson).toHaveBeenCalledWith(
      'paymentSkontoConditions',
      'paid within 7 days',
    );
    expect(syncStructuredToJson).toHaveBeenCalledWith('paymentSkontoAmount', '2%');
  });

  it('pre-fills payment fields from the hydrated form value', () => {
    renderWithProviders(
      <Harness
        defaultValues={{
          paymentFormaPlatnosci: '6',
          paymentBankAccountNrRb: '61109010140000000099999999',
          paymentBankAccountBankName: 'Santander',
          paymentTermDays: '14',
        }}
      />,
    );
    expect(screen.getByDisplayValue('61109010140000000099999999')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Santander')).toBeInTheDocument();
    expect(screen.getByDisplayValue('14')).toBeInTheDocument();
  });

  it('disables all payment inputs when configText is unparseable', () => {
    renderWithProviders(<Harness configIsParseable={false} />);
    expect(screen.getByLabelText('Default payment method')).toBeDisabled();
    expect(screen.getByLabelText('Bank account number')).toBeDisabled();
    expect(screen.getByLabelText('SWIFT')).toBeDisabled();
    expect(screen.getByLabelText('Default payment term (days)')).toBeDisabled();
  });
});
