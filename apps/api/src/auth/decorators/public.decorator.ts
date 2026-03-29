/**
 * Public Route Decorator
 *
 * Marks a controller method or class as publicly accessible, bypassing
 * JWT authentication enforced by the global JwtAuthGuard.
 *
 * @module apps/api/src/auth/decorators
 */
import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
