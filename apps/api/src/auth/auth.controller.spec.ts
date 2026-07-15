/**
 * AuthController Unit Tests
 *
 * Tests the HTTP layer for authentication endpoints. Mocks AuthService,
 * the password-reset service, and the refresh-token service to verify
 * controller wiring, cookie set/clear behavior, error propagation, and
 * response shaping.
 *
 * @module apps/api/src/auth
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AUTH_SERVICE_TOKEN } from './auth.service.interface';
import type { IAuthService } from './auth.service.interface';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import {
  EmailNotConfirmedException,
  InvalidEmailConfirmationTokenException,
  InvalidPasswordResetTokenException,
  RefreshTokenReuseDetectedException,
  User,
} from '@openlinker/core/users';
import type { IPasswordResetService } from './password-reset.service.interface';
import { PASSWORD_RESET_SERVICE_TOKEN } from './password-reset.service.interface';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ConfirmEmailDto } from './dto/confirm-email.dto';
import type { IRefreshTokenService } from './refresh-token.service.interface';
import { REFRESH_TOKEN_SERVICE_TOKEN } from './refresh-token.tokens';
import type { IRegistrationService } from './registration.service.interface';
import { REGISTRATION_SERVICE_TOKEN } from './registration.service.interface';
import type { IEmailConfirmationService } from './email-confirmation.service.interface';
import { EMAIL_CONFIRMATION_SERVICE_TOKEN } from './email-confirmation.service.interface';
import { PATH_METADATA } from '@nestjs/common/constants';
import { API_VERSION_LABEL } from '../app-info/app-info.types';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './auth.cookies';

const makeUser = (): User =>
  new User('user-uuid-123', 'admin', null, '$2a$10$hash', 'admin', 'active', new Date(), new Date());

const makeLoginResponse = (): LoginResponseDto => {
  const dto = new LoginResponseDto();
  dto.access_token = 'test-jwt-token';
  return dto;
};

const makeMockResponse = (): jest.Mocked<Pick<Response, 'cookie' | 'clearCookie'>> => ({
  cookie: jest.fn().mockReturnThis() as unknown as jest.Mocked<Response>['cookie'],
  clearCookie: jest.fn().mockReturnThis() as unknown as jest.Mocked<Response>['clearCookie'],
});

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<IAuthService>;
  let passwordResetService: jest.Mocked<IPasswordResetService>;
  let refreshTokenService: jest.Mocked<IRefreshTokenService>;
  let emailConfirmationService: jest.Mocked<IEmailConfirmationService>;

  beforeEach(async () => {
    const mockAuthService: jest.Mocked<IAuthService> = {
      validateUser: jest.fn(),
      login: jest.fn(),
      getMe: jest.fn(),
    };
    const mockPasswordResetService: jest.Mocked<IPasswordResetService> = {
      requestReset: jest.fn(),
      resetPassword: jest.fn(),
    };
    const mockRefreshTokenService: jest.Mocked<IRefreshTokenService> = {
      issue: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn(),
    };
    const mockRegistrationService: jest.Mocked<IRegistrationService> = {
      register: jest.fn(),
    };
    const mockEmailConfirmationService: jest.Mocked<IEmailConfirmationService> = {
      sendConfirmation: jest.fn(),
      confirmEmail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AUTH_SERVICE_TOKEN, useValue: mockAuthService },
        { provide: PASSWORD_RESET_SERVICE_TOKEN, useValue: mockPasswordResetService },
        { provide: REFRESH_TOKEN_SERVICE_TOKEN, useValue: mockRefreshTokenService },
        { provide: REGISTRATION_SERVICE_TOKEN, useValue: mockRegistrationService },
        { provide: EMAIL_CONFIRMATION_SERVICE_TOKEN, useValue: mockEmailConfirmationService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AUTH_SERVICE_TOKEN);
    passwordResetService = module.get(PASSWORD_RESET_SERVICE_TOKEN);
    refreshTokenService = module.get(REFRESH_TOKEN_SERVICE_TOKEN);
    emailConfirmationService = module.get(EMAIL_CONFIRMATION_SERVICE_TOKEN);
  });

  describe('refresh cookie path drift guard (#1327)', () => {
    it('scopes the refresh cookie to the versioned mount point of AuthController', () => {
      // RFC 6265 §5.1.4: the browser only sends ol_refresh when its Path
      // prefixes the request path on / boundaries. Under URI versioning the
      // controller is mounted at /{API_VERSION_LABEL}/{controller path}, so
      // the cookie path must be derived from the same two sources — a future
      // controller-prefix change fails here; a version bump self-heals.
      const controllerPath = Reflect.getMetadata(PATH_METADATA, AuthController) as string;
      expect(controllerPath).toBe('auth'); // guard against a silent undefined metadata read
      expect(REFRESH_COOKIE_PATH).toBe(`/${API_VERSION_LABEL}/${controllerPath}`);
    });
  });

  describe('POST /auth/login', () => {
    const dto: LoginDto = Object.assign(new LoginDto(), {
      username: 'admin',
      password: 'secret',
    });

    it('returns LoginResponseDto and sets refresh + csrf cookies on valid credentials', async () => {
      const user = makeUser();
      const response = makeLoginResponse();
      authService.validateUser.mockResolvedValue(user);
      authService.login.mockReturnValue(response);
      refreshTokenService.issue.mockResolvedValue({
        rawToken: 'raw-refresh-token',
        expiresAt: new Date(),
      });
      const res = makeMockResponse();

      const result = await controller.login(dto, res as unknown as Response);

      expect(authService.validateUser).toHaveBeenCalledWith('admin', 'secret');
      expect(authService.login).toHaveBeenCalledWith(user);
      expect(refreshTokenService.issue).toHaveBeenCalledWith(user.id);
      expect(result.access_token).toBe('test-jwt-token');
      // Both cookies (refresh + csrf) are set.
      expect(res.cookie).toHaveBeenCalledTimes(2);
      const cookieNames = res.cookie.mock.calls.map((call) => call[0]);
      expect(cookieNames).toContain(REFRESH_COOKIE_NAME);
      expect(cookieNames).toContain('ol_csrf');
      // Refresh cookie must be issued at the versioned path or the browser
      // never sends it back to /v1/auth/refresh (#1327).
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'raw-refresh-token',
        expect.objectContaining({ path: REFRESH_COOKIE_PATH }),
      );
      // Migration cleanups proactively clear the stale /auth-scoped copies —
      // ol_csrf from the pre-#748 window, ol_refresh from the pre-#1327
      // window — so users from the buggy windows recover on their next
      // login without needing to clear cookies manually.
      expect(res.clearCookie).toHaveBeenCalledWith('ol_csrf', { path: '/auth' });
      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, { path: '/auth' });
    });

    it('throws UnauthorizedException when credentials are invalid and skips cookie set', async () => {
      authService.validateUser.mockResolvedValue(null);
      const res = makeMockResponse();

      await expect(controller.login(dto, res as unknown as Response)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.login).not.toHaveBeenCalled();
      expect(refreshTokenService.issue).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('converts EmailNotConfirmedException to a 403 with a clear message (#1624)', async () => {
      authService.validateUser.mockRejectedValue(new EmailNotConfirmedException());
      const res = makeMockResponse();

      await expect(controller.login(dto, res as unknown as Response)).rejects.toThrow(
        ForbiddenException,
      );
      expect(authService.login).not.toHaveBeenCalled();
      expect(refreshTokenService.issue).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/refresh', () => {
    const makeReq = (refresh?: string): Pick<Request, 'cookies'> => ({
      cookies: refresh ? { [REFRESH_COOKIE_NAME]: refresh } : {},
    });

    it('rotates and returns new access token + new cookies on success', async () => {
      const res = makeMockResponse();
      refreshTokenService.rotate.mockResolvedValue({
        userId: 'user-uuid-123',
        rawToken: 'rotated-token',
        expiresAt: new Date(),
      });
      authService.getMe.mockResolvedValue(makeUser());
      authService.login.mockReturnValue(makeLoginResponse());

      const result = await controller.refresh(
        makeReq('presented-token') as unknown as Request & {
          cookies?: Record<string, string | undefined>;
        },
        res as unknown as Response,
      );

      expect(refreshTokenService.rotate).toHaveBeenCalledWith('presented-token');
      expect(result.access_token).toBe('test-jwt-token');
      expect(res.cookie).toHaveBeenCalledTimes(2);
      // Migration cleanups also fire on every successful refresh (#748/#1327).
      expect(res.clearCookie).toHaveBeenCalledWith('ol_csrf', { path: '/auth' });
      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, { path: '/auth' });
    });

    it('throws 401 when the cookie is missing', async () => {
      const res = makeMockResponse();
      await expect(
        controller.refresh(
          makeReq() as unknown as Request & { cookies?: Record<string, string | undefined> },
          res as unknown as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenService.rotate).not.toHaveBeenCalled();
    });

    it('clears cookies and rethrows as 401 when reuse is detected', async () => {
      const res = makeMockResponse();
      refreshTokenService.rotate.mockRejectedValue(new RefreshTokenReuseDetectedException());

      await expect(
        controller.refresh(
          makeReq('stolen-token') as unknown as Request & {
            cookies?: Record<string, string | undefined>;
          },
          res as unknown as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);
      // 4 = ol_refresh @ /v1/auth, ol_csrf @ /, plus the /auth migration
      // cleanups for ol_csrf (#748) and ol_refresh (#1327). The wrong-path
      // failure mode matters: a clear that misses the set path leaves a live
      // HttpOnly refresh token in the jar, so assert WHICH cookie is deleted.
      expect(res.clearCookie).toHaveBeenCalledTimes(4);
      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
        path: REFRESH_COOKIE_PATH,
      });
      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, { path: '/auth' });
    });

    it('revokes the orphan + clears cookies when getMe fails after a successful rotation', async () => {
      const res = makeMockResponse();
      refreshTokenService.rotate.mockResolvedValue({
        userId: 'user-uuid-123',
        rawToken: 'orphan-successor',
        expiresAt: new Date(),
      });
      authService.getMe.mockRejectedValue(new UnauthorizedException('User no longer exists'));

      await expect(
        controller.refresh(
          makeReq('presented-token') as unknown as Request & {
            cookies?: Record<string, string | undefined>;
          },
          res as unknown as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenService.revoke).toHaveBeenCalledWith('orphan-successor');
      expect(res.clearCookie).toHaveBeenCalledTimes(4);
      // Cookies must NOT be set when the user is gone — the browser would
      // otherwise store a refresh cookie pointing at a useless DB row.
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the presented token and clears both cookies', async () => {
      const res = makeMockResponse();
      const req = {
        cookies: { [REFRESH_COOKIE_NAME]: 'token-to-revoke' },
      } as unknown as Request & { cookies?: Record<string, string | undefined> };

      await controller.logout(req, res as unknown as Response);

      expect(refreshTokenService.revoke).toHaveBeenCalledWith('token-to-revoke');
      expect(res.clearCookie).toHaveBeenCalledTimes(4);
      // Logout must delete the cookie that was actually set (versioned path)
      // AND the pre-#1327 legacy copy — a clear at the wrong path leaves a
      // live HttpOnly refresh token behind after logout.
      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
        path: REFRESH_COOKIE_PATH,
      });
      expect(res.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, { path: '/auth' });
    });

    it('does not invoke revoke when no cookie is present, still clears cookies', async () => {
      const res = makeMockResponse();
      const req = { cookies: {} } as unknown as Request & {
        cookies?: Record<string, string | undefined>;
      };

      await controller.logout(req, res as unknown as Response);

      expect(refreshTokenService.revoke).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledTimes(4);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('always returns 200 and delegates to service', async () => {
      passwordResetService.requestReset.mockResolvedValue();
      const dto: ForgotPasswordDto = Object.assign(new ForgotPasswordDto(), {
        email: 'a@b.com',
      });
      const result = await controller.forgotPassword(dto);
      expect(result).toEqual({ ok: true });
      expect(passwordResetService.requestReset).toHaveBeenCalledWith('a@b.com');
    });
  });

  describe('POST /auth/reset-password', () => {
    const dto: ResetPasswordDto = Object.assign(new ResetPasswordDto(), {
      token: 'raw',
      newPassword: 'longenough',
    });

    it('returns ok on success', async () => {
      passwordResetService.resetPassword.mockResolvedValue();
      await expect(controller.resetPassword(dto)).resolves.toEqual({ ok: true });
    });

    it('converts InvalidPasswordResetTokenException to 400', async () => {
      passwordResetService.resetPassword.mockRejectedValue(
        new InvalidPasswordResetTokenException(),
      );
      await expect(controller.resetPassword(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /auth/confirm-email', () => {
    const dto: ConfirmEmailDto = Object.assign(new ConfirmEmailDto(), { token: 'raw-token' });

    it('returns ok on success and delegates to the service', async () => {
      emailConfirmationService.confirmEmail.mockResolvedValue();

      await expect(controller.confirmEmail(dto)).resolves.toEqual({ ok: true });
      expect(emailConfirmationService.confirmEmail).toHaveBeenCalledWith('raw-token');
    });

    it('converts InvalidEmailConfirmationTokenException to 400', async () => {
      emailConfirmationService.confirmEmail.mockRejectedValue(
        new InvalidEmailConfirmationTokenException(),
      );
      await expect(controller.confirmEmail(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /auth/me', () => {
    it('returns UserResponseDto with role and permissions for the authenticated user', async () => {
      const user = makeUser();
      authService.getMe.mockResolvedValue(user);

      const authenticatedUser = { id: user.id, username: user.username, role: 'admin' as const };
      const result = await controller.getMe(authenticatedUser);

      expect(authService.getMe).toHaveBeenCalledWith(user.id);
      expect(result.id).toBe(user.id);
      expect(result.username).toBe(user.username);
      expect(result.role).toBe('admin');
      expect(result.permissions).toBeDefined();
      expect(result.permissions.length).toBeGreaterThan(0);
    });
  });
});
