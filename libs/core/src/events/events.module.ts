/**
 * Events Module
 *
 * NestJS module for event bus functionality. Configures event publisher
 * and dependency injection. Exports the EventPublisherPort for use in
 * other modules (API, Worker).
 *
 * @module libs/core/src/events
 */
import { Module } from '@nestjs/common';
import { RedisStreamsEventPublisher } from './infrastructure/adapters/redis-streams-event-publisher';
import { EVENT_PUBLISHER_TOKEN } from './events.tokens';

// Re-export tokens for convenience
export { EVENT_PUBLISHER_TOKEN } from './events.tokens';

@Module({
  providers: [
    RedisStreamsEventPublisher,
    {
      provide: EVENT_PUBLISHER_TOKEN,
      useExisting: RedisStreamsEventPublisher,
    },
  ],
  exports: [
    EVENT_PUBLISHER_TOKEN,
    RedisStreamsEventPublisher,
  ],
})
export class EventsModule {}

