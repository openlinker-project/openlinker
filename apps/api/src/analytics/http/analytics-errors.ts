/**
 * Analytics errors (#3865)
 *
 * The coded HTTP errors the analytics controllers send for a date range they
 * refuse. Each carries a stable code and the values the frontend's copy needs
 * (ADR-081); `message` stays the English sentence the endpoints always sent.
 *
 * @module apps/api/src/analytics/http
 */
import { HttpStatus, type HttpException } from '@nestjs/common';
import { codedHttpError } from '../../common/errors/coded-http.exception';

/** `to` is not after `from`. */
export function analyticsRangeInvalid(): HttpException {
  return codedHttpError(HttpStatus.BAD_REQUEST, 'ANALYTICS_RANGE_INVALID', 'to must be after from');
}

/** The range spans more days than the read allows. */
export function analyticsRangeTooWide(rangeDays: number, maxDays: number): HttpException {
  const days = Math.ceil(rangeDays);
  return codedHttpError(
    HttpStatus.BAD_REQUEST,
    'ANALYTICS_RANGE_TOO_WIDE',
    `Range too wide: ${days} days exceeds the ${maxDays}-day limit`,
    { days, maxDays }
  );
}

export function remediationRunNotFound(runId: string): HttpException {
  return codedHttpError(
    HttpStatus.NOT_FOUND,
    'REMEDIATION_RUN_NOT_FOUND',
    `Remediation run '${runId}' not found`,
    { runId }
  );
}
