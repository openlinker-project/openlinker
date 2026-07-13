/**
 * Mark Invoice Paid Request DTO — validation spec (#1362)
 *
 * Exercises the class-validator constraints on `MarkInvoicePaidRequestDto`, in
 * particular the calendar-date-only `paidDate` shape: a full ISO datetime is
 * rejected because the adapter-side `.toISOString().slice(0, 10)` would let a
 * near-midnight value roll the settlement date back a day.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { MarkInvoicePaidRequestDto } from './mark-invoice-paid-request.dto';

function buildDto(payload: Record<string, unknown>): MarkInvoicePaidRequestDto {
  return plainToInstance(MarkInvoicePaidRequestDto, payload);
}

describe('MarkInvoicePaidRequestDto', () => {
  it('should pass validation when paidDate is a calendar date (YYYY-MM-DD)', async () => {
    const errors = await validate(buildDto({ paidDate: '2026-07-08' }));

    expect(errors).toHaveLength(0);
  });

  it('should pass validation when paidDate is omitted (bare {})', async () => {
    const errors = await validate(buildDto({}));

    expect(errors).toHaveLength(0);
  });

  it('should reject a full ISO datetime (calendar-date-only field)', async () => {
    const errors = await validate(buildDto({ paidDate: '2026-07-08T23:30:00+02:00' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('should reject an impossible calendar date', async () => {
    const errors = await validate(buildDto({ paidDate: '2026-13-45' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isIso8601');
  });
});
