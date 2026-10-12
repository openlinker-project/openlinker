/**
 * ShoperOrderDefaultsSection tests (#3702)
 *
 * Pins what a regression would hide: the capability gate (no controls that can
 * only error), the id a pick writes (the shop's own number, never the label),
 * the lock on unparseable JSON, and a stored id the shop no longer lists.
 *
 * @module plugins/shoper/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../../features/connections';
import { ShoperOrderDefaultsSection } from './shoper-order-defaults-section';

const useMappingOptionsMock = vi.hoisted(() => vi.fn());
vi.mock('../../../features/mappings', () => ({ useMappingOptions: useMappingOptionsMock }));

function connection(enabledCapabilities: string[]): Connection {
  return {
    ...sampleConnection,
    id: 'shoper_1',
    platformType: 'shoper',
    enabledCapabilities,
  } as Connection;
}

function givenOptions(overrides: Record<string, unknown> = {}): void {
  useMappingOptionsMock.mockReturnValue({
    isLoading: false,
    errors: {},
    options: {
      prestashopCarriers: [
        { value: '8', label: 'InPost Paczkomaty' },
        { value: '9', label: 'Kurier DPD' },
      ],
      prestashopPaymentModules: [{ value: '1', label: 'Przelew tradycyjny' }],
      prestashopOrderStatuses: [{ value: '3', label: 'Nowe' }],
      ...overrides,
    },
  });
}

function Harness({
  caps = ['ProductMaster', 'OrderProcessorManager'],
  configIsParseable = true,
  sync = vi.fn(),
  defaults = {},
}: {
  caps?: string[];
  configIsParseable?: boolean;
  sync?: (field: string, value: string) => void;
  defaults?: Record<string, string>;
}): ReactElement {
  const form = useForm<any>({
    defaultValues: { shoperShippingId: '', shoperPaymentId: '', shoperStatusId: '', ...defaults },
  });
  return (
    <ShoperOrderDefaultsSection
      connection={connection(caps)}
      form={form}
      configIsParseable={configIsParseable}
      syncStructuredToJson={sync}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShoperOrderDefaultsSection', () => {
  it('should explain itself instead of rendering controls when orders are not received', () => {
    givenOptions();
    renderWithProviders(<Harness caps={['ProductMaster']} />);

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(/only when this shop receives orders/i)).toBeTruthy();
    expect(useMappingOptionsMock).toHaveBeenCalledWith('', expect.any(Set));
  });

  it('should list the shop\'s own names for delivery, payment and status', () => {
    givenOptions();
    renderWithProviders(<Harness />);

    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'InPost Paczkomaty' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Przelew tradycyjny' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Nowe' })).toBeTruthy();
  });

  it('should fetch only the three destination lists', () => {
    givenOptions();
    renderWithProviders(<Harness />);

    const keys = useMappingOptionsMock.mock.calls[0][1] as Set<string>;
    expect([...keys].sort()).toEqual([
      'prestashopCarriers',
      'prestashopOrderStatuses',
      'prestashopPaymentModules',
    ]);
  });

  it('should write the shop\'s id, not the label, when a name is picked', () => {
    givenOptions();
    const sync = vi.fn();
    renderWithProviders(<Harness sync={sync} />);

    fireEvent.change(screen.getByLabelText(/default delivery method/i), { target: { value: '9' } });

    expect(sync).toHaveBeenCalledWith('shoperShippingId', '9');
  });

  it('should disable every control while the raw JSON is unparseable', () => {
    givenOptions();
    renderWithProviders(<Harness configIsParseable={false} />);

    for (const select of screen.getAllByRole('combobox')) {
      expect((select as HTMLSelectElement).disabled).toBe(true);
    }
  });

  it('should keep a stored id the shop no longer lists visible instead of showing it as unset', () => {
    givenOptions();
    renderWithProviders(<Harness defaults={{ shoperPaymentId: '77' }} />);

    expect(screen.getByRole('option', { name: /Saved id 77/ })).toBeTruthy();
  });

  it('should say so, not show an empty list, when the shop cannot be read', () => {
    givenOptions();
    useMappingOptionsMock.mockReturnValue({
      isLoading: false,
      errors: { prestashopCarriers: new Error('boom') },
      options: {
        prestashopCarriers: [],
        prestashopPaymentModules: [],
        prestashopOrderStatuses: [],
      },
    });
    renderWithProviders(<Harness />);

    expect(screen.getByText('Could not load the list from Shoper')).toBeTruthy();
  });
});
