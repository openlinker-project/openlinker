/**
 * RolesGuard Unit Tests
 *
 * Rewritten for #2079's deny-by-default posture.
 *
 * These tests drive a **real `Reflector`** over small decorated fixture
 * classes, rather than mocking `reflector.getAllAndOverride`. The superseded
 * version mocked that one method to return a single value for ALL metadata
 * keys, which made it structurally incapable of expressing the combination
 * this guard now turns on — "public, and no roles" — and left three of its
 * seven tests asserting the fail-open contract that has been inverted.
 *
 * @module apps/api/src/auth/guards
 */
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@openlinker/core/users';
import { RolesGuard } from './roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { AnyRole } from '../decorators/any-role.decorator';
import { Public } from '../decorators/public.decorator';

class UndecoratedFixture {
  handler(): void {}
}

class AnyRoleFixture {
  @AnyRole()
  handler(): void {}
}

class RolesFixture {
  @Roles('admin')
  handler(): void {}

  @Roles('admin', 'viewer')
  multi(): void {}
}

class ContradictoryFixture {
  @Roles('admin')
  @AnyRole()
  handler(): void {}
}

@Public()
class PublicClassFixture {
  handler(): void {}
}

class PublicHandlerFixture {
  @Public()
  handler(): void {}
}

@Roles('admin')
class NarrowClassFixture {
  /** No own decorator — inherits the class's `@Roles('admin')`. */
  inherits(): void {}

  /** Handler-level widening; the more specific declaration wins as a unit. */
  @AnyRole()
  widened(): void {}
}

function contextFor(
  Controller: new (...args: never[]) => unknown,
  methodName: string,
  user?: { role: UserRole }
): ExecutionContext {
  const handler = (Controller.prototype as unknown as Record<string, unknown>)[methodName];
  return {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard (#2079 deny-by-default)', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(new Reflector());
  });

  describe('no decorator at all', () => {
    it('should deny when the route carries neither @Roles() nor @AnyRole()', () => {
      const context = contextFor(UndecoratedFixture, 'handler', { role: 'admin' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should deny even an admin — the default is about the route, not the caller', () => {
      const context = contextFor(UndecoratedFixture, 'handler', { role: 'admin' });
      expect(() => guard.canActivate(context)).toThrow('Insufficient permissions');
    });
  });

  describe('@Public()', () => {
    // Load-bearing: JwtAuthGuard bypasses auth for these, so there is no
    // req.user for a role test to inspect. Removing the short-circuit 403s
    // login, refresh, every webhook and the MCP transport.
    it('should allow a class-level @Public() route with NO req.user', () => {
      const context = contextFor(PublicClassFixture, 'handler', undefined);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow a handler-level @Public() route with NO req.user', () => {
      const context = contextFor(PublicHandlerFixture, 'handler', undefined);
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('@AnyRole()', () => {
    it('should allow any authenticated role', () => {
      for (const role of ['admin', 'operator', 'viewer'] as const) {
        expect(guard.canActivate(contextFor(AnyRoleFixture, 'handler', { role }))).toBe(true);
      }
    });

    it('should deny when no principal is present', () => {
      const context = contextFor(AnyRoleFixture, 'handler', undefined);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('@Roles()', () => {
    it('should allow when the user role matches', () => {
      expect(guard.canActivate(contextFor(RolesFixture, 'handler', { role: 'admin' }))).toBe(true);
    });

    it('should deny when the user role does not match', () => {
      const context = contextFor(RolesFixture, 'handler', { role: 'viewer' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('should allow when the user holds one of several required roles', () => {
      expect(guard.canActivate(contextFor(RolesFixture, 'multi', { role: 'viewer' }))).toBe(true);
    });

    it('should deny when req.user is undefined', () => {
      const context = contextFor(RolesFixture, 'handler', undefined);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('precedence is resolved by specificity, not by key', () => {
    it('should inherit a class-level @Roles() when the handler declares nothing', () => {
      expect(guard.canActivate(contextFor(NarrowClassFixture, 'inherits', { role: 'admin' }))).toBe(
        true
      );
      expect(() =>
        guard.canActivate(contextFor(NarrowClassFixture, 'inherits', { role: 'viewer' }))
      ).toThrow(ForbiddenException);
    });

    it('should let a handler-level @AnyRole() override a class-level @Roles()', () => {
      // Reading the two keys independently would report this as a
      // contradiction; it is an ordinary override.
      expect(guard.canActivate(contextFor(NarrowClassFixture, 'widened', { role: 'viewer' }))).toBe(
        true
      );
    });

    it('should deny when both decorators sit on the SAME target', () => {
      const context = contextFor(ContradictoryFixture, 'handler', { role: 'admin' });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });
});
