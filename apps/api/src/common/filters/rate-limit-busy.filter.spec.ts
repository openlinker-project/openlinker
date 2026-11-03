/**
 * Rate Limit Busy Filter - unit spec
 *
 * @module apps/api/src/common/filters
 */
import type { ArgumentsHost } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { RateLimitAbortedError, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';
import { RATE_LIMIT_BUSY_RETRY_AFTER_SECONDS, RateLimitBusyFilter } from './rate-limit-busy.filter';

function createHost(headersSent = false): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const setHeader = jest.fn();
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status, setHeader, headersSent }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json, setHeader };
}

describe('RateLimitBusyFilter', () => {
  const filter = new RateLimitBusyFilter();

  it.each([
    ['RateLimitTimeoutError', new RateLimitTimeoutError(60_000)],
    ['RateLimitAbortedError', new RateLimitAbortedError()],
  ])('should answer 503 with Retry-After when the request budget is busy (%s)', (name, error) => {
    const { host, status, json, setHeader } = createHost();

    filter.catch(error, host);

    expect(setHeader).toHaveBeenCalledWith(
      'Retry-After',
      String(RATE_LIMIT_BUSY_RETRY_AFTER_SECONDS)
    );
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: name,
      message: expect.stringContaining('was not sent'),
    });
  });

  it('should not expose the limiter internals in the message', () => {
    // The raw message names milliseconds and "rate-limit slot" - true, but not
    // something an operator can act on. The plain message says what happened.
    const { host, json } = createHost();

    filter.catch(new RateLimitTimeoutError(60_000), host);

    const [[body]] = json.mock.calls as [[{ message: string }]];
    expect(body.message).not.toContain('60000');
    expect(body.message).toContain('Try again');
  });

  it('should leave a response that is already sent alone', () => {
    const { host, status, setHeader } = createHost(true);

    filter.catch(new RateLimitAbortedError(), host);

    expect(status).not.toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
  });
});
