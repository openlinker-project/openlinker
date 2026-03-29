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
import { User } from '@openlinker/core/users';

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

  beforeEach(async () => {
    const mockAuthService = {
      validateUser: jest.fn(),
      login: jest.fn(),
      getMe: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
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
