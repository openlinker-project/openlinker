/**
 * AuthController Unit Tests
 *
 * Tests the HTTP layer for authentication endpoints. Mocks AuthService
 * to verify controller wiring, error propagation, and response shaping.
 *
 * @module apps/api/src/auth
 */
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { User, InvalidPasswordResetTokenException } from '@openlinker/core/users';
import { PASSWORD_RESET_SERVICE_TOKEN, IPasswordResetService } from './password-reset.service.interface';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { BadRequestException } from '@nestjs/common';

const makeUser = (): User =>
  new User('user-uuid-123', 'admin', null, '$2a$10$hash', 'admin', new Date(), new Date());

const makeLoginResponse = (): LoginResponseDto => {
  const dto = new LoginResponseDto();
  dto.access_token = 'test-jwt-token';
  return dto;
};

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;
  let passwordResetService: jest.Mocked<IPasswordResetService>;

  beforeEach(async () => {
    const mockAuthService = {
      validateUser: jest.fn(),
      login: jest.fn(),
      getMe: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;
    const mockPasswordResetService: jest.Mocked<IPasswordResetService> = {
      requestReset: jest.fn(),
      resetPassword: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: PASSWORD_RESET_SERVICE_TOKEN, useValue: mockPasswordResetService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
    passwordResetService = module.get(PASSWORD_RESET_SERVICE_TOKEN);
  });

  describe('POST /auth/login', () => {
    const dto: LoginDto = Object.assign(new LoginDto(), {
      username: 'admin',
      password: 'secret',
    });

    it('should return LoginResponseDto when credentials are valid', async () => {
      const user = makeUser();
      const response = makeLoginResponse();
      authService.validateUser.mockResolvedValue(user);
      authService.login.mockReturnValue(response);

      const result = await controller.login(dto);

      expect(authService.validateUser).toHaveBeenCalledWith('admin', 'secret');
      expect(authService.login).toHaveBeenCalledWith(user);
      expect(result.access_token).toBe('test-jwt-token');
    });

    it('should throw UnauthorizedException when credentials are invalid', async () => {
      authService.validateUser.mockResolvedValue(null);

      await expect(controller.login(dto)).rejects.toThrow(UnauthorizedException);
      expect(authService.login).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('should always return 200 and delegate to service', async () => {
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

    it('should return ok on success', async () => {
      passwordResetService.resetPassword.mockResolvedValue();
      await expect(controller.resetPassword(dto)).resolves.toEqual({ ok: true });
    });

    it('should convert InvalidPasswordResetTokenException to 400', async () => {
      passwordResetService.resetPassword.mockRejectedValue(
        new InvalidPasswordResetTokenException(),
      );
      await expect(controller.resetPassword(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /auth/me', () => {
    it('should return UserResponseDto with role and permissions for the authenticated user', async () => {
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
