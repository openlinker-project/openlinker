/**
 * Roles Decorator
 *
 * Marks a controller method or class as requiring one of the specified roles.
 * Used by RolesGuard to enforce role-based access control. If no @Roles()
 * decorator is present, any authenticated user is allowed.
 *
 * @module apps/api/src/auth/decorators
 */
import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { UserRole } from '@openlinker/core/users';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): CustomDecorator<string> => SetMetadata(ROLES_KEY, roles);
