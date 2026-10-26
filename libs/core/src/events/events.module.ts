/**
 * Events Module
 *
 * NestJS module for event bus functionality. Configures event publisher
 * and dependency injection. Exports the EventPublisherPort for use in
 * other modules (API, Worker).
 *
 * Also owns `stream_dead_letters` (#2301, D48) — the durable record a Redis
 * Streams consumer writes once an entry has failed recovery past
 * `MAX_RECOVERY_ATTEMPTS`. `events` is the owning context rather than
 * `sync`: the table is generic to ANY stream this module's own
 * `RedisStreamsEventPublisher` (or, on the consuming side, the shared
 * `@openlinker/shared/redis` primitives) might produce, not sync-job-shaped
 * — `job-intake`'s dead letters carry a raw job request and
 * `master-deletion-to-job`'s carry a raw domain event, two unrelated
 * payload shapes with nothing in common except that both arrived over a
 * Redis stream. Placing the table here completes the publish/consume pair
 * this context already half-owns, rather than making `sync` model a
 * concern (generic stream consumption) that is not about sync jobs at all.
 *
 * `TypeOrmModule.forFeature([...])` is mandatory rather than decorative,
 * matching every other context: runtime entity discovery is
 * `autoLoadEntities: true`, so without it the table never materialises in
 * the `synchronize`-built dev/test schema.
 *
 * @module libs/core/src/events
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StreamDeadLettersService } from './application/services/stream-dead-letters.service';
import { RedisStreamsEventPublisher } from './infrastructure/adapters/redis-streams-event-publisher';
import { StreamDeadLetterOrmEntity } from './infrastructure/persistence/entities/stream-dead-letter.orm-entity';
import { StreamDeadLetterRepository } from './infrastructure/persistence/repositories/stream-dead-letter.repository';
import {
  EVENT_PUBLISHER_TOKEN,
  STREAM_DEAD_LETTER_REPOSITORY_TOKEN,
  STREAM_DEAD_LETTERS_SERVICE_TOKEN,
} from './events.tokens';

// Re-export tokens for convenience
export { EVENT_PUBLISHER_TOKEN } from './events.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([StreamDeadLetterOrmEntity])],
  providers: [
    RedisStreamsEventPublisher,
    {
      provide: EVENT_PUBLISHER_TOKEN,
      useExisting: RedisStreamsEventPublisher,
    },
    StreamDeadLetterRepository,
    {
      provide: STREAM_DEAD_LETTER_REPOSITORY_TOKEN,
      useExisting: StreamDeadLetterRepository,
    },
    StreamDeadLettersService,
    {
      provide: STREAM_DEAD_LETTERS_SERVICE_TOKEN,
      useExisting: StreamDeadLettersService,
    },
  ],
  exports: [
    EVENT_PUBLISHER_TOKEN,
    RedisStreamsEventPublisher,
    STREAM_DEAD_LETTER_REPOSITORY_TOKEN,
    STREAM_DEAD_LETTERS_SERVICE_TOKEN,
  ],
})
export class EventsModule {}






