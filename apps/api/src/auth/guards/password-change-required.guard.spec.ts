/**
 * Password Change Required Guard Tests (#3456)
 *
 * The guard is registered globally, so its short-circuits are what keep every
 * ordinary account untouched, and its refusal is the only thing that makes the
 * forced change a server-side guarantee rather than a UI convention.
 *
 * @module apps/api/src/auth/guards
 */
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../auth.types';
import {
  PasswordChangeRequiredGuard,
  PASSWORD_CHANGE_REQUIRED_CODE,
} from './password-change-required.guard';

function makeContext(user?: AuthenticatedUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => (): void => undefined,
    getClass: () => class Anon {},
  } as unknown as ExecutionContext;
}

const FLAGGED_PACKER: AuthenticatedUser = {
  id: 'user-1',
  username: 'anna',
  role: 'packer',
  mustChangePassword: true,
};

describe('PasswordChangeRequiredGuard', () => {
  function makeGuard(allowed = false): PasswordChangeRequiredGuard {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(allowed);
    return new PasswordChangeRequiredGuard(reflector);
  }

  it('should refuse a flagged account with the machine-readable code', () => {
    const guard = makeGuard();

    let caught: unknown;
    try {
      guard.canActivate(makeContext(FLAGGED_PACKER));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toEqual(
      expect.objectContaining({ code: PASSWORD_CHANGE_REQUIRED_CODE })
    );
  });

  // A one-time password is a credential someone else has seen, whatever the role.
  it.each(['admin', 'operator', 'viewer', 'packer'] as const)(
    'should refuse a flagged %s account too',
    (role) => {
      const guard = makeGuard();

      expect(() => guard.canActivate(makeContext({ ...FLAGGED_PACKER, role }))).toThrow(
        ForbiddenException
      );
    }
  );

  it('should allow a route that resolves the state via @AllowPasswordChangeRequired()', () => {
    const guard = makeGuard(true);

    expect(guard.canActivate(makeContext(FLAGGED_PACKER))).toBe(true);
  });

  it('should allow an account that has already changed its password', () => {
    const guard = makeGuard();

    expect(guard.canActivate(makeContext({ ...FLAGGED_PACKER, mustChangePassword: false }))).toBe(
      true
    );
  });

  // A token minted before the claim existed carries none; no such account
  // existed then, so reading it as "no change required" is exact.
  it('should allow a principal whose token carries no claim', () => {
    const guard = makeGuard();
    const legacy: AuthenticatedUser = { id: 'user-1', username: 'anna', role: 'packer' };

    expect(guard.canActivate(makeContext(legacy))).toBe(true);
  });

  it('should allow a request with no session principal', () => {
    const guard = makeGuard();

    // A @Public() route (refresh, logout), or an MCP personal-access-token call.
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });
});
