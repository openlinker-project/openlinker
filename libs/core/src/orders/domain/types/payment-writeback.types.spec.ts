/**
 * Payment Writeback rule specs (#3963)
 *
 * Pins every case from the issue's acceptance criteria against the pure rule:
 * what is sent, what is only recorded, and what is left alone.
 */
import {
  decidePaymentWriteback,
  hasPaymentWritebackProblem,
  isCashOnDeliveryOrder,
  isPaymentWritebackProblem,
  readPaymentWriteback,
  type DecidePaymentWritebackInput,
  type PaymentWriteback,
} from './payment-writeback.types';

const AT = '2026-11-04T14:07:00.000Z';

function input(overrides: Partial<DecidePaymentWritebackInput> = {}): DecidePaymentWritebackInput {
  return {
    paymentStatus: 'paid',
    paymentMethod: 'online',
    storedPaymentStatus: 'awaiting',
    storedPaymentMethod: 'online',
    hadRecord: true,
    isCancelled: false,
    hasRefund: false,
    destinations: [{ connectionId: 'ps', synced: true, createdNow: false, mode: 'mark-paid' }],
    existing: { ps: { state: 'awaiting', at: AT, attempts: 0 } },
    ...overrides,
  };
}

describe('decidePaymentWriteback', () => {
  it('should send when a shop holds the order as awaiting and the buyer has paid', () => {
    expect(decidePaymentWriteback(input())).toEqual([{ connectionId: 'ps', action: 'send' }]);
  });

  it('should record awaiting when a shop gets an unpaid order in this run', () => {
    const result = decidePaymentWriteback(
      input({
        paymentStatus: 'awaiting',
        hadRecord: false,
        storedPaymentStatus: undefined,
        destinations: [{ connectionId: 'ps', synced: true, createdNow: true, mode: 'mark-paid' }],
        existing: {},
      })
    );
    expect(result).toEqual([{ connectionId: 'ps', action: 'record', state: 'awaiting' }]);
  });

  it('should record created-paid and send nothing when a shop gets an already paid order', () => {
    const result = decidePaymentWriteback(
      input({
        destinations: [{ connectionId: 'ps', synced: true, createdNow: true, mode: 'mark-paid' }],
        existing: {},
      })
    );
    expect(result).toEqual([{ connectionId: 'ps', action: 'record', state: 'created-paid' }]);
  });

  it('should leave a shop provisioned before the feature alone when the previous record was already paid', () => {
    const result = decidePaymentWriteback(input({ storedPaymentStatus: 'paid', existing: {} }));
    expect(result).toEqual([]);
  });

  it('should send for a shop provisioned before the feature when the previous record was unpaid', () => {
    const result = decidePaymentWriteback(input({ storedPaymentStatus: 'awaiting', existing: {} }));
    expect(result).toEqual([{ connectionId: 'ps', action: 'send' }]);
  });

  it('should not send for a shop provisioned before the feature when there was no previous record', () => {
    const result = decidePaymentWriteback(input({ hadRecord: false, storedPaymentStatus: undefined, existing: {} }));
    expect(result).toEqual([]);
  });

  it.each([
    ['payment method on the current snapshot', { paymentMethod: 'cash_on_delivery' as const }],
    ['payment method on the stored snapshot', { storedPaymentMethod: 'cash_on_delivery' as const }],
    ['cod status on the stored snapshot, now reported paid', { storedPaymentStatus: 'cod' as const }],
  ])('should record cod and never send when cash on delivery is on the %s', (_label, overrides) => {
    const result = decidePaymentWriteback(input(overrides));
    expect(result).toEqual([{ connectionId: 'ps', action: 'record', state: 'cod' }]);
  });

  it('should record not-sent with reason cancelled when the buyer paid a cancelled order', () => {
    const result = decidePaymentWriteback(input({ isCancelled: true }));
    expect(result).toEqual([{ connectionId: 'ps', action: 'record', state: 'not-sent', reason: 'cancelled' }]);
  });

  it('should record not-sent with reason refunded when the order has a refund', () => {
    const result = decidePaymentWriteback(input({ hasRefund: true }));
    expect(result).toEqual([{ connectionId: 'ps', action: 'record', state: 'not-sent', reason: 'refunded' }]);
  });

  it('should record skipped-by-setting when the connection leaves payment to the operator', () => {
    const result = decidePaymentWriteback(
      input({ destinations: [{ connectionId: 'ps', synced: true, createdNow: false, mode: 'leave' }] })
    );
    expect(result).toEqual([{ connectionId: 'ps', action: 'record', state: 'skipped-by-setting' }]);
  });

  it.each(['sending', 'retrying', 'paid-in-shop', 'created-paid', 'not-sent', 'cod', 'not-tracked', 'skipped-by-setting', 'handled'] as const)(
    'should leave a %s entry alone',
    (state) => {
      const result = decidePaymentWriteback(input({ existing: { ps: { state, at: AT, attempts: 1 } } }));
      expect(result).toEqual([]);
    }
  );

  it('should do nothing while the order is still unpaid and the shop already has it', () => {
    expect(decidePaymentWriteback(input({ paymentStatus: 'awaiting' }))).toEqual([]);
  });

  it('should skip a destination that has no synced order', () => {
    const result = decidePaymentWriteback(
      input({ destinations: [{ connectionId: 'ps', synced: false, createdNow: false, mode: 'mark-paid' }] })
    );
    expect(result).toEqual([]);
  });

  it('should decide each destination on its own', () => {
    const result = decidePaymentWriteback(
      input({
        destinations: [
          { connectionId: 'ps', synced: true, createdNow: false, mode: 'mark-paid' },
          { connectionId: 'woo', synced: true, createdNow: false, mode: 'mark-paid' },
        ],
        existing: {
          ps: { state: 'paid-in-shop', at: AT, attempts: 1 },
          woo: { state: 'awaiting', at: AT, attempts: 0 },
        },
      })
    );
    expect(result).toEqual([{ connectionId: 'woo', action: 'send' }]);
  });
});

describe('isCashOnDeliveryOrder', () => {
  it('should be false for an online payment on both snapshots', () => {
    expect(isCashOnDeliveryOrder({ paymentMethod: 'online', paymentStatus: 'paid' })).toBe(false);
  });
});

describe('readPaymentWriteback', () => {
  it('should drop entries with an unknown state and keep valid ones', () => {
    const raw = { ps: { state: 'paid-in-shop', at: AT, attempts: 1 }, woo: { state: 'teleported', at: AT } };
    expect(readPaymentWriteback(raw)).toEqual({ ps: { state: 'paid-in-shop', at: AT, attempts: 1 } });
  });

  it.each([null, undefined, 'x', 3, []])('should read %p as an empty record', (raw) => {
    expect(readPaymentWriteback(raw)).toEqual({});
  });
});

describe('isPaymentWritebackProblem', () => {
  it.each([
    ['retries-exhausted', true],
    ['rejected', true],
    ['cancelled', false],
    ['refunded', false],
  ] as const)('should report reason %s as a problem: %s', (reason, expected) => {
    expect(isPaymentWritebackProblem({ state: 'not-sent', reason, at: AT, attempts: 8 })).toBe(expected);
  });

  it('should not report a retrying entry as a problem', () => {
    const writeback: PaymentWriteback = { woo: { state: 'retrying', at: AT, attempts: 2 } };
    expect(hasPaymentWritebackProblem(writeback)).toBe(false);
  });
});
