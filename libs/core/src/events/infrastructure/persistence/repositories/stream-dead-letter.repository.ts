/**
 * Stream Dead Letter Repository
 *
 * TypeORM-backed implementation of `StreamDeadLetterRepositoryPort` (#2301,
 * D48).
 *
 * `upsert` is raw SQL rather than `Repository.upsert()`: TypeORM's helper
 * writes every column present on the partial entity it is given into the
 * `SET` clause on conflict, and `first_seen_at` must be the ONE column that
 * is NEVER touched on a re-write (see the port's own docblock for why a
 * re-write happens at all — an XACK that failed after a successful insert).
 * `INSERT ... ON CONFLICT ... DO UPDATE SET` with `first_seen_at` simply
 * absent from the `SET` list is the one construct that expresses "insert
 * this on first write, leave it alone on every later one" directly, with no
 * read-then-decide branch.
 *
 * @module libs/core/src/events/infrastructure/persistence/repositories
 * @implements {StreamDeadLetterRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository} from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { StreamDeadLetter } from '../../../domain/entities/stream-dead-letter.entity';
import type { StreamDeadLetterRepositoryPort } from '../../../domain/ports/stream-dead-letter-repository.port';
import type {
  CreateStreamDeadLetterInput,
  PaginatedStreamDeadLetters,
  StreamDeadLetterFilters,
  StreamDeadLetterPagination,
} from '../../../domain/types/stream-dead-letter.types';
import { StreamDeadLetterOrmEntity } from '../entities/stream-dead-letter.orm-entity';

interface StreamDeadLetterRow {
  id: string;
  stream: string;
  consumer_group: string;
  entry_id: string;
  raw_fields: Record<string, string>;
  attempts: number;
  last_error: string;
  first_seen_at: Date;
  last_seen_at: Date;
}

@Injectable()
export class StreamDeadLetterRepository implements StreamDeadLetterRepositoryPort {
  constructor(
    @InjectRepository(StreamDeadLetterOrmEntity)
    private readonly repository: Repository<StreamDeadLetterOrmEntity>
  ) {}

  async upsert(input: CreateStreamDeadLetterInput): Promise<StreamDeadLetter> {
    const now = new Date();
    const result = (await this.repository.query(
      `INSERT INTO "stream_dead_letters"
         ("stream", "consumer_group", "entry_id", "raw_fields", "attempts", "last_error", "first_seen_at", "last_seen_at")
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $7)
       ON CONFLICT ("stream", "consumer_group", "entry_id") DO UPDATE SET
         "raw_fields" = EXCLUDED."raw_fields",
         "attempts" = EXCLUDED."attempts",
         "last_error" = EXCLUDED."last_error",
         "last_seen_at" = EXCLUDED."last_seen_at"
       RETURNING *`,
      [
        input.stream,
        input.consumerGroup,
        input.entryId,
        JSON.stringify(input.rawFields),
        input.attempts,
        input.lastError,
        now,
      ]
    )) as StreamDeadLetterRow[];

    return this.toDomain(result[0]);
  }

  async findMany(
    filters: StreamDeadLetterFilters,
    pagination: StreamDeadLetterPagination
  ): Promise<PaginatedStreamDeadLetters> {
    const query = this.buildFilteredQuery(filters);
    const [entities, total] = await query
      .orderBy('entity.lastSeenAt', 'DESC')
      .skip(pagination.offset)
      .take(pagination.limit)
      .getManyAndCount();

    return {
      items: entities.map((entity) => this.toDomainFromEntity(entity)),
      total,
    };
  }

  async count(filters: StreamDeadLetterFilters): Promise<number> {
    return this.buildFilteredQuery(filters).getCount();
  }

  private buildFilteredQuery(
    filters: StreamDeadLetterFilters
  ): SelectQueryBuilder<StreamDeadLetterOrmEntity> {
    const query = this.repository.createQueryBuilder('entity');
    if (filters.stream !== undefined) {
      query.andWhere('entity.stream = :stream', { stream: filters.stream });
    }
    return query;
  }

  private toDomain(row: StreamDeadLetterRow): StreamDeadLetter {
    return new StreamDeadLetter(
      row.id,
      row.stream,
      row.consumer_group,
      row.entry_id,
      row.raw_fields,
      row.attempts,
      row.last_error,
      new Date(row.first_seen_at),
      new Date(row.last_seen_at)
    );
  }

  private toDomainFromEntity(entity: StreamDeadLetterOrmEntity): StreamDeadLetter {
    return new StreamDeadLetter(
      entity.id,
      entity.stream,
      entity.consumerGroup,
      entity.entryId,
      entity.rawFields,
      entity.attempts,
      entity.lastError,
      entity.firstSeenAt,
      entity.lastSeenAt
    );
  }
}
