/**
 * Sales Analytics Query DTO — validation spec (#2459)
 *
 * Exercises the `displayCurrency` / `rateBasis` class-validator constraints
 * added on top of the pre-existing `from`/`to`/`sourceConnectionId` shape —
 * see `record-refund-request.dto.spec.ts` for the same `validate` +
 * `plainToInstance` pattern.
 *
 * @module apps/api/src/analytics/http/dto
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { SalesAnalyticsQueryDto } from './sales-analytics-query.dto';

function buildDto(payload: Record<string, unknown>): SalesAnalyticsQueryDto {
  return plainToInstance(SalesAnalyticsQueryDto, payload);
}

const validBase = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' };

describe('SalesAnalyticsQueryDto', () => {
  it('should pass validation with only the required from/to range (displayCurrency/rateBasis omitted)', async () => {
    const errors = await validate(buildDto(validBase));

    expect(errors).toHaveLength(0);
  });

  it('should accept a displayCurrency in SUPPORTED_REPORTING_CURRENCIES', async () => {
    const errors = await validate(buildDto({ ...validBase, displayCurrency: 'PLN' }));

    expect(errors).toHaveLength(0);
  });

  it('should accept every SUPPORTED_REPORTING_CURRENCIES entry (EUR)', async () => {
    const errors = await validate(buildDto({ ...validBase, displayCurrency: 'EUR' }));

    expect(errors).toHaveLength(0);
  });

  it('should reject a displayCurrency outside SUPPORTED_REPORTING_CURRENCIES (well-formed ISO-4217 shape, unsupported code)', async () => {
    const errors = await validate(buildDto({ ...validBase, displayCurrency: 'USD' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('displayCurrency');
    expect(errors[0].constraints).toHaveProperty('isIn');
  });

  it('should reject a malformed (non-ISO-4217-shaped) displayCurrency', async () => {
    const errors = await validate(buildDto({ ...validBase, displayCurrency: 'pl' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('displayCurrency');
    expect(errors[0].constraints).toHaveProperty('isIn');
  });

  it('should accept rateBasis "current-rate"', async () => {
    const errors = await validate(buildDto({ ...validBase, displayCurrency: 'PLN', rateBasis: 'current-rate' }));

    expect(errors).toHaveLength(0);
  });

  it('should accept rateBasis "order-date"', async () => {
    const errors = await validate(buildDto({ ...validBase, displayCurrency: 'PLN', rateBasis: 'order-date' }));

    expect(errors).toHaveLength(0);
  });

  it('should reject a rateBasis outside DISPLAY_CURRENCY_RATE_BASIS_VALUES', async () => {
    const errors = await validate(buildDto({ ...validBase, displayCurrency: 'PLN', rateBasis: 'live' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('rateBasis');
    expect(errors[0].constraints).toHaveProperty('isIn');
  });
});
