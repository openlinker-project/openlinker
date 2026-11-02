import { BadRequestException } from '@nestjs/common';
import { assertExportRange, exportFilename, toInclusiveDay } from './export-range';

describe('assertExportRange', () => {
  const from = new Date('2025-01-01T00:00:00.000Z');

  it('should accept exactly 366 days', () => {
    expect(() => assertExportRange(from, new Date(from.getTime() + 366 * 86_400_000))).not.toThrow();
  });

  it('should refuse 367 days with a named code and the actual day count', () => {
    try {
      assertExportRange(from, new Date(from.getTime() + 367 * 86_400_000));
      throw new Error('expected assertExportRange to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as { code: string; message: string };
      expect(body.code).toBe('EXPORT_RANGE_TOO_WIDE');
      expect(body.message).toContain('367 days');
      expect(body.message).toContain('366');
    }
  });
});

describe('exportFilename', () => {
  it('should follow openlinker_{report}_{from}_{toInclusive}_{currency}_{basis}.csv', () => {
    const to = new Date('2026-09-28T00:00:00.000Z');
    expect(toInclusiveDay(to)).toBe('2026-09-27');
    expect(
      exportFilename({
        report: 'sales-by-channel',
        from: new Date('2026-08-29T00:00:00.000Z'),
        to,
        currency: 'PLN',
        basis: 'net',
      })
    ).toBe('openlinker_sales-by-channel_2026-08-29_2026-09-27_PLN_net.csv');
  });
});
