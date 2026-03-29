/**
 * JWT Authentication Strategy
 *
 * Passport strategy for JWT token validation. Extracts JWT tokens from the
 * Authorization header, validates the signature, and returns the typed user
 * payload — which NestJS attaches to req.user for downstream use.
 *
 * The payload is trusted after signature verification (stateless JWT pattern).
 * No database lookup is performed on each request.
 *
 * @module apps/api/src/auth/strategies
 */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, AuthenticatedUser } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const jwtSecret = configService.getOrThrow<string>('JWT_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    return { id: payload.sub, username: payload.username, role: payload.role };
  }
}
