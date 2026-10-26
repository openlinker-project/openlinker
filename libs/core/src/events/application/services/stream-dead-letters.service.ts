/**
 * Stream Dead Letters Service
 *
 * Application-layer entry point for `stream_dead_letters` (#2301, D48) — a
 * thin pass-through to `StreamDeadLetterRepositoryPort`, following the
 * `SyncJobsService` shape: the seam exists so cross-context callers (the
 * two worker consumers, the API's Diagnostics read) go through a published
 * service interface rather than a repository port.
 *
 * @module libs/core/src/events/application/services
 * @implements {IStreamDeadLettersService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { STREAM_DEAD_LETTER_REPOSITORY_TOKEN } from '../../events.tokens';
import type { StreamDeadLetter } from '../../domain/entities/stream-dead-letter.entity';
import { StreamDeadLetterRepositoryPort } from '../../domain/ports/stream-dead-letter-repository.port';
import type {
  CreateStreamDeadLetterInput,
  PaginatedStreamDeadLetters,
  StreamDeadLetterFilters,
  StreamDeadLetterPagination,
} from '../../domain/types/stream-dead-letter.types';
import type { IStreamDeadLettersService } from './stream-dead-letters.service.interface';

@Injectable()
export class StreamDeadLettersService implements IStreamDeadLettersService {
  constructor(
    @Inject(STREAM_DEAD_LETTER_REPOSITORY_TOKEN)
    private readonly repository: StreamDeadLetterRepositoryPort
  ) {}

  async record(input: CreateStreamDeadLetterInput): Promise<StreamDeadLetter> {
    return this.repository.upsert(input);
  }

  async list(
    filters: StreamDeadLetterFilters,
    pagination: StreamDeadLetterPagination
  ): Promise<PaginatedStreamDeadLetters> {
    return this.repository.findMany(filters, pagination);
  }

  async count(filters: StreamDeadLetterFilters): Promise<number> {
    return this.repository.count(filters);
  }
}
