/**
 * ShoperStructuredSection tests (#3644, #3702)
 *
 * The section is the plugin's single edit-connection slot, so it must carry
 * BOTH the webhook callback URL and the order defaults. A merge once dropped the
 * second one silently, which is what the last test pins.
 *
 * @module plugins/shoper/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../../features/connections';
import { ShoperStructuredSection } from './shoper-structured-section';

vi.mock('../../../features/mappings', () => ({
  useMappingOptions: () => ({
    isLoading: false,
    errors: {},
    options: {
      prestashopCarriers: [],
      prestashopPaymentModules: [],
      prestashopOrderStatuses: [],
    },
  }),
}));

function Harness({ caps }: { caps: string[] }): ReactElement {
  const form = useForm<any>({
    defaultValues: {
      openlinkerCallbackBaseUrl: '',
      shoperShippingId: '',
      shoperPaymentId: '',
      shoperStatusId: '',
    },
  });
  return (
    <ShoperStructuredSection
      connection={{ ...sampleConnection, platformType: 'shoper', enabledCapabilities: caps } as Connection}
      form={form}
      configIsParseable
      syncStructuredToJson={vi.fn()}
    />
  );
}

afterEach(cleanup);

describe('ShoperStructuredSection', () => {
  it('should render the callback URL and, for a shop that receives orders, the defaults', () => {
    renderWithProviders(<Harness caps={['OrderSource', 'OrderProcessorManager']} />);

    expect(screen.getByLabelText('OL callback URL')).toBeTruthy();
    expect(screen.getByLabelText(/default delivery method/i)).toBeTruthy();
    expect(screen.getByLabelText(/default payment method/i)).toBeTruthy();
    expect(screen.getByLabelText(/default order status/i)).toBeTruthy();
    expect(screen.queryByText('Order source is off')).toBeNull();
  });

  it('should warn that webhooks need Order source when it is off', () => {
    renderWithProviders(<Harness caps={['ProductMaster']} />);

    expect(screen.getByText('Order source is off')).toBeTruthy();
    expect(screen.getByText(/only when this shop receives orders/i)).toBeTruthy();
  });
});
