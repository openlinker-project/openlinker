/**
 * Authentication Controller
 *
 * HTTP REST API endpoints for authentication. Provides login (POST /auth/login)
 * and current-user (GET /auth/me) endpoints. The login endpoint is public;
 * /auth/me requires a valid JWT bearer token.
 *
 * @module apps/api/src/auth
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { AuthenticatedUser } from './strategies/jwt.strategy';

interface RequestWithUser extends ExpressRequest {
  user: AuthenticatedUser;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with username and password, returns JWT' })
  @ApiResponse({ status: 200, description: 'Login successful', type: LoginResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error (missing or invalid fields)' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.authService.validateUser(dto.username, dto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiResponse({ status: 200, description: 'Current user', type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@Req() req: RequestWithUser): Promise<UserResponseDto> {
    const user = await this.authService.getMe(req.user.id);
    return UserResponseDto.fromDomain(user);
  }
}
