/**
 * Payment-method map form helpers (#3775)
 *
 * @module features/connections/lib
 */
import { describe, expect, it } from 'vitest';
import { mergeStructuredIntoConfig } from '../components/edit-connection.schema';
import { readPaymentMethodMapForm } from './payment-method-map';

describe('readPaymentMethodMapForm', () => {
  it('should lowercase and trim keys so a hand-typed id lines up with the observed one', () => {
    expect(readPaymentMethodMapForm({ paymentMethodMap: { ' PayU ': 'online' } })).toEqual({
      payu: 'online',
    });
  });

  it.each([[undefined], [null], [{}], [{ paymentMethodMap: 'x' }], [{ paymentMethodMap: ['a'] }]])(
    'should read %j as an empty map',
    (config) => {
      expect(readPaymentMethodMapForm(config as never)).toEqual({});
    },
  );

  it('should drop blank keys, unknown and invalid values', () => {
    expect(
      readPaymentMethodMapForm({
        paymentMethodMap: { '': 'online', a: 'unknown', b: 'card', c: 5, d: 'cash_on_delivery' },
      }),
    ).toEqual({ d: 'cash_on_delivery' });
  });
});

describe('mergeStructuredIntoConfig paymentMethodMap clause', () => {
  it('should write the map with normalised keys, dropping blank choices, and keep sibling keys', () => {
    const merged = mergeStructuredIntoConfig(
      { baseUrl: 'https://x', stockSafetyBuffer: 2 },
      { paymentMethodMap: { PayU: 'online', p24: '', cod: 'unknown' } },
    );

    expect(merged.paymentMethodMap).toEqual({ payu: 'online' });
    expect(merged.baseUrl).toBe('https://x');
    expect(merged.stockSafetyBuffer).toBe(2);
  });

  it('should write an explicit null, not delete the key, when nothing is left', () => {
    const merged = mergeStructuredIntoConfig(
      { paymentMethodMap: { payu: 'online' } },
      { paymentMethodMap: { payu: '' } },
    );

    expect(merged).toHaveProperty('paymentMethodMap', null);
  });

  it('should leave the key alone when the patch does not carry it', () => {
    const merged = mergeStructuredIntoConfig({ paymentMethodMap: { payu: 'online' } }, {});

    expect(merged.paymentMethodMap).toEqual({ payu: 'online' });
  });
});
