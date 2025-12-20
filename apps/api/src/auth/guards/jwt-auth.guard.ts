/**
 * JWT Authentication Guard
 *
 * Route guard that protects endpoints requiring JWT authentication.
 * Uses the JWT strategy to validate tokens and ensure authenticated access.
 *
 * @module apps/api/src/auth/guards
 */
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

