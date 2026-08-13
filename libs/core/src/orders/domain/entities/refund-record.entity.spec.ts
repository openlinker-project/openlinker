import { RefundRecord } from './refund-record.entity';

describe('RefundRecord', () => {
  it('should populate all readonly fields from the constructor', () => {
    const recordedAt = new Date('2026-01-15T10:00:00Z');
    const createdAt = new Date('2026-01-15T10:00:01Z');
    const updatedAt = new Date('2026-01-15T10:00:01Z');

    const refund = new RefundRecord(
      'a1b2c3d4-0000-0000-0000-000000000000',
      'ol_order_abc123',
      '49.99',
      'PLN',
      'withdrawal',
      'Buyer exercised 14-day right of withdrawal',
      recordedAt,
      createdAt,
      updatedAt,
    );

    expect(refund.id).toBe('a1b2c3d4-0000-0000-0000-000000000000');
    expect(refund.internalOrderId).toBe('ol_order_abc123');
    expect(refund.amount).toBe('49.99');
    expect(refund.currency).toBe('PLN');
    expect(refund.reason).toBe('withdrawal');
    expect(refund.note).toBe('Buyer exercised 14-day right of withdrawal');
    expect(refund.recordedAt).toBe(recordedAt);
    expect(refund.createdAt).toBe(createdAt);
    expect(refund.updatedAt).toBe(updatedAt);
  });

  it('should allow a null note', () => {
    const now = new Date();
    const refund = new RefundRecord(
      'a1b2c3d4-0000-0000-0000-000000000001',
      'ol_order_def456',
      '0.00',
      'EUR',
      'other',
      null,
      now,
      now,
      now,
    );

    expect(refund.note).toBeNull();
  });

  it('should default idempotencyKey to null when omitted', () => {
    const now = new Date();
    const refund = new RefundRecord(
      'a1b2c3d4-0000-0000-0000-000000000002',
      'ol_order_ghi789',
      '5.00',
      'PLN',
      'other',
      null,
      now,
      now,
      now,
    );

    expect(refund.idempotencyKey).toBeNull();
  });

  it('should populate idempotencyKey when provided', () => {
    const now = new Date();
    const refund = new RefundRecord(
      'a1b2c3d4-0000-0000-0000-000000000003',
      'ol_order_ghi789',
      '5.00',
      'PLN',
      'other',
      null,
      now,
      now,
      now,
      'retry-key-1',
    );

    expect(refund.idempotencyKey).toBe('retry-key-1');
  });
});
