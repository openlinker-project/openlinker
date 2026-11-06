import { BadRequestException } from '@nestjs/common';
import {
  analyticsRangeInvalid,
  analyticsRangeTooWide,
  remediationRunNotFound,
} from './analytics-errors';

describe('analytics errors (#3865)', () => {
  it('should send ANALYTICS_RANGE_INVALID for a range that ends before it starts', () => {
    const error = analyticsRangeInvalid();

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      code: 'ANALYTICS_RANGE_INVALID',
      message: 'to must be after from',
    });
  });

  it('should send the rounded day count and the limit for a range too wide', () => {
    expect(analyticsRangeTooWide(400.2, 400).getResponse()).toEqual({
      statusCode: 400,
      code: 'ANALYTICS_RANGE_TOO_WIDE',
      message: 'Range too wide: 401 days exceeds the 400-day limit',
      params: { days: 401, maxDays: 400 },
    });
  });

  it('should send REMEDIATION_RUN_NOT_FOUND with the run id', () => {
    expect(remediationRunNotFound('run-1').getResponse()).toMatchObject({
      code: 'REMEDIATION_RUN_NOT_FOUND',
      params: { runId: 'run-1' },
    });
  });
});
