/**
 * JWT Authentication Strategy
 *
 * Passport strategy for JWT token validation. Extracts JWT tokens from
 * Authorization header, validates them, and extracts user information
 * from the token payload.
 *
 * @module apps/api/src/auth/strategies
 */
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: unknown): Promise<unknown> {
    // TODO: Implement user validation
    return { id: (payload as { sub: string }).sub };
  }
}

