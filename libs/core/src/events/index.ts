/**
 * Events Module Exports
 *
 * Central export point for the events module. Exports ports, types, and tokens
 * for use in other modules.
 *
 * @module libs/core/src/events
 */

// Domain exports
export { EventPublisherPort } from './domain/ports/event-publisher.port';
export type { EventEnvelope } from './domain/types/event.types';
export type { InboundWebhookEvent } from './domain/types/inbound-webhook-event.types';

// Stream dead letters (#2301, D48)
export { StreamDeadLetter } from './domain/entities/stream-dead-letter.entity';
export type { StreamDeadLetterRepositoryPort } from './domain/ports/stream-dead-letter-repository.port';
export type {
  CreateStreamDeadLetterInput,
  PaginatedStreamDeadLetters,
  StreamDeadLetterFilters,
  StreamDeadLetterPagination,
} from './domain/types/stream-dead-letter.types';
export type { IStreamDeadLettersService } from './application/services/stream-dead-letters.service.interface';

// Infrastructure exports (for testing/mocking)
export { RedisStreamsEventPublisher } from './infrastructure/adapters/redis-streams-event-publisher';

// Module and tokens
export { EventsModule } from './events.module';
export * from './events.tokens';

