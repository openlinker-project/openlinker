/**
 * CSV export helpers shared by the analytics report exports (#3589, G11-H).
 *
 * `assertExportRange` is applied ONLY when `format=csv`: a CSV is one file
 * built in a single request, so its range is capped at 366 days, while the
 * JSON reads keep their own (looser) caps.
 *
 * @module apps/api/src/analytics/http
 */
import { BadRequestException, StreamableFile } from '@nestjs/common';
import type { Readable } from 'node:stream';

export const MAX_EXPORT_RANGE_DAYS = 366;
export const EXPORT_RANGE_TOO_WIDE_CODE = 'EXPORT_RANGE_TOO_WIDE';

const DAY_MS = 24 * 60 * 60 * 1000;

export function assertExportRange(from: Date, to: Date): void {
  const rangeDays = (to.getTime() - from.getTime()) / DAY_MS;
  if (rangeDays > MAX_EXPORT_RANGE_DAYS) {
    throw new BadRequestException({
      code: EXPORT_RANGE_TOO_WIDE_CODE,
      message:
        `One CSV covers at most ${MAX_EXPORT_RANGE_DAYS} days. ` +
        `This range covers ${Math.ceil(rangeDays)} days. ` +
        'Narrow the range, or export one year at a time.',
    });
  }
}

/** `to` is exclusive, so the last day the file covers is the instant before it. */
export function toInclusiveDay(to: Date): string {
  return new Date(to.getTime() - 1).toISOString().slice(0, 10);
}

export function exportFilename(input: {
  report: string;
  from: Date;
  to: Date;
  currency: string;
  basis: string;
}): string {
  const fromDay = input.from.toISOString().slice(0, 10);
  return `openlinker_${input.report}_${fromDay}_${toInclusiveDay(input.to)}_${input.currency}_${input.basis}.csv`;
}

export function csvDownload(stream: Readable, filename: string): StreamableFile {
  return new StreamableFile(stream, {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${filename}"`,
  });
}
