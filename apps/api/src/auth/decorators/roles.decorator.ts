/**
 * Roles Decorator
 *
 * Marks a controller method or class as requiring one of the specified roles.
 * Used by RolesGuard to enforce role-based access control.
 *
 * Since #2079 the guard DENIES by default: a route carrying neither @Roles()
 * nor @AnyRole() is refused. Use @AnyRole() for a route deliberately open to
 * every authenticated user.
 *
 * Legitimate at class level, unlike @AnyRole(): a NARROWING default is safe to
 * inherit, a WIDENING one is not.
 *
 * @module apps/api/src/auth/decorators
 */
import type { CustomDecorator } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@openlinker/core/users';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);
