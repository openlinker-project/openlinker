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

// Infrastructure exports (for testing/mocking)
export { RedisStreamsEventPublisher } from './infrastructure/adapters/redis-streams-event-publisher';

// Module and tokens
export { EventsModule } from './events.module';
export { EVENT_PUBLISHER_TOKEN } from './events.tokens';

