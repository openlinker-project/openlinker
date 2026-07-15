/**
 * Email Confirmation Token Repository — Unit Tests
 *
 * Regression guard for #1649: `consumeToken`'s `.returning()` call must pass
 * the entity PROPERTY name (`userId`), not the raw DB column name
 * (`user_id`). TypeORM's QueryBuilder#returning resolves entries against
 * column metadata keyed by property name and silently produces no RETURNING
 * output for a name it can't match — the UPDATE still runs and `used_at`
 * still gets set, but `result.raw` comes back empty, so `consumeToken`
 * always returned `null` even for a valid, unexpired, first-use token. This
 * test only asserts the call shape (a mocked query builder can't reproduce
 * TypeORM's real column-metadata resolution) — the real-Postgres regression
 * coverage lives in
 * `apps/api/test/integration/email-confirmation.int-spec.ts`.
 *
 * @module libs/core/src/users/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { EmailConfirmationTokenOrmEntity } from '../entities/email-confirmation-token.orm-entity';
import { EmailConfirmationTokenRepository } from './email-confirmation-token.repository';

describe('EmailConfirmationTokenRepository', () => {
  let repository: EmailConfirmationTokenRepository;

  const buildUpdateQueryBuilder = (rawRows: Array<{ user_id: string }>) => {
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: rawRows, affected: rawRows.length, generatedMaps: [] }),
    };
    return qb;
  };

  const setup = async (qb: ReturnType<typeof buildUpdateQueryBuilder>): Promise<void> => {
    const mockOrmRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      update: jest.fn(),
    } as unknown as jest.Mocked<Repository<EmailConfirmationTokenOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailConfirmationTokenRepository,
        { provide: getRepositoryToken(EmailConfirmationTokenOrmEntity), useValue: mockOrmRepository },
      ],
    }).compile();

    repository = module.get<EmailConfirmationTokenRepository>(EmailConfirmationTokenRepository);
  };

  describe('consumeToken', () => {
    it('requests RETURNING by the entity property name, not the raw DB column name', async () => {
      const qb = buildUpdateQueryBuilder([{ user_id: 'user-1' }]);
      await setup(qb);

      const userId = await repository.consumeToken('hash', new Date());

      // The regression: passing 'user_id' (raw column) here made TypeORM
      // silently return an empty RETURNING result even though the UPDATE
      // matched a row.
      expect(qb.returning).toHaveBeenCalledWith(['userId']);
      expect(userId).toBe('user-1');
    });

    it('returns null when no row matches (unknown/expired/already-used token)', async () => {
      const qb = buildUpdateQueryBuilder([]);
      await setup(qb);

      const userId = await repository.consumeToken('hash', new Date());

      expect(userId).toBeNull();
    });
  });
});
