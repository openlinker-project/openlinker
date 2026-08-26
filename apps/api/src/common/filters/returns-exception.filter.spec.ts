/**
 * Returns Exception Filter — unit tests
 *
 * The three statuses are the contract two issues' acceptance criteria depend
 * on (#2333, #2336): an orphan return and a source with no decline support must
 * not answer identically.
 *
 * The `trigger` assertions exist because the filter's docblock instructs
 * consumers to read that FIELD rather than parse the message — an instruction
 * only honourable while the field is actually on the wire (#2336).
 */
import type { ArgumentsHost } from '@nestjs/common';
import {
  ReturnDeclineInvalidRequestError,
  ReturnDeclineUnsupportedError,
  ReturnNotAttributedError,
  ReturnNotFoundError,
} from '@openlinker/core/returns';
import { ReturnsExceptionFilter } from './returns-exception.filter';

type ResponseBody = Record<string, unknown>;

interface CapturedResponse {
  status: jest.Mock;
  /** The body the filter wrote, captured rather than dug out of `mock.calls`. */
  body: ResponseBody | null;
}

function createHost(): { host: ArgumentsHost; captured: CapturedResponse } {
  const captured: CapturedResponse = {
    status: jest.fn().mockReturnThis(),
    body: null,
  };

  const response = {
    status: captured.status,
    json: (body: ResponseBody): unknown => {
      captured.body = body;
      return response;
    },
  };
  captured.status.mockReturnValue(response);

  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return { host, captured };
}

describe('ReturnsExceptionFilter', () => {
  const filter = new ReturnsExceptionFilter();

  it('should answer 404 when the return does not exist', () => {
    const { host, captured } = createHost();

    filter.catch(new ReturnNotFoundError('ol_return_1'), host);

    expect(captured.status).toHaveBeenCalledWith(404);
    expect(captured.body).toMatchObject({
      statusCode: 404,
      error: 'ReturnNotFoundError',
    });
  });

  it('should answer 409 and carry the blocked trigger when the return is an orphan', () => {
    const { host, captured } = createHost();

    filter.catch(new ReturnNotAttributedError('ol_return_1', 'decline'), host);

    expect(captured.status).toHaveBeenCalledWith(409);
    expect(captured.body).toMatchObject({
      statusCode: 409,
      error: 'ReturnNotAttributedError',
      trigger: 'decline',
    });
  });

  it('should answer 400 without a trigger key when the source declares no decline', () => {
    const { host, captured } = createHost();

    filter.catch(
      new ReturnDeclineUnsupportedError('ol_return_1', 'conn_1', 'no decline endpoint'),
      host,
    );

    expect(captured.status).toHaveBeenCalledWith(400);
    const body = captured.body ?? {};
    expect(body).toMatchObject({ statusCode: 400, error: 'ReturnDeclineUnsupportedError' });
    // Only the one exception that HAS a trigger reports one — the key is absent
    // rather than null, so a consumer cannot read a blocked trigger that does
    // not exist.
    expect('trigger' in body).toBe(false);
  });

  it('should answer 400 when OL own pre-flight refuses the decline request', () => {
    // Distinct from the by-source refusal: nothing was sent, so this is the
    // operator's field to correct (Wave-1c review, finding 7).
    const { host, captured } = createHost();

    filter.catch(
      new ReturnDeclineInvalidRequestError('ext-return-1', 'reasonCode', 'not a known code'),
      host,
    );

    expect(captured.status).toHaveBeenCalledWith(400);
    const body = captured.body ?? {};
    expect(body).toMatchObject({
      statusCode: 400,
      error: 'ReturnDeclineInvalidRequestError',
    });
    expect('trigger' in body).toBe(false);
  });
});
