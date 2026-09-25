/**
 * Password Change Required Guard (#3456)
 *
 * An account an admin created with a one-time password (`POST /users`) must
 * replace it before it can do anything else. This guard enforces that, once,
 * for every route — server-side, so no client can skip the step by not
 * rendering it. Registered as the fourth `APP_GUARD` in AuthModule, after
 * `JwtAuthGuard`, `RolesGuard` and `AnalyticsConsentGuard`, so `req.user` is
 * already resolved.
 *
 * Two routes carry `@AllowPasswordChangeRequired()`: `GET /auth/me` (the
 * frontend reads the flag from it) and `POST /auth/me/password` (it clears the
 * flag). `@Public()` routes — refresh, logout — carry no session principal and
 * pass through the `!user` branch.
 *
 * The flag rides on the JWT, the `AnalyticsConsentGuard` shape: `JwtStrategy`
 * is stateless, so there is no per-request database read. After the change the
 * client calls `/auth/refresh`, which re-reads the user and mints a token
 * without the claim.
 *
 * Unlike the consent gate this applies to EVERY role and on every deployment:
 * a one-time password is a credential someone else has seen, whatever the
 * account's role.
 *
 * @module apps/api/src/auth/guards
 */
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY } from '../decorators/allow-password-change-required.decorator';
import type { AuthenticatedUser } from '../auth.types';

/**
 * Machine-readable marker on the 403 body, for the frontend's redirect to the
 * change-password screen (#3457). Keyed on this rather than on the message so
 * copy edits cannot break it. The browser and the API share no package, so a
 * frontend copy of this literal must be kept in step by hand.
 */
export const PASSWORD_CHANGE_REQUIRED_CODE = 'PASSWORD_CHANGE_REQUIRED';

@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    // No session principal: a @Public() route, or an MCP request authenticated
    // by a personal access token (its own verifier, never `req.user`).
    if (!user) {
      return true;
    }
    if (!user.mustChangePassword) {
      return true;
    }

    throw new ForbiddenException({
      code: PASSWORD_CHANGE_REQUIRED_CODE,
      message: 'Set a new password before continuing.',
    });
  }
}
