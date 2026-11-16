import { toSourceRefundObservations } from '../allegro-payment-refund.mapper';

const ok = { status: 'SUCCESS', totalValue: { amount: '1.00', currency: 'PLN' } };

describe('toSourceRefundObservations', () => {
  it('should keep only refunds of the requested order when the response mixes orders', () => {
    const result = toSourceRefundObservations(
      [
        { ...ok, id: 'mine', order: { id: 'o1' } },
        { ...ok, id: 'other', order: { id: 'o2' } },
      ],
      'o1'
    );
    expect(result.map((r) => r.externalRefundId)).toEqual(['mine']);
  });

  it('should drop a refund that names no order', () => {
    expect(toSourceRefundObservations([{ ...ok, id: 'x' }], 'o1')).toEqual([]);
  });

  it('should map a settled refund to a neutral observation when it is complete', () => {
    expect(
      toSourceRefundObservations(
        [
          {
            id: 'r1',
            order: { id: 'o1' },
            status: 'SUCCESS',
            createdAt: '2026-11-16T20:44:36.650Z',
            totalValue: { amount: '317.22', currency: 'PLN' },
          },
        ],
        'o1'
      )
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
      toSourceRefundObservations(
        [
          {
            id: 'p',
            order: { id: 'o1' },
            status: 'PENDING',
            totalValue: { amount: '1.00', currency: 'PLN' },
          },
          {
            id: 'z',
            order: { id: 'o1' },
            status: 'SUCCESS',
            totalValue: { amount: '0', currency: 'PLN' },
          },
          {
            order: { id: 'o1' },
            status: 'SUCCESS',
            totalValue: { amount: '1.00', currency: 'PLN' },
          },
          { id: 'n', order: { id: 'o1' }, status: 'SUCCESS', totalValue: { currency: 'PLN' } },
        ],
        'o1'
      )
    ).toEqual([]);
  });

  it('should report a null instant when createdAt is absent or unparseable', () => {
    const [a, b] = toSourceRefundObservations(
      [
        {
          id: 'a',
          order: { id: 'o1' },
          status: 'SUCCESS',
          totalValue: { amount: '1.00', currency: 'PLN' },
        },
        {
          id: 'b',
          order: { id: 'o1' },
          status: 'SUCCESS',
          createdAt: 'nope',
          totalValue: { amount: '1.00', currency: 'PLN' },
        },
      ],
      'o1'
    );
    expect(a.occurredAt).toBeNull();
    expect(b.occurredAt).toBeNull();
  });
});
