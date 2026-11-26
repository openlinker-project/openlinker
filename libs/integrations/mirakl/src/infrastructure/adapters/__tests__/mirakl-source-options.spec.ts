/**
 * Mirakl Source Options: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import { MiraklSourceOptions } from '../mirakl-source-options';

describe('MiraklSourceOptions', () => {
  it('should list SH12 shipping types as delivery methods, keyed by code', async () => {
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        shipping_types: [
          { code: 'PACKSTATION', label: 'Paczkomaty InPost' },
          { code: 'STORE', label: 'Salon Empik' },
          { code: 'DIGITAL' },
          { code: 'STORE', label: 'duplicate' },
          { label: 'no code' },
        ],
      },
    });

    const options = await new MiraklSourceOptions({
      get,
    } as unknown as IMiraklHttpClient).listDeliveryMethods();

    expect(get).toHaveBeenCalledWith('/api/shipping/types');
    expect(options).toEqual([
      { value: 'PACKSTATION', label: 'Paczkomaty InPost' },
      { value: 'STORE', label: 'Salon Empik' },
      { value: 'DIGITAL', label: 'DIGITAL' },
    ]);
  });

  it('should list the Mirakl order states and the two payment methods', async () => {
    const reader = new MiraklSourceOptions({} as IMiraklHttpClient);

    expect((await reader.listOrderStatuses()).map((option) => option.value)).toContain('SHIPPING');
    expect((await reader.listPaymentMethods()).map((option) => option.value)).toEqual([
      'online',
      'cash_on_delivery',
    ]);
  });
});
