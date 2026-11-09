/**
 * Payment Writeback config coercer specs (#3963)
 */
import {
  DEFAULT_PAYMENT_WRITEBACK_CONFIG,
  describeInvalidPaymentWritebackConfig,
  readPaymentWritebackConfig,
} from './payment-writeback-config.types';

describe('readPaymentWritebackConfig', () => {
  it.each([null, undefined, {}, { paymentWriteback: 'yes' }, { paymentWriteback: [] }])(
    'should return the default for %p',
    (config) => {
      expect(readPaymentWritebackConfig(config as never)).toEqual(DEFAULT_PAYMENT_WRITEBACK_CONFIG);
    }
  );

  it('should read leave mode and a string state id', () => {
    expect(readPaymentWritebackConfig({ paymentWriteback: { mode: 'leave', paidStateId: ' 2 ' } })).toEqual({
      mode: 'leave',
      paidStateId: '2',
    });
  });

  it('should accept a numeric state id', () => {
    expect(readPaymentWritebackConfig({ paymentWriteback: { mode: 'mark-paid', paidStateId: 11 } }).paidStateId).toBe('11');
  });

  it('should fall back to mark-paid for an unknown mode', () => {
    expect(readPaymentWritebackConfig({ paymentWriteback: { mode: 'maybe' } }).mode).toBe('mark-paid');
  });
});

describe('describeInvalidPaymentWritebackConfig', () => {
  it('should accept an absent value', () => {
    expect(describeInvalidPaymentWritebackConfig({})).toBeNull();
  });

  it('should accept a valid value', () => {
    expect(describeInvalidPaymentWritebackConfig({ paymentWriteback: { mode: 'leave', paidStateId: null } })).toBeNull();
  });

  it('should reject an unknown mode', () => {
    expect(describeInvalidPaymentWritebackConfig({ paymentWriteback: { mode: 'maybe' } })).toMatch(/mode/);
  });

  it('should reject an empty state id', () => {
    expect(describeInvalidPaymentWritebackConfig({ paymentWriteback: { mode: 'mark-paid', paidStateId: '' } })).toMatch(
      /paidStateId/
    );
  });
});
