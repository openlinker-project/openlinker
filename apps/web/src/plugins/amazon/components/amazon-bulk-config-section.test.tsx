/**
 * AmazonBulkConfigSection tests (#4186)
 *
 * @module plugins/amazon/components
 */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it } from 'vitest';
import type { Connection } from '../../../features/connections';
import type { BulkConfigFormValues } from '../../../shared/plugins';
import { renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { AmazonBulkConfigSection, amazonBulkConfigIsComplete } from './amazon-bulk-config-section';

let currentCurrency = '';

function Harness({ config }: { config: Record<string, unknown> }): ReactElement {
  const form = useForm<BulkConfigFormValues>({
    defaultValues: {
      pricingMode: 'use-master',
      markupPercent: '',
      flatPriceAmount: '',
      stockMode: 'use-master',
      capValue: '',
      flatStockValue: '',
      publishImmediately: true,
      generateDescription: false,
      currency: 'PLN',
      platformParams: {},
    },
  });
  currentCurrency = form.watch('currency');
  return (
    <AmazonBulkConfigSection
      connection={{ ...sampleConnection, platformType: 'amazon', config } as Connection}
      form={form}
    />
  );
}

afterEach(cleanup);

describe('AmazonBulkConfigSection', () => {
  it('should take the only currency of the connection and say where offers go', async () => {
    renderWithProviders(<Harness config={{ marketplaceIds: ['ATVPDKIKX0DER'], sellerId: 'A2EXAMPLE12345' }} />);

    expect(await screen.findByText('Offers go to: United States.')).toBeInTheDocument();
    await waitFor(() => expect(currentCurrency).toBe('USD'));
    expect(screen.queryByLabelText('Offer currency')).toBeNull();
  });

  it('should let the operator pick a currency when the marketplaces use several', async () => {
    renderWithProviders(
      <Harness config={{ marketplaceIds: ['A1PA6795UKMFR9', 'A13V1IB3VIYZZH', 'A1C3SOZRARQ6R3'], sellerId: 'A2EXAMPLE12345' }} />,
    );

    fireEvent.change(await screen.findByLabelText('Offer currency'), { target: { value: 'EUR' } });

    expect(await screen.findByText('Offers go to: Germany, France.')).toBeInTheDocument();
  });

  it('should warn when the merchant token is missing', async () => {
    renderWithProviders(<Harness config={{ marketplaceIds: ['A1C3SOZRARQ6R3'] }} />);

    expect(await screen.findByText(/Without the merchant token/)).toBeInTheDocument();
  });

  it('should be complete once a currency is set', () => {
    expect(amazonBulkConfigIsComplete({ currency: 'PLN' } as BulkConfigFormValues)).toBe(true);
    expect(amazonBulkConfigIsComplete({ currency: '' } as BulkConfigFormValues)).toBe(false);
  });
});
