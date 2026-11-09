/**
 * Auth error codes (#3865)
 *
 * The refusals the frontend picks its copy by: each keeps Nest's class (the
 * refresh flow tells a dead session apart by `UnauthorizedException`) and
 * carries a stable code.
 *
 * @module apps/api/src/auth
 */
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { RefreshTokenService } from '../refresh-token.service';
import { CsrfGuard } from '../guards/csrf.guard';

describe('auth error codes (#3865)', () => {
  it('should answer an unknown refresh token with a coded 401', async () => {
    const repository: jest.Mocked<ConstructorParameters<typeof RefreshTokenService>[0]> = {
      insert: jest.fn(),
      findByHash: jest.fn().mockResolvedValue(null),
      revoke: jest.fn(),
      revokeChain: jest.fn(),
    };
    const service = new RefreshTokenService(repository);

    const error = await service.rotate('raw').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      statusCode: 401,
      code: 'AUTH_REFRESH_TOKEN_INVALID',
      message: 'Invalid refresh token',
    });
  });

  it('should answer a missing CSRF token with a coded 403', () => {
    const context = {
      switchToHttp: (): { getRequest: () => unknown } => ({
        getRequest: (): unknown => ({ cookies: {}, headers: {} }),
      }),
    } as unknown as ExecutionContext;

    let caught: unknown;
    try {
      new CsrfGuard().canActivate(context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toEqual(
      expect.objectContaining({ code: 'CSRF_TOKEN_MISSING', message: 'Missing CSRF token' })
    );
  });
});
