import {
  isProvablyUnsentTransportError,
  isRequestNotSentError,
  markRequestNotSent,
} from '../request-not-sent';

function fetchFailed(cause: unknown): TypeError {
  return new TypeError('fetch failed', { cause });
}

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('isProvablyUnsentTransportError', () => {
  it.each(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'])(
    'should be true when fetch failed carries %s as its cause',
    (code) => {
      expect(isProvablyUnsentTransportError(fetchFailed(coded(code)))).toBe(true);
    }
  );

  it('should be true when every member of an AggregateError cause is a refused connection', () => {
    const aggregate = new AggregateError([coded('ECONNREFUSED'), coded('ECONNREFUSED')]);
    expect(isProvablyUnsentTransportError(fetchFailed(aggregate))).toBe(true);
  });

  it('should be false when one member of an AggregateError is not provably unsent', () => {
    const aggregate = new AggregateError([coded('ECONNREFUSED'), coded('ECONNRESET')]);
    expect(isProvablyUnsentTransportError(fetchFailed(aggregate))).toBe(false);
  });

  it('should be false for a bare fetch failed with no cause', () => {
    expect(isProvablyUnsentTransportError(new TypeError('fetch failed'))).toBe(false);
  });

  it.each(['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT'])(
    'should be false when the cause is %s, which can happen after send',
    (code) => {
      expect(isProvablyUnsentTransportError(fetchFailed(coded(code)))).toBe(false);
    }
  );

  it('should be false for an abort and for non-error values', () => {
    expect(
      isProvablyUnsentTransportError(Object.assign(new Error('x'), { name: 'AbortError' }))
    ).toBe(false);
    expect(isProvablyUnsentTransportError('ECONNREFUSED')).toBe(false);
    expect(isProvablyUnsentTransportError(undefined)).toBe(false);
  });

  it('should be false for a message that merely mentions a code', () => {
    expect(isProvablyUnsentTransportError(new Error('connect ECONNREFUSED 127.0.0.1:80'))).toBe(
      false
    );
  });
});

describe('markRequestNotSent / isRequestNotSentError', () => {
  it('should read back the mark on the error itself', () => {
    expect(isRequestNotSentError(markRequestNotSent(new Error('x')))).toBe(true);
  });

  it('should find the mark through a cause chain', () => {
    const inner = markRequestNotSent(new Error('inner'));
    expect(isRequestNotSentError(new Error('outer', { cause: inner }))).toBe(true);
  });

  it('should be false for an unmarked error', () => {
    expect(isRequestNotSentError(new Error('x'))).toBe(false);
    expect(isRequestNotSentError(null)).toBe(false);
  });
});
