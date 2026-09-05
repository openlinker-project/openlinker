/**
 * Authentication Controller
 *
 * HTTP REST API endpoints for authentication. Provides login, current-user,
 * refresh, logout, and password reset endpoints. Login, refresh, logout,
 * and password-reset endpoints are public; /auth/me and the self-service
 * /auth/me/analytics-consent preference update require a valid JWT bearer
 * token (enforced by global guard).
 *
 * The refresh / logout endpoints are public from the JWT auth standpoint
 * (no bearer required) but gated by CsrfGuard so cookie credentials
 * can't be exploited cross-origin.
 *
 * @module apps/api/src/auth
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Logger } from '@openlinker/shared/logging';
import type { User } from '@openlinker/core/users';
import {
  EmailConfirmationRateLimitedException,
  EmailNotConfirmedException,
  InvalidEmailConfirmationTokenException,
  InvalidPasswordResetTokenException,
  AnalyticsConsentRequiredException,
  RegistrationDisabledException,
  RegistrationRateLimitedException,
  RefreshTokenReuseDetectedException,
  UserAlreadyExistsException,
  WeakPasswordException,
} from '@openlinker/core/users';
import { AUTH_SERVICE_TOKEN, IAuthService } from './auth.service.interface';
import { Public } from './decorators/public.decorator';
import { AnyRole } from './decorators/any-role.decorator';
import { SkipAnalyticsConsent } from './decorators/skip-analytics-consent.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { CsrfGuard } from './guards/csrf.guard';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OkResponseDto } from './dto/ok-response.dto';
import { RegisterDto } from './dto/register.dto';
import { ConfirmEmailDto } from './dto/confirm-email.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { UpdateAnalyticsConsentDto } from './dto/update-analytics-consent.dto';
import { AuthenticatedUser } from './auth.types';
import {
  IPasswordResetService,
  PASSWORD_RESET_SERVICE_TOKEN,
} from './password-reset.service.interface';
import { IRegistrationService } from './registration.service.interface';
import { REGISTRATION_SERVICE_TOKEN } from './registration.service.interface';
import {
  EMAIL_CONFIRMATION_SERVICE_TOKEN,
  IEmailConfirmationService,
} from './email-confirmation.service.interface';
import { IRefreshTokenService } from './refresh-token.service.interface';
import { REFRESH_TOKEN_SERVICE_TOKEN } from './refresh-token.tokens';
import type { RotatedRefreshToken } from './refresh-token.types';
import {
  REFRESH_COOKIE_NAME,
  clearAuthCookies,
  setCsrfCookie,
  setRefreshCookie,
} from './auth.cookies';

function readCookie(req: Request, name: string): string | null {
  const raw: unknown = req.cookies?.[name];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(AUTH_SERVICE_TOKEN)
    private readonly authService: IAuthService,
    @Inject(PASSWORD_RESET_SERVICE_TOKEN)
    private readonly passwordResetService: IPasswordResetService,
    @Inject(REFRESH_TOKEN_SERVICE_TOKEN)
    private readonly refreshTokenService: IRefreshTokenService,
    @Inject(REGISTRATION_SERVICE_TOKEN)
    private readonly registrationService: IRegistrationService,
    @Inject(EMAIL_CONFIRMATION_SERVICE_TOKEN)
    private readonly emailConfirmationService: IEmailConfirmationService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with username and password. Returns access token + sets refresh cookie.',
  })
  @ApiResponse({ status: 200, description: 'Login successful', type: LoginResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error (missing or invalid fields)' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Account is awaiting email confirmation' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    let user: User | null;
    try {
      user = await this.authService.validateUser(dto.username, dto.password);
    } catch (error) {
      if (error instanceof EmailNotConfirmedException) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const accessTokenDto = this.authService.login(user);
    const refresh = await this.refreshTokenService.issue(user.id);
    setRefreshCookie(res, refresh.rawToken);
    setCsrfCookie(res);
    return accessTokenDto;
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Self-service registration. Creates a pending user that requires admin approval.',
  })
  @ApiResponse({ status: 201, description: 'Registration submitted — awaiting admin approval', type: OkResponseDto })
  @ApiResponse({
    status: 400,
    description:
      "Demo mode: the session-recording condition was not accepted (`analyticsConsent` omitted or `false`). Outside demo mode the field is optional and this response does not apply.",
  })
  @ApiResponse({ status: 403, description: 'Registration is disabled for this installation' })
  @ApiResponse({ status: 409, description: 'Username or email already taken' })
  @ApiResponse({ status: 429, description: 'Too many registration attempts from this IP' })
  async register(@Body() dto: RegisterDto, @Req() req: Request): Promise<OkResponseDto> {
    try {
      await this.registrationService.register(
        dto.username,
        dto.email,
        dto.password,
        req.ip,
        dto.analyticsConsent,
      );
    } catch (error) {
      if (error instanceof RegistrationDisabledException) {
        throw new ForbiddenException(error.message);
      }
      if (error instanceof UserAlreadyExistsException) {
        throw new ConflictException(error.message);
      }
      if (error instanceof RegistrationRateLimitedException) {
        throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      if (error instanceof AnalyticsConsentRequiredException) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return { ok: true };
  }

  @Public()
  @Post('confirm-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Consume a single-use email confirmation token and activate the account.',
  })
  @ApiResponse({ status: 200, description: 'Account confirmed and activated', type: OkResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid, expired, or already-used token' })
  async confirmEmail(@Body() dto: ConfirmEmailDto): Promise<OkResponseDto> {
    try {
      await this.emailConfirmationService.confirmEmail(dto.token);
    } catch (error) {
      // EmailConfirmationService.confirmEmail already catches
      // UserNotPendingConfirmationException / UserNotFoundException
      // internally and remaps them to InvalidEmailConfirmationTokenException
      // before they ever reach this controller (see its own catch block),
      // so this only ever needs to handle the one exception type.
      if (error instanceof InvalidEmailConfirmationTokenException) {
        // Never surface `error.message` on this public, unauthenticated
        // endpoint. Log the specific reason server-side and return one
        // generic, non-identifying message.
        this.logger.warn(`Email confirmation failed: ${(error as Error).message}`);
        throw new BadRequestException('This confirmation link is invalid or has expired.');
      }
      throw error;
    }
    return { ok: true };
  }

  @Public()
  @Post('resend-confirmation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Resend the email confirmation link for a pending account. Always returns 200 to prevent user enumeration.',
  })
  @ApiResponse({
    status: 200,
    description: 'Request accepted (regardless of account existence or status)',
    type: OkResponseDto,
  })
  @ApiResponse({ status: 429, description: 'Too many resend requests from this IP' })
  async resendConfirmation(
    @Body() dto: ResendConfirmationDto,
    @Req() req: Request,
  ): Promise<OkResponseDto> {
    try {
      await this.emailConfirmationService.resendConfirmation(dto.email, req.ip);
    } catch (error) {
      if (error instanceof EmailConfirmationRateLimitedException) {
        throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw error;
    }
    return { ok: true };
  }

  @Public()
  @Post('refresh')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh cookie and return a new access token. CSRF-guarded.',
  })
  @ApiResponse({ status: 200, description: 'Refresh successful', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Missing, invalid, or revoked refresh token' })
  @ApiResponse({ status: 403, description: 'CSRF token missing or mismatched' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const raw = readCookie(req, REFRESH_COOKIE_NAME);
    if (!raw) {
      throw new UnauthorizedException('Missing refresh cookie');
    }

    let rotated: RotatedRefreshToken;
    try {
      rotated = await this.refreshTokenService.rotate(raw);
    } catch (error) {
      if (error instanceof RefreshTokenReuseDetectedException) {
        clearAuthCookies(res);
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }

    // Rotation succeeded server-side. If the user was deleted between the
    // previous token issuance and now, `getMe` throws UnauthorizedException —
    // we must revoke the just-issued successor (DB orphan + no browser cookie
    // ever set) and clear cookies so the SPA lands on /login.
    try {
      const user = await this.authService.getMe(rotated.userId);
      setRefreshCookie(res, rotated.rawToken);
      setCsrfCookie(res);
      return this.authService.login(user);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.refreshTokenService.revoke(rotated.rawToken);
        clearAuthCookies(res);
      }
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the refresh cookie. CSRF-guarded. Always returns 204.' })
  @ApiResponse({ status: 204, description: 'Logout successful (idempotent)' })
  @ApiResponse({ status: 403, description: 'CSRF token missing or mismatched' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const raw = readCookie(req, REFRESH_COOKIE_NAME);
    if (raw) {
      await this.refreshTokenService.revoke(raw);
    }
    clearAuthCookies(res);
  }

  // Exempt from the demo consent gate (#1938): the frontend reads this to
  // decide whether to send the account to the consent page at all.
  @AnyRole()
  @SkipAnalyticsConsent()
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiResponse({ status: 200, description: 'Current user', type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserResponseDto> {
    const fullUser = await this.authService.getMe(user.id);
    return UserResponseDto.fromDomain(fullUser);
  }

  // Deliberately carries no @Roles: this is a self-service preference on the
  // caller's OWN account, so every authenticated role — viewer included, which
  // is what a demo signup gets — must be able to change it (#1882).
  // Exempt from the demo consent gate (#1938) — gating the route that grants
  // consent would make the missing consent unresolvable.
  @AnyRole()
  @SkipAnalyticsConsent()
  @Patch('me/analytics-consent')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update the current user's demo analytics consent" })
  @ApiResponse({ status: 200, description: 'Updated current user', type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error (analyticsConsent is not a boolean)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateAnalyticsConsent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAnalyticsConsentDto,
  ): Promise<UserResponseDto> {
    const updated = await this.authService.updateAnalyticsConsent(user.id, dto.analyticsConsent);
    return UserResponseDto.fromDomain(updated);
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
