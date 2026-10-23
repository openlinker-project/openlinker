/**
 * Stream Dead Letters Service Interface
 *
 * Cross-context application surface for writing and reading
 * `stream_dead_letters` rows (#2301, D48). Worker consumers write through
 * this interface rather than injecting `StreamDeadLetterRepositoryPort`
 * directly (`docs/lessons.md` § "A service in apps/** may not inject a core
 * *RepositoryPort"); the API's Diagnostics read goes through it too.
 *
 * @module libs/core/src/events/application/services
 * @see {@link StreamDeadLettersService} for the implementation
 */
import type {
  CreateStreamDeadLetterInput,
  PaginatedStreamDeadLetters,
  StreamDeadLetter,
  StreamDeadLetterFilters,
  StreamDeadLetterPagination,
} from '../../domain/types/stream-dead-letter.types';

export interface IStreamDeadLettersService {
  /**
   * Write (or re-write) one dead-letter row. See
   * `StreamDeadLetterRepositoryPort.upsert` for the full write-then-ack
   * ordering this exists to support.
   */
  record(input: CreateStreamDeadLetterInput): Promise<StreamDeadLetter>;

  /** Paginated, most-recently-seen-first read for the Diagnostics surface. */
  list(
    filters: StreamDeadLetterFilters,
    pagination: StreamDeadLetterPagination
  ): Promise<PaginatedStreamDeadLetters>;

  /** Total count, same filters — the Diagnostics count badge. */
  count(filters: StreamDeadLetterFilters): Promise<number>;
}
