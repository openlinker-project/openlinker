import { toSourceRefundObservations } from '../allegro-payment-refund.mapper';

describe('toSourceRefundObservations', () => {
  it('should map a settled refund to a neutral observation when it is complete', () => {
    expect(
      toSourceRefundObservations([
        {
          id: 'r1',
          status: 'SUCCESS',
          createdAt: '2026-11-16T20:44:36.650Z',
          totalValue: { amount: '317.22', currency: 'PLN' },
        },
      ])
    ).toEqual([
      {
        externalRefundId: 'r1',
        amount: '317.22',
        currency: 'PLN',
        occurredAt: new Date('2026-11-16T20:44:36.650Z'),
      },
    ]);
  });

  it('should drop refunds that are not settled or are incomplete', () => {
    expect(
      toSourceRefundObservations([
        { id: 'p', status: 'PENDING', totalValue: { amount: '1.00', currency: 'PLN' } },
        { id: 'z', status: 'SUCCESS', totalValue: { amount: '0', currency: 'PLN' } },
        { status: 'SUCCESS', totalValue: { amount: '1.00', currency: 'PLN' } },
        { id: 'n', status: 'SUCCESS', totalValue: { currency: 'PLN' } },
      ])
    ).toEqual([]);
  });

  it('should report a null instant when createdAt is absent or unparseable', () => {
    const [a, b] = toSourceRefundObservations([
      { id: 'a', status: 'SUCCESS', totalValue: { amount: '1.00', currency: 'PLN' } },
      { id: 'b', status: 'SUCCESS', createdAt: 'nope', totalValue: { amount: '1.00', currency: 'PLN' } },
    ]);
    expect(a.occurredAt).toBeNull();
    expect(b.occurredAt).toBeNull();
  });
});
