/**
 * User Repository — Unit Tests
 *
 * Verifies email normalization (#1625) and the Postgres unique-violation →
 * domain-exception conversion path in UserRepository.save.
 *
 * @module libs/core/src/users/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';

import { UserAlreadyExistsException } from '../../../domain/exceptions/user-already-exists.exception';
import { UserOrmEntity } from '../entities/user.orm-entity';
import { UserRepository } from './user.repository';

describe('UserRepository', () => {
  let repository: UserRepository;
  let ormRepository: jest.Mocked<Repository<UserOrmEntity>>;

  const now = new Date('2026-07-15T10:00:00Z');

  const buildOrm = (overrides: Partial<UserOrmEntity> = {}): UserOrmEntity => ({
    id: 'user-uuid',
    username: 'alice',
    email: 'alice@example.com',
    passwordHash: 'hash',
    role: 'viewer',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      create: jest.fn((entityLike: Partial<UserOrmEntity>) => entityLike as UserOrmEntity),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<UserOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRepository,
        {
          provide: getRepositoryToken(UserOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<UserRepository>(UserRepository);
    ormRepository = module.get(getRepositoryToken(UserOrmEntity));
  });

  describe('findByEmail', () => {
    it('should normalize a mixed-case email before querying', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      await repository.findByEmail('Alice@Example.com');

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'alice@example.com' },
      });
    });

    it('should trim surrounding whitespace before querying', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await repository.findByEmail('  alice@example.com  ');

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'alice@example.com' },
      });
    });
  });

  describe('save', () => {
    it('should persist the email lowercased and trimmed', async () => {
      ormRepository.save.mockResolvedValue(buildOrm({ email: 'alice@example.com' }));

      await repository.save({
        username: 'alice',
        email: 'Alice@Example.com',
        passwordHash: 'hash',
        role: 'viewer',
        status: 'pending',
      });

      expect(ormRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'alice@example.com' })
      );
    });

    it('should pass through a null email unchanged', async () => {
      ormRepository.save.mockResolvedValue(buildOrm({ email: null }));

      await repository.save({
        username: 'alice',
        email: null,
        passwordHash: 'hash',
        role: 'viewer',
        status: 'pending',
      });

      expect(ormRepository.create).toHaveBeenCalledWith(expect.objectContaining({ email: null }));
    });

    it('should convert a Postgres unique-violation on the normalized email into UserAlreadyExistsException', async () => {
      // Simulates the pre-check-race window: two concurrent registrations for
      // case-variant emails both pass RegistrationService's findByEmail
      // pre-check, and the second save() call hits the DB constraint.
      const error = new QueryFailedError('duplicate key value violates unique constraint', [], '');
      (error as QueryFailedError & { code?: string; detail?: string }).code = '23505';
      (error as QueryFailedError & { code?: string; detail?: string }).detail =
        'Key (email)=(alice@example.com) already exists.';
      ormRepository.save.mockRejectedValue(error);

      await expect(
        repository.save({
          username: 'alice2',
          email: 'ALICE@EXAMPLE.COM',
          passwordHash: 'hash',
          role: 'viewer',
          status: 'pending',
        })
      ).rejects.toThrow(UserAlreadyExistsException);
    });

    it('should re-throw a QueryFailedError that is not a unique-violation', async () => {
      const error = new QueryFailedError('connection terminated', [], '');
      (error as QueryFailedError & { code?: string }).code = '57P01';
      ormRepository.save.mockRejectedValue(error);

      await expect(
        repository.save({
          username: 'alice',
          email: 'alice@example.com',
          passwordHash: 'hash',
          role: 'viewer',
          status: 'pending',
        })
      ).rejects.toBe(error);
    });
  });
});
