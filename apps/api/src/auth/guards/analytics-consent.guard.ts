/**
 * Analytics Consent Guard
 *
 * On a demo-mode instance, consent to session recording is a condition of
 * using the demo (#1938) — so it is enforced here, once, for every route,
 * rather than in each controller. Registered as the third APP_GUARD in
 * AuthModule (runs after JwtAuthGuard and RolesGuard, so `req.user` is already
 * resolved).
 *
 * Scoped to the `viewer` role: admin and operator accounts on a demo instance
 * are the operators' own, and gating them would block live support. Same split
 * the read-only demo banner uses (#1468).
 *
 * Two routes carry `@SkipAnalyticsConsent()` — `GET /auth/me` (the frontend
 * reads consent from it) and `PATCH /auth/me/analytics-consent` (it grants
 * consent). `POST /auth/refresh`, `POST /auth/logout`, and `GET /system/config`
 * need no decorator: they are `@Public()`, so no session principal is attached
 * and the `!user` branch below lets them through.
 *
 * The consent flag rides on the JWT payload rather than being read from the
 * database per request — `JwtStrategy` is deliberately stateless. A token
 * minted before the claim existed (or before consent was given) reads as no
 * consent, which fails closed; the frontend's consent page re-mints the token
 * after writing, so the stale state resolves in one round-trip.
 *
 * @module apps/api/src/auth/guards
 */
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SKIP_ANALYTICS_CONSENT_KEY } from '../decorators/skip-analytics-consent.decorator';
import { DEMO_MODE_SERVICE_TOKEN, type IDemoModeService } from '../demo-mode.service.interface';
import type { AuthenticatedUser } from '../auth.types';

/**
 * Machine-readable marker on the 403 body. The frontend keys its consent-page
 * redirect on this rather than on the message text — see
 * `apps/web/src/shared/api/analytics-consent-error.ts`, which carries the same
 * literal.
 */
export const ANALYTICS_CONSENT_REQUIRED_CODE = 'ANALYTICS_CONSENT_REQUIRED';

@Injectable()
export class AnalyticsConsentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DEMO_MODE_SERVICE_TOKEN)
    private readonly demoModeService: IDemoModeService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.demoModeService.isDemoModeEnabled()) {
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ANALYTICS_CONSENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    // No session principal: a @Public() route, or an MCP request authenticated
    // by a personal access token. Neither carries a demo account to gate.
    if (!user) {
      return true;
    }
    if (user.role !== 'viewer') {
      return true;
    }
    if (user.analyticsConsent) {
      return true;
    }

    throw new ForbiddenException({
      code: ANALYTICS_CONSENT_REQUIRED_CODE,
      message: 'Agree to session recording to use the demo.',
    });
  }
}
