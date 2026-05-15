/**
 * CsrfGuard Unit Tests
 *
 * @module apps/api/src/auth/guards
 */
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../auth.cookies';

function makeContext(req: {
  cookies?: Record<string, string | undefined>;
  headers?: Record<string, string | string[]>;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

  it('passes when cookie value equals header value', () => {
    const ctx = makeContext({
      cookies: { [CSRF_COOKIE_NAME]: 'abc' },
      headers: { [CSRF_HEADER_NAME]: 'abc' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects when the cookie is missing', () => {
    const ctx = makeContext({
      cookies: {},
      headers: { [CSRF_HEADER_NAME]: 'abc' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when the header is missing', () => {
    const ctx = makeContext({
      cookies: { [CSRF_COOKIE_NAME]: 'abc' },
      headers: {},
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when the values disagree', () => {
    const ctx = makeContext({
      cookies: { [CSRF_COOKIE_NAME]: 'abc' },
      headers: { [CSRF_HEADER_NAME]: 'xyz' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('treats header arrays correctly (takes first value)', () => {
    const ctx = makeContext({
      cookies: { [CSRF_COOKIE_NAME]: 'abc' },
      headers: { [CSRF_HEADER_NAME]: ['abc', 'xyz'] },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
