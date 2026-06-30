/**
 * InpostStructuredSection tests (#771)
 *
 * Renders the plugin-owned structured section the way EditConnectionForm does
 * (via renderWithProviders, so usePlatform('inpost') resolves and i18n is
 * provided). Pins the flat-field sync routing, the whole-object sender-address
 * serializer seam, and the parseable-JSON disable gate.
 *
 * @module plugins/inpost/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../../features/connections';
import { InpostStructuredSection } from './inpost-structured-section';

const inpostConnection: Connection = {
  ...sampleConnection,
  id: 'inpost_1',
  name: 'InPost ShipX',
  platformType: 'inpost',
  config: {},
  adapterKey: 'inpost.shipx.v1',
};

interface HarnessProps {
  configIsParseable?: boolean;
  syncStructuredToJson?: (field: string, value: string) => void;
  syncInpostSenderAddressToJson?: () => void;
  defaultValues?: Record<string, unknown>;
}

function Harness({
  configIsParseable = true,
  syncStructuredToJson = vi.fn(),
  syncInpostSenderAddressToJson = vi.fn(),
  defaultValues = {},
}: HarnessProps): ReactElement {
  const form = useForm<any>({
    defaultValues: {
      inpostEnvironment: '',
      inpostOrganizationId: '',
      inpostSenderAddress: {
        name: '',
        email: '',
        phone: '',
        address: { street: '', buildingNumber: '', city: '', postCode: '', countryCode: '' },
      },
      ...defaultValues,
    },
  });
  return (
    <InpostStructuredSection
      connection={inpostConnection}
      form={form as any}
      configIsParseable={configIsParseable}
      syncStructuredToJson={syncStructuredToJson}
      syncInpostSenderAddressToJson={syncInpostSenderAddressToJson}
    />
  );
}

describe('InpostStructuredSection', () => {
  afterEach(cleanup);

  it('routes the environment Select change to the inpostEnvironment field', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'production' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith('inpostEnvironment', 'production');
  });

  it('routes organization id changes to the inpostOrganizationId field', () => {
    const syncStructuredToJson = vi.fn();
    renderWithProviders(<Harness syncStructuredToJson={syncStructuredToJson} />);

    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '987654' } });

    expect(syncStructuredToJson).toHaveBeenCalledWith('inpostOrganizationId', '987654');
  });

  it('re-serializes the whole sender address via syncInpostSenderAddressToJson on a sender-field change', () => {
    const syncInpostSenderAddressToJson = vi.fn();
    renderWithProviders(
      <Harness syncInpostSenderAddressToJson={syncInpostSenderAddressToJson} />,
    );

    fireEvent.change(screen.getByPlaceholderText('Warszawa'), { target: { value: 'Kraków' } });

    expect(syncInpostSenderAddressToJson).toHaveBeenCalled();
  });

  it('pre-fills sender fields from the hydrated form value', () => {
    renderWithProviders(
      <Harness
        defaultValues={{
          inpostSenderAddress: {
            name: 'Sklep ACME',
            email: 'magazyn@acme.pl',
            phone: '+48111222333',
            address: {
              street: 'ul. Magazynowa',
              buildingNumber: '1',
              city: 'Warszawa',
              postCode: '00-001',
              countryCode: 'PL',
            },
          },
        }}
      />,
    );
    expect(screen.getByDisplayValue('magazyn@acme.pl')).toBeInTheDocument();
    expect(screen.getByDisplayValue('00-001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Warszawa')).toBeInTheDocument();
  });

  it('disables all inputs when configText is unparseable', () => {
    renderWithProviders(<Harness configIsParseable={false} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByPlaceholderText('123456')).toBeDisabled();
    expect(screen.getByPlaceholderText('00-001')).toBeDisabled();
  });
});
