import { describe, expect, it } from 'vitest';

import { paymentMethodChipLabel, paymentMethodLabel } from './payment-method-copy';

describe('paymentMethodLabel', () => {
  it.each([
    ['online', 'Paid online'],
    ['bank_transfer', 'Bank transfer'],
    ['cash_on_delivery', 'Cash on delivery'],
  ] as const)('should label %s as "%s"', (method, label) => {
    expect(paymentMethodLabel(method)).toBe(label);
  });

  it('should say nothing for an unknown or absent method', () => {
    expect(paymentMethodLabel('unknown')).toBeNull();
    expect(paymentMethodLabel(undefined)).toBeNull();
  });
});

describe('paymentMethodChipLabel', () => {
  it('should hide a cash-on-delivery chip that the cod status already states', () => {
    expect(paymentMethodChipLabel('cash_on_delivery', 'cod')).toBeNull();
  });

  it('should keep it when the status says something else', () => {
    expect(paymentMethodChipLabel('cash_on_delivery', 'paid')).toBe('Cash on delivery');
    expect(paymentMethodChipLabel('bank_transfer', 'awaiting')).toBe('Bank transfer');
  });
});
