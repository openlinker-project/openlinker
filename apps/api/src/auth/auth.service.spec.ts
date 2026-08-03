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
import { EmailNotConfirmedException, USER_REPOSITORY_TOKEN, User } from '@openlinker/core/users';

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
      findByEmail: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      save: jest.fn(),
      updateAnalyticsConsent: jest.fn(),
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
    it('should return null and use only the username lookup when a "@"-free identifier misses', async () => {
      userRepository.findByUsername.mockResolvedValue(null);

      const result = await service.validateUser('unknown', 'password');

      expect(result).toBeNull();
      expect(userRepository.findByUsername).toHaveBeenCalledWith('unknown');
      expect(userRepository.findByEmail).not.toHaveBeenCalled();
    });

    it('should return null and use only the email lookup when a "@"-bearing identifier misses', async () => {
      userRepository.findByEmail.mockResolvedValue(null);

      const result = await service.validateUser('unknown@example.com', 'password');

      expect(result).toBeNull();
      expect(userRepository.findByEmail).toHaveBeenCalledWith('unknown@example.com');
      expect(userRepository.findByUsername).not.toHaveBeenCalled();
    });

    it('should authenticate by email and skip the username lookup when the identifier contains "@"', async () => {
      const plainPassword = 'secret123';
      const user = makeUser({
        email: 'admin@openlinker.local',
        passwordHash: await bcrypt.hash(plainPassword, 10),
      });
      userRepository.findByEmail.mockResolvedValue(user);

      const result = await service.validateUser('admin@openlinker.local', plainPassword);

      expect(result).toBe(user);
      expect(userRepository.findByEmail).toHaveBeenCalledWith('admin@openlinker.local');
      expect(userRepository.findByUsername).not.toHaveBeenCalled();
    });

    it('should authenticate by username and skip the email lookup when the identifier has no "@"', async () => {
      const plainPassword = 'secret123';
      const user = makeUser({ passwordHash: await bcrypt.hash(plainPassword, 10) });
      userRepository.findByUsername.mockResolvedValue(user);

      const result = await service.validateUser('admin', plainPassword);

      expect(result).toBe(user);
      expect(userRepository.findByUsername).toHaveBeenCalledWith('admin');
      expect(userRepository.findByEmail).not.toHaveBeenCalled();
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

    it('should return null when the account is pending admin approval', async () => {
      const plainPassword = 'secret123';
      const user = makeUser({
        status: 'pending',
        passwordHash: await bcrypt.hash(plainPassword, 10),
      });
      userRepository.findByUsername.mockResolvedValue(user);

      const result = await service.validateUser('admin', plainPassword);

      expect(result).toBeNull();
    });

    it('should throw EmailNotConfirmedException when the account is pending email confirmation (#1624)', async () => {
      const plainPassword = 'secret123';
      const user = makeUser({
        status: 'pending_confirmation',
        passwordHash: await bcrypt.hash(plainPassword, 10),
      });
      userRepository.findByUsername.mockResolvedValue(user);

      await expect(service.validateUser('admin', plainPassword)).rejects.toThrow(
        EmailNotConfirmedException
      );
    });
  });

  describe('login', () => {
    it('should return LoginResponseDto with access_token containing role and consent', () => {
      const user = makeUser();

      const result = service.login(user);

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: user.id,
        username: user.username,
        role: user.role,
        // Claim read by the global AnalyticsConsentGuard (#1938), so it never
        // needs a database round-trip.
        analyticsConsent: user.analyticsConsent,
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

  describe('updateAnalyticsConsent (#1882)', () => {
    const makeConsentUser = (analyticsConsent: boolean): User =>
      new User(
        'user-uuid-123',
        'demo_user',
        'demo@example.com',
        '$2a$10$hash',
        'viewer',
        'active',
        new Date(),
        new Date(),
        analyticsConsent
      );

    it('should persist the new consent and return the re-read user', async () => {
      userRepository.findById
        .mockResolvedValueOnce(makeConsentUser(false))
        .mockResolvedValueOnce(makeConsentUser(true));

      const result = await service.updateAnalyticsConsent('user-uuid-123', true);

      expect(userRepository.updateAnalyticsConsent).toHaveBeenCalledWith('user-uuid-123', true);
      expect(result.analyticsConsent).toBe(true);
    });

    it('should return the persisted value rather than echoing the request', async () => {
      // Repository re-read is authoritative: if it reports false, so do we.
      userRepository.findById
        .mockResolvedValueOnce(makeConsentUser(false))
        .mockResolvedValueOnce(makeConsentUser(false));

      const result = await service.updateAnalyticsConsent('user-uuid-123', true);

      expect(result.analyticsConsent).toBe(false);
    });

    it('should throw UnauthorizedException and not write when the user no longer exists', async () => {
      userRepository.findById.mockResolvedValue(null);

      await expect(service.updateAnalyticsConsent('ghost-id', true)).rejects.toThrow(
        UnauthorizedException
      );
      expect(userRepository.updateAnalyticsConsent).not.toHaveBeenCalled();
    });
  });
});
