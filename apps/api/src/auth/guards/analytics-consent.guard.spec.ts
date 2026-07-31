/**
 * Analytics Consent Guard Tests
 *
 * The guard is registered globally, so its short-circuits are what keep a
 * non-demo deployment and every non-viewer principal untouched (#1938).
 *
 * @module apps/api/src/auth/guards
 */
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IDemoModeService } from '../demo-mode.service.interface';
import type { AuthenticatedUser } from '../auth.types';
import { AnalyticsConsentGuard, ANALYTICS_CONSENT_REQUIRED_CODE } from './analytics-consent.guard';

function makeContext(user?: AuthenticatedUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => (): void => undefined,
    getClass: () => class Anon {},
  } as unknown as ExecutionContext;
}

const VIEWER_NO_CONSENT: AuthenticatedUser = {
  id: 'user-1',
  username: 'demo_visitor',
  role: 'viewer',
  analyticsConsent: false,
};

describe('AnalyticsConsentGuard', () => {
  let reflector: Reflector;
  let demoMode: IDemoModeService;

  function makeGuard(demoEnabled: boolean, skip = false): AnalyticsConsentGuard {
    reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(skip);
    demoMode = { isDemoModeEnabled: jest.fn().mockReturnValue(demoEnabled) };
    return new AnalyticsConsentGuard(reflector, demoMode);
  }

  it('should allow the request when demo mode is disabled', () => {
    const guard = makeGuard(false);

    expect(guard.canActivate(makeContext(VIEWER_NO_CONSENT))).toBe(true);
  });

  it('should allow the request when the route opts out via @SkipAnalyticsConsent()', () => {
    const guard = makeGuard(true, true);

    expect(guard.canActivate(makeContext(VIEWER_NO_CONSENT))).toBe(true);
  });

  it('should allow the request when there is no session principal', () => {
    const guard = makeGuard(true);

    // A @Public() route, or an MCP request authenticated by a personal access
    // token — neither carries a demo account to gate.
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it.each(['admin', 'operator'] as const)(
    'should allow a %s session even without consent',
    (role) => {
      const guard = makeGuard(true);

      const context = makeContext({ ...VIEWER_NO_CONSENT, role });

      expect(guard.canActivate(context)).toBe(true);
    },
  );

  it('should allow a viewer that has consented', () => {
    const guard = makeGuard(true);

    const context = makeContext({ ...VIEWER_NO_CONSENT, analyticsConsent: true });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should block a viewer without consent and report a machine-readable code', () => {
    const guard = makeGuard(true);

    try {
      guard.canActivate(makeContext(VIEWER_NO_CONSENT));
      fail('expected a ForbiddenException');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({ code: ANALYTICS_CONSENT_REQUIRED_CODE }),
      );
    }
  });

  it('should block a viewer whose token predates the consent claim', () => {
    const guard = makeGuard(true);

    // Fail closed: an absent claim is not consent.
    const context = makeContext({
      id: 'user-2',
      username: 'stale_token',
      role: 'viewer',
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
