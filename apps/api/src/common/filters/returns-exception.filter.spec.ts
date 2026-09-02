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
  ReturnAuthorizeRefusedError,
  ReturnCustodyContendedError,
  ReturnCustodyTransitionError,
  ReturnDeclineInvalidRequestError,
  ReturnDeclineUnsupportedError,
  ReturnLineNotFoundError,
  ReturnMatchRefusedError,
  ReturnNotAttributedError,
  ReturnNotFoundError,
  ReturnRecordRefusedError,
  ReturnRefundBlockedError,
  ReturnRefundContendedError,
  ReturnRefundObservationInvalidError,
  ReturnRestockAttestationInvalidError,
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

/**
 * The #2376 additions, table-driven.
 *
 * Nine more of this context's refusals become reachable with the write API, and
 * an unmapped one is a 500 for a state the service raised deliberately — the
 * failure this filter exists to prevent. Each row pins the status AND whether a
 * `reason` field is on the wire, because the acceptance criterion is *"409 with
 * an actionable code"* and a client branches on the field, never the message.
 */
describe('ReturnsExceptionFilter — the #2376 write-API refusals', () => {
  const filter = new ReturnsExceptionFilter();

  const cases: ReadonlyArray<[string, Error, number, string | null]> = [
    // 404 — the addressed resource does not exist.
    ['ReturnLineNotFoundError', new ReturnLineNotFoundError('line-1'), 404, null],

    // 409 — it exists and its STATE refuses.
    [
      'ReturnCustodyTransitionError(over-receipt)',
      new ReturnCustodyTransitionError('received', 'received', 'over-receipt'),
      409,
      'over-receipt',
    ],
    [
      'ReturnCustodyTransitionError(over-disposition)',
      new ReturnCustodyTransitionError('received', 'disposed', 'over-disposition'),
      409,
      'over-disposition',
    ],
    [
      // Reads like a validation fault, but the DTO's `@IsInt() @Min(1)` catches
      // every malformed request first — so reaching the domain check means the
      // value was well formed and the state refused.
      'ReturnCustodyTransitionError(non-positive-quantity)',
      new ReturnCustodyTransitionError('advised', 'received', 'non-positive-quantity'),
      409,
      'non-positive-quantity',
    ],
    ['ReturnCustodyContendedError', new ReturnCustodyContendedError('line-1'), 409, null],
    [
      'ReturnRestockAttestationInvalidError',
      new ReturnRestockAttestationInvalidError('line-1'),
      409,
      null,
    ],
    [
      'ReturnAuthorizeRefusedError',
      new ReturnAuthorizeRefusedError('ret-1', 'source-ingested'),
      409,
      'source-ingested',
    ],
    [
      'ReturnMatchRefusedError(already-attributed)',
      new ReturnMatchRefusedError('ret-1', 'already-attributed'),
      409,
      'already-attributed',
    ],
    ['ReturnRefundBlockedError', new ReturnRefundBlockedError('ret-1', 'no-lines'), 409, 'no-lines'],
    ['ReturnRefundContendedError', new ReturnRefundContendedError('ret-1'), 409, null],

    // 400 — the request PAYLOAD was inapplicable.
    [
      // The one reason on this error that is NOT a state conflict: the return is
      // fine and the order id the operator supplied names nothing OL minted.
      'ReturnMatchRefusedError(unknown-order)',
      new ReturnMatchRefusedError('ret-1', 'unknown-order'),
      400,
      'unknown-order',
    ],
    ['ReturnRecordRefusedError', new ReturnRecordRefusedError('no-lines'), 400, 'no-lines'],
    [
      'ReturnRefundObservationInvalidError',
      new ReturnRefundObservationInvalidError('ret-1'),
      400,
      null,
    ],
  ];

  it.each(cases)('should map %s', (_label, exception, expectedStatus, expectedReason) => {
    const { host, captured } = createHost();

    filter.catch(exception as never, host);

    expect(captured.status).toHaveBeenCalledWith(expectedStatus);
    expect(captured.body?.error).toBe(exception.name);
    if (expectedReason === null) {
      expect(captured.body).not.toHaveProperty('reason');
    } else {
      expect(captured.body?.reason).toBe(expectedReason);
    }
  });

  it('should split ReturnMatchRefusedError by reason, not by class', () => {
    // The whole point of the split: answering 409 for both would tell an
    // operator the return was in a bad state when their typo was the problem.
    const conflict = createHost();
    filter.catch(new ReturnMatchRefusedError('r', 'already-attributed') as never, conflict.host);

    const badRequest = createHost();
    filter.catch(new ReturnMatchRefusedError('r', 'unknown-order') as never, badRequest.host);

    expect(conflict.captured.status).toHaveBeenCalledWith(409);
    expect(badRequest.captured.status).toHaveBeenCalledWith(400);
  });

  it('should map every returns exception the write API can raise', () => {
    // A coverage assertion, so the NEXT domain error added to `returns` cannot
    // silently become a 500. Every class the write controller's services declare
    // as thrown must appear above.
    const mapped = new Set(cases.map(([, exception]) => exception.name));

    expect([...mapped].sort()).toEqual(
      [
        'ReturnAuthorizeRefusedError',
        'ReturnCustodyContendedError',
        'ReturnCustodyTransitionError',
        'ReturnLineNotFoundError',
        'ReturnMatchRefusedError',
        'ReturnRecordRefusedError',
        'ReturnRefundBlockedError',
        'ReturnRefundContendedError',
        'ReturnRefundObservationInvalidError',
        'ReturnRestockAttestationInvalidError',
      ].sort()
    );
  });
});
