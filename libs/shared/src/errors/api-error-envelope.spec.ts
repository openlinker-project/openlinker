import { httpStatusErrorCode } from './api-error-code.types';
import { resolveApiErrorCode, withApiErrorCode } from './api-error-envelope.types';

describe('resolveApiErrorCode', () => {
  it('should keep a code the body already carries', () => {
    expect(
      resolveApiErrorCode({ code: 'version_conflict', error: 'ORDER_ALREADY_ON_HOLD' }, 409)
    ).toBe('version_conflict');
  });

  it('should use a legacy upper-snake-case code sent in error', () => {
    expect(resolveApiErrorCode({ error: 'ORDER_ALREADY_ON_HOLD', message: 'x' }, 409)).toBe(
      'ORDER_ALREADY_ON_HOLD'
    );
  });

  it.each(['ConnectionNotFoundException', 'Not Found', 'Bad Request', 'CONFLICT', ''])(
    'should not read %j in error as a code',
    (error) => {
      expect(resolveApiErrorCode({ error }, 404)).toBe('HTTP_404');
    }
  );

  it('should fall back to the status family when the body has neither', () => {
    expect(resolveApiErrorCode({ message: 'x' }, 503)).toBe('HTTP_503');
  });

  it('should ignore an empty or non-string code', () => {
    expect(resolveApiErrorCode({ code: '' }, 400)).toBe('HTTP_400');
    expect(resolveApiErrorCode({ code: 42 }, 400)).toBe('HTTP_400');
  });
});

describe('withApiErrorCode', () => {
  it('should add the code and keep every other field', () => {
    const body = {
      statusCode: 404,
      error: 'ConnectionNotFoundException',
      message: 'gone',
      reason: 'x',
    };

    expect(withApiErrorCode(body, 404)).toEqual({ ...body, code: 'HTTP_404' });
  });

  it('should not mutate the body it is given', () => {
    const body: Record<string, unknown> = { statusCode: 400, message: 'bad' };

    withApiErrorCode(body, 400);

    expect(body).not.toHaveProperty('code');
  });
});

describe('httpStatusErrorCode', () => {
  it('should prefix the status with HTTP_', () => {
    expect(httpStatusErrorCode(422)).toBe('HTTP_422');
  });
});
