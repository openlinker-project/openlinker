/**
 * Authentication Service
 *
 * Handles user authentication and JWT token generation. Validates user
 * credentials and issues JWT access tokens for authenticated users.
 *
 * @module apps/api/src/auth
 */
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  // TODO: Implement authentication logic
  // eslint-disable-next-line @typescript-eslint/require-await
  async validateUser(_username: string, _password: string): Promise<unknown> {
    // Placeholder implementation
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async login(user: unknown): Promise<{ access_token: string }> {
    const payload = { sub: (user as { id: string }).id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}
