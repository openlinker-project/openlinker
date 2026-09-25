/**
 * Allow Password Change Required Decorator
 *
 * Marks a controller method as reachable by an account that still has to
 * replace its admin-issued one-time password (#3456), exempting it from the
 * global `PasswordChangeRequiredGuard`. Reserved for the routes that RESOLVE
 * that state: reading the session (the frontend learns the flag there) and
 * changing the password. Without these exemptions the guard would block the
 * very calls that clear it.
 *
 * `@Public()` routes (refresh, logout) need no decorator: they carry no
 * session principal, and the guard lets a principal-less request through.
 *
 * Mirrors `@SkipAnalyticsConsent()` (`SetMetadata` + `Reflector` lookup).
 *
 * @module apps/api/src/auth/decorators
 */
import type { CustomDecorator } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_REQUIRED_KEY = 'allowPasswordChangeRequired';
export const AllowPasswordChangeRequired = (): CustomDecorator<string> =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, true);
