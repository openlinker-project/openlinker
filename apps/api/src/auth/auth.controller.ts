/**
 * Authentication Controller
 *
 * HTTP REST API endpoints for authentication operations. Provides login
 * endpoint for user authentication and JWT token issuance.
 *
 * @module apps/api/src/auth
 */
import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: { username: string; password: string }): Promise<{
    access_token: string;
  }> {
    const user = await this.authService.validateUser(loginDto.username, loginDto.password);
    return this.authService.login(user);
  }
}

