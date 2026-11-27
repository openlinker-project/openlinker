/**
 * PaymentMethodsSection tests (#3775)
 *
 * @module features/connections/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { PaymentMethodsSection } from './payment-methods-section';
import type { ObservedPaymentMethods } from '../api/connections.types';

function observed(overrides: Partial<ObservedPaymentMethods> = {}): ObservedPaymentMethods {
  return {
    mapSupport: 'supported',
    windowDays: 90,
    items: [
      {
        sourcePaymentMethod: 'payu',
        orderCount: 3,
        lastSeenAt: '2026-07-01T10:00:00.000Z',
        platformMethod: 'unknown',
        operatorMethod: null,
        resolvedMethod: 'unknown',
        resolvedBy: 'none',
      },
      {
        sourcePaymentMethod: 'cod',
        orderCount: 1,
        lastSeenAt: '2026-07-02T10:00:00.000Z',
        platformMethod: 'cash_on_delivery',
        operatorMethod: null,
        resolvedMethod: 'cash_on_delivery',
        resolvedBy: 'platform',
      },
    ],
    ...overrides,
  };
}

function Harness({
  initial = {},
  configIsParseable = true,
  canWrite = true,
  sync,
}: {
  initial?: Record<string, string>;
  configIsParseable?: boolean;
  canWrite?: boolean;
  sync: () => void;
}): ReactElement {
  const form = useForm<any>({ defaultValues: { paymentMethodMap: initial } });
  return (
    <>
      <PaymentMethodsSection
        form={form}
        connectionId="conn_1"
        configIsParseable={configIsParseable}
        canWrite={canWrite}
        syncPaymentMethodMapToJson={sync}
      />
      <output data-testid="value">{JSON.stringify(form.watch('paymentMethodMap'))}</output>
    </>
  );
}

function renderSection(
  response: ObservedPaymentMethods | Error,
  props: Partial<Parameters<typeof Harness>[0]> = {},
): { sync: ReturnType<typeof vi.fn> } {
  const sync = vi.fn();
  const getObservedPaymentMethods =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);
  renderWithProviders(<Harness sync={sync} {...props} />, {
    apiClient: createMockApiClient({ connections: { getObservedPaymentMethods } }),
  });
  return { sync };
}

describe('PaymentMethodsSection', () => {
  afterEach(cleanup);

  it('should show a select for an unmapped gateway and a read-only note for a platform-defined one', async () => {
    renderSection(observed());

    expect(await screen.findByTestId('payment-method-select-payu')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-method-select-cod')).not.toBeInTheDocument();
    expect(screen.getByText('Defined by the shop: Cash on delivery')).toBeInTheDocument();
  });

  it('should set the form value, then serialize, when a gateway is mapped', async () => {
    const { sync } = renderSection(observed());

    fireEvent.change(await screen.findByTestId('payment-method-select-payu'), {
      target: { value: 'online' },
    });

    expect(JSON.parse(screen.getByTestId('value').textContent ?? '{}')).toEqual({ payu: 'online' });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('should list a stored mapping for a gateway not seen in the window', async () => {
    renderSection(observed({ items: [] }), { initial: { przelewy24: 'online' } });

    expect(await screen.findByTestId('payment-method-row-przelewy24')).toBeInTheDocument();
    expect(screen.getByText('Not seen in the last 90 days')).toBeInTheDocument();
    expect(screen.getByTestId('payment-method-select-przelewy24')).toHaveValue('online');
  });

  it('should say the window is empty when nothing was observed and nothing is stored', async () => {
    renderSection(observed({ items: [], windowDays: 45 }));

    expect(await screen.findByText(/No orders with a payment module in the last 45 days/)).toBeInTheDocument();
  });

  it('should report a failed read as such, never as an empty list', async () => {
    renderSection(new Error('boom'));

    expect(await screen.findByText('Payment modules unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('payment-methods-rows')).not.toBeInTheDocument();
    expect(screen.queryByText(/No orders with a payment module/)).not.toBeInTheDocument();
  });

  it('should show no controls at all when the integration does not use the map', async () => {
    renderSection(observed({ mapSupport: 'unsupported' }));

    expect(await screen.findByText(/does not use a payment mapping/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('should keep every row editable, with a note, when the connection could not be reached', async () => {
    renderSection(
      observed({
        mapSupport: 'unknown',
        items: observed().items.map((item) => ({
          ...item,
          platformMethod: null,
          resolvedMethod: null,
          resolvedBy: null,
        })),
      }),
    );

    expect(await screen.findByText('Connection not reached')).toBeInTheDocument();
    expect(screen.getByTestId('payment-method-select-payu')).toBeInTheDocument();
    expect(screen.getByTestId('payment-method-select-cod')).toBeInTheDocument();
  });

  it('should disable the selects while the raw JSON does not parse', async () => {
    renderSection(observed(), { configIsParseable: false });

    expect(await screen.findByTestId('payment-method-select-payu')).toBeDisabled();
  });

  it('should show the mapping read-only without write access', async () => {
    renderSection(observed(), { canWrite: false });

    expect(await screen.findByTestId('payment-method-select-payu')).toBeDisabled();
  });
});
