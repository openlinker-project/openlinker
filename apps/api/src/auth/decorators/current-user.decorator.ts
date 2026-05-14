/**
 * Current User Param Decorator
 *
 * Extracts the authenticated user from the request object. Use instead of
 * `@Req() req` for cleaner controller signatures.
 *
 * @example
 *   @Get('me')
 *   getMe(@CurrentUser() user: AuthenticatedUser): Promise<...>
 *
 * @module apps/api/src/auth/decorators
 */
import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  }
);
