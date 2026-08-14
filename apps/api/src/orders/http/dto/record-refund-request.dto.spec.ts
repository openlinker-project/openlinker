/**
 * Record Refund Request DTO — validation spec (#2036)
 *
 * Exercises the class-validator constraints on `RecordRefundRequestDto`, in
 * particular the hand-crafted `amount` regex (non-negative decimal, up to 2
 * decimal places, `0` explicitly allowed as a goodwill-return capture).
 *
 * @module apps/api/src/orders/http/dto
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { RecordRefundRequestDto } from './record-refund-request.dto';

function buildDto(payload: Record<string, unknown>): RecordRefundRequestDto {
  return plainToInstance(RecordRefundRequestDto, payload);
}

const validBase = { amount: '49.99', currency: 'PLN', reason: 'withdrawal' };

describe('RecordRefundRequestDto', () => {
  it('should pass validation for a valid non-negative decimal amount', async () => {
    const errors = await validate(buildDto(validBase));

    expect(errors).toHaveLength(0);
  });

  it('should pass validation when optional note and recordedAt are omitted', async () => {
    const errors = await validate(buildDto(validBase));

    expect(errors).toHaveLength(0);
  });

  it('should accept a zero amount (goodwill return, no money moved)', async () => {
    const errors = await validate(buildDto({ ...validBase, amount: '0' }));

    expect(errors).toHaveLength(0);
  });

  it('should accept an integer amount with no decimal part', async () => {
    const errors = await validate(buildDto({ ...validBase, amount: '10' }));

    expect(errors).toHaveLength(0);
  });

  it('should reject a negative amount', async () => {
    const errors = await validate(buildDto({ ...validBase, amount: '-5.00' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('should reject an amount with more than 2 decimal places', async () => {
    const errors = await validate(buildDto({ ...validBase, amount: '49.999' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('should reject a non-numeric amount', async () => {
    const errors = await validate(buildDto({ ...validBase, amount: 'abc' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('should reject a currency code that is not exactly 3 characters', async () => {
    const errors = await validate(buildDto({ ...validBase, currency: 'PL' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isLength');
  });

  it('should reject a reason outside the RefundReasonValues union', async () => {
    const errors = await validate(buildDto({ ...validBase, reason: 'not_a_real_reason' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isIn');
  });

  it('should reject a note longer than 1000 characters', async () => {
    const errors = await validate(buildDto({ ...validBase, note: 'x'.repeat(1001) }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('should accept a valid ISO8601 recordedAt', async () => {
    const errors = await validate(buildDto({ ...validBase, recordedAt: '2026-01-15T10:00:00Z' }));

    expect(errors).toHaveLength(0);
  });

  it('should reject a malformed recordedAt', async () => {
    const errors = await validate(buildDto({ ...validBase, recordedAt: 'not-a-date' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isIso8601');
  });

  it('should accept an optional idempotencyKey', async () => {
    const errors = await validate(buildDto({ ...validBase, idempotencyKey: 'retry-1' }));

    expect(errors).toHaveLength(0);
  });

  it('should reject an idempotencyKey longer than 255 characters', async () => {
    const errors = await validate(buildDto({ ...validBase, idempotencyKey: 'x'.repeat(256) }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });
});
