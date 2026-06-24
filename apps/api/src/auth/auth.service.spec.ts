/**
 * AuthService Unit Tests
 *
 * Tests credential validation and JWT issuance logic in isolation.
 * Mocks UserRepositoryPort and JwtService — no database or HTTP needed.
 *
 * @module apps/api/src/auth
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import type { UserRepositoryPort } from '@openlinker/core/users';
import { USER_REPOSITORY_TOKEN, User } from '@openlinker/core/users';

const makeUser = (overrides: Partial<User> = {}): User =>
  new User(
    overrides.id ?? 'user-uuid-123',
    overrides.username ?? 'admin',
    overrides.email ?? null,
    overrides.passwordHash ?? '$2a$10$hashedpassword',
    overrides.role ?? 'admin',
    overrides.status ?? 'active',
    overrides.createdAt ?? new Date(),
    overrides.updatedAt ?? new Date()
  );

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: jest.Mocked<UserRepositoryPort>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const mockUserRepository = {
      findByUsername: jest.fn(),
      findById: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<UserRepositoryPort>;

    const mockJwtService = {
      sign: jest.fn().mockReturnValue('signed-jwt-token'),
    } as unknown as jest.Mocked<JwtService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: USER_REPOSITORY_TOKEN, useValue: mockUserRepository },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(USER_REPOSITORY_TOKEN);
    jwtService = module.get(JwtService);
  });

  describe('validateUser', () => {
    it('should return null when user is not found', async () => {
      userRepository.findByUsername.mockResolvedValue(null);

      const result = await service.validateUser('unknown', 'password');

      expect(result).toBeNull();
      expect(userRepository.findByUsername).toHaveBeenCalledWith('unknown');
    });

    it('should return null when password does not match', async () => {
      const user = makeUser({ passwordHash: await bcrypt.hash('correct', 10) });
      userRepository.findByUsername.mockResolvedValue(user);

      const result = await service.validateUser('admin', 'wrong-password');

      expect(result).toBeNull();
    });

    it('should return User when credentials are valid', async () => {
      const plainPassword = 'secret123';
      const user = makeUser({ passwordHash: await bcrypt.hash(plainPassword, 10) });
      userRepository.findByUsername.mockResolvedValue(user);

      const result = await service.validateUser('admin', plainPassword);

      expect(result).toBe(user);
    });
  });

  describe('login', () => {
    it('should return LoginResponseDto with access_token containing role', () => {
      const user = makeUser();

      const result = service.login(user);

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: user.id,
        username: user.username,
        role: user.role,
      });
      expect(result.access_token).toBe('signed-jwt-token');
    });
  });

  describe('getMe', () => {
    it('should return User when found by ID', async () => {
      const user = makeUser();
      userRepository.findById.mockResolvedValue(user);

      const result = await service.getMe(user.id);

      expect(result).toBe(user);
      expect(userRepository.findById).toHaveBeenCalledWith(user.id);
    });

    it('should throw UnauthorizedException when user no longer exists', async () => {
      userRepository.findById.mockResolvedValue(null);

      await expect(service.getMe('ghost-id')).rejects.toThrow(UnauthorizedException);
    });
  });
});
