/**
 * Authentication Controller
 *
 * HTTP REST API endpoints for authentication. Provides login, current-user,
 * and password reset endpoints. Login and password-reset endpoints are public;
 * /auth/me requires a valid JWT bearer token (enforced by global guard).
 *
 * @module apps/api/src/auth
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  InvalidPasswordResetTokenException,
  WeakPasswordException,
} from '@openlinker/core/users';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OkResponseDto } from './dto/ok-response.dto';
import { AuthenticatedUser } from './auth.types';
import {
  IPasswordResetService,
  PASSWORD_RESET_SERVICE_TOKEN,
} from './password-reset.service.interface';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(PASSWORD_RESET_SERVICE_TOKEN)
    private readonly passwordResetService: IPasswordResetService,
  ) {}

  @Public()
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiResponse({ status: 200, description: 'Current user', type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    const fullUser = await this.authService.getMe(user.id);
    return UserResponseDto.fromDomain(fullUser);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset email. Always returns 200 to prevent user enumeration.',
  })
  @ApiResponse({
    status: 200,
    description: 'Request accepted (regardless of account existence)',
    type: OkResponseDto,
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<OkResponseDto> {
    await this.passwordResetService.requestReset(dto.email);
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume a reset token and set a new password' })
  @ApiResponse({ status: 200, description: 'Password updated', type: OkResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid or expired token, or weak password' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<OkResponseDto> {
    try {
      await this.passwordResetService.resetPassword(dto.token, dto.newPassword);
    } catch (error) {
      if (
        error instanceof InvalidPasswordResetTokenException ||
        error instanceof WeakPasswordException
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return { ok: true };
  }
}
