/**
 * Exchange Rate Repository Tests
 *
 * @module libs/core/src/currency/infrastructure/persistence/repositories/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { DuplicateExchangeRateError } from '../../../../domain/exceptions/exchange-rate.exception';
import type { ExchangeRate } from '../../../../domain/types/exchange-rate.types';
import type { ExchangeRateOrmEntity } from '../../entities/exchange-rate.orm-entity';
import { ExchangeRateRepository } from '../exchange-rate.repository';

const RATE: ExchangeRate = {
  source: 'nbp',
  from: 'EUR',
  to: 'PLN',
  rateDate: '2026-08-13',
  rate: '4.25000000',
  sourceRef: '149/A/NBP/2026',
  pivotCurrency: null,
  derivation: {
    kind: 'direct',
    legs: [{ pair: 'EUR/PLN', ref: '149/A/NBP/2026', effectiveDate: '2026-08-13' }],
  },
};

function ormRow(overrides: Partial<ExchangeRateOrmEntity> = {}): ExchangeRateOrmEntity {
  return {
    id: 'rate-1',
    source: 'nbp',
    fromCurrency: 'EUR',
    toCurrency: 'PLN',
    rateDate: '2026-08-13',
    rate: '4.25000000',
    sourceRef: '149/A/NBP/2026',
    pivotCurrency: null,
    derivation: RATE.derivation,
    fetchedAt: new Date('2026-08-14T06:00:00Z'),
    ...overrides,
  } as ExchangeRateOrmEntity;
}

function uniqueViolation(): QueryFailedError {
  const error = new QueryFailedError('INSERT', [], new Error('duplicate key'));
  (error as QueryFailedError & { code?: string }).code = '23505';
  return error;
}

describe('ExchangeRateRepository', () => {
  let ormRepository: jest.Mocked<Repository<ExchangeRateOrmEntity>>;
  let repository: ExchangeRateRepository;

  beforeEach(() => {
    ormRepository = {
      findOne: jest.fn(),
      create: jest.fn((input: Partial<ExchangeRateOrmEntity>) => input as ExchangeRateOrmEntity),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<ExchangeRateOrmEntity>>;
    repository = new ExchangeRateRepository(ormRepository);
  });

  describe('findByKey', () => {
    it('should query on the full natural key', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow());

      await repository.findByKey({
        source: 'nbp',
        from: 'EUR',
        to: 'PLN',
        rateDate: '2026-08-13',
      });

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: {
          source: 'nbp',
          fromCurrency: 'EUR',
          toCurrency: 'PLN',
          rateDate: '2026-08-13',
        },
      });
    });

    it('should return null when no row is registered', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(
        repository.findByKey({ source: 'nbp', from: 'EUR', to: 'PLN', rateDate: '2026-08-13' })
      ).resolves.toBeNull();
    });

    it('should keep rate as a string rather than coercing it to a number', async () => {
      // Every other money column in the repo IS Number()-ed, which is exactly
      // why this is pinned: routing an audited 8-decimal figure through a
      // binary float loses the guarantee that what we stored is what we report.
      ormRepository.findOne.mockResolvedValue(ormRow({ rate: '4.25000000' }));

      const found = await repository.findByKey({
        source: 'nbp',
        from: 'EUR',
        to: 'PLN',
        rateDate: '2026-08-13',
      });

      expect(found?.rate).toBe('4.25000000');
      expect(typeof found?.rate).toBe('string');
    });

    it('should throw loudly on a row with an unknown source rather than coercing', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow({ source: 'martian-central-bank' }));

      await expect(
        repository.findByKey({ source: 'nbp', from: 'EUR', to: 'PLN', rateDate: '2026-08-13' })
      ).rejects.toThrow('unknown value');
    });
  });

  describe('insertIfAbsent', () => {
    it('should insert an entity that carries no id, so save() can only ever INSERT', async () => {
      ormRepository.save.mockResolvedValue(ormRow());

      await repository.insertIfAbsent(RATE);

      const created = ormRepository.create.mock.calls[0][0] as Partial<ExchangeRateOrmEntity>;
      expect(created.id).toBeUndefined();
      expect(created).toMatchObject({
        source: 'nbp',
        fromCurrency: 'EUR',
        toCurrency: 'PLN',
        rateDate: '2026-08-13',
        rate: '4.25000000',
        sourceRef: '149/A/NBP/2026',
        pivotCurrency: null,
      });
    });

    it('should convert a PG 23505 unique violation to DuplicateExchangeRateError', async () => {
      ormRepository.save.mockRejectedValue(uniqueViolation());

      await expect(repository.insertIfAbsent(RATE)).rejects.toThrow(DuplicateExchangeRateError);
    });

    it('should propagate any other error unchanged', async () => {
      const other = new QueryFailedError('INSERT', [], new Error('connection reset'));
      (other as QueryFailedError & { code?: string }).code = '08006';
      ormRepository.save.mockRejectedValue(other);

      await expect(repository.insertIfAbsent(RATE)).rejects.toBe(other);
    });

    it('should propagate a non-QueryFailedError unchanged', async () => {
      const boom = new Error('boom');
      ormRepository.save.mockRejectedValue(boom);

      await expect(repository.insertIfAbsent(RATE)).rejects.toBe(boom);
    });
  });

  describe('append-only guard', () => {
    // The guard that replaces a rejected database-level trigger. A stamped
    // order points at a registry row AS EVIDENCE, so a rate that could be
    // edited after the fact would make every figure derived from it
    // unverifiable. Adding a mutating call here is not a refactor - it changes
    // what a stamp means.
    const source = readFileSync(join(__dirname, '..', 'exchange-rate.repository.ts'), 'utf8');

    it.each(['update(', 'upsert(', 'delete(', 'remove(', 'softDelete(', 'increment(', 'decrement('])(
      'should reach no ORM %s operation',
      (operation) => {
        expect(source).not.toContain(`ormRepository.${operation}`);
      }
    );

    // The named-method list above is only half the surface: both of these
    // reach every mutation the blocklist bans, under a name the blocklist
    // never sees. `createQueryBuilder().update()` and `manager.delete()` would
    // each sail straight through it.
    it.each(['createQueryBuilder(', 'manager.'])(
      'should reach no ORM %s escape hatch',
      (escapeHatch) => {
        expect(source).not.toContain(`ormRepository.${escapeHatch}`);
      }
    );

    it('should expose exactly the two port methods plus the private mapper', () => {
      const methods = Object.getOwnPropertyNames(ExchangeRateRepository.prototype).filter(
        (name) => name !== 'constructor'
      );

      expect(methods.sort()).toEqual(['findByKey', 'insertIfAbsent', 'toDomain']);
    });
  });
});
