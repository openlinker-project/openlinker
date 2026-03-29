/**
 * JwtAuthGuard Unit Tests
 *
 * Tests the @Public() bypass logic in the global JWT authentication guard.
 *
 * @module apps/api/src/auth/guards
 */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  function createMockContext(): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  it('should bypass authentication when @Public() is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = createMockContext();

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('should delegate to parent AuthGuard when @Public() is not set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const context = createMockContext();

    // The parent AuthGuard('jwt').canActivate() would throw or return
    // an Observable in a real scenario. We just verify it doesn't
    // short-circuit to true.
    const parentCanActivate = jest.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(guard)),
      'canActivate',
    );
    parentCanActivate.mockReturnValue(true);

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(parentCanActivate).toHaveBeenCalledWith(context);
  });

  it('should read metadata from both handler and class', async () => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const context = createMockContext();

    await guard.canActivate(context);

    expect(spy).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  });
});
