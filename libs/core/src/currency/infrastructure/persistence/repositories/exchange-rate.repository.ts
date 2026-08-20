/**
 * Exchange Rate Repository
 *
 * TypeORM-backed implementation of the APPEND-ONLY `ExchangeRateRepositoryPort`.
 * Exactly two public methods, neither of which mutates - `insertIfAbsent`'s
 * `save()` carries no `id`, so TypeORM can only ever INSERT through it.
 *
 * `insertIfAbsent` is insert-then-recover rather than `ON CONFLICT DO NOTHING`:
 * the plain `save()` is attempted, PostgreSQL `23505` is caught and converted
 * to the domain `DuplicateExchangeRateError`, and the caller re-selects the
 * winner. That is the house get-or-create shape
 * (`IdentifierMappingRepository.insertMapping`) and it keeps the
 * infrastructure-error to domain-error conversion the standards require.
 *
 * @module libs/core/src/currency/infrastructure/persistence/repositories
 * @implements {ExchangeRateRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { DuplicateExchangeRateError } from '../../../domain/exceptions/exchange-rate.exception';
import type { ExchangeRateRepositoryPort } from '../../../domain/ports/exchange-rate-repository.port';
import {
  isExchangeRateSource,
  type ExchangeRate,
  type ExchangeRateKey,
  type StoredExchangeRate,
} from '../../../domain/types/exchange-rate.types';
import { ExchangeRateOrmEntity } from '../entities/exchange-rate.orm-entity';

/** PostgreSQL `unique_violation`. Matched on the code, never on the message. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ExchangeRateRepository implements ExchangeRateRepositoryPort {
  constructor(
    @InjectRepository(ExchangeRateOrmEntity)
    private readonly ormRepository: Repository<ExchangeRateOrmEntity>
  ) {}

  async findByKey(key: ExchangeRateKey): Promise<StoredExchangeRate | null> {
    const row = await this.ormRepository.findOne({
      where: {
        source: key.source,
        fromCurrency: key.from,
        toCurrency: key.to,
        rateDate: key.rateDate,
      },
    });
    return row ? this.toDomain(row) : null;
  }

  async insertIfAbsent(rate: ExchangeRate): Promise<StoredExchangeRate> {
    // No `id` is set, so this can only ever INSERT - `save()` on an entity
    // carrying a primary key would UPDATE, which this table must never do.
    const entity = this.ormRepository.create({
      source: rate.source,
      fromCurrency: rate.from,
      toCurrency: rate.to,
      rateDate: rate.rateDate,
      rate: rate.rate,
      sourceRef: rate.sourceRef,
      pivotCurrency: rate.pivotCurrency,
      derivation: rate.derivation,
      fetchedAt: new Date(),
    });

    try {
      const saved = await this.ormRepository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw new DuplicateExchangeRateError(rate.source, rate.from, rate.to, rate.rateDate);
      }
      throw error;
    }
  }

  private toDomain(entity: ExchangeRateOrmEntity): StoredExchangeRate {
    if (!isExchangeRateSource(entity.source)) {
      // Defensive: the migration carries a CHECK constraint and every write
      // path is typed, so a row with an unknown source should not exist. If a
      // manual DB edit or a value drift from a future code change leaves one,
      // surface it loudly rather than coerce silently.
      throw new Error(`exchange_rates.source has an unknown value '${entity.source}'`);
    }

    return {
      id: entity.id,
      source: entity.source,
      from: entity.fromCurrency,
      to: entity.toCurrency,
      rateDate: entity.rateDate,
      // NOT `Number()`-ed, unlike every other money column in the repo - see
      // the ORM entity header for why.
      rate: entity.rate,
      sourceRef: entity.sourceRef,
      pivotCurrency: entity.pivotCurrency,
      derivation: entity.derivation,
      fetchedAt: entity.fetchedAt,
    };
  }
}
