/**
 * Content Bounded Context — Public Surface
 *
 * Exports domain types/entities/exceptions/ports, the application service
 * interface, and the NestJS module. Consumers should depend on the port +
 * service-interface tokens via `@Inject(...)`, never on concrete classes.
 *
 * @module libs/core/src/content
 */
export * from './domain/entities/product-content-field.entity';
export * from './domain/types/content.types';
export * from './domain/ports/product-content-field-repository.port';
export * from './domain/ports/content-publisher.port';
export * from './domain/exceptions/content-conflict.exception';
export * from './domain/exceptions/content-field-not-found.exception';
export * from './domain/exceptions/channel-content-publish-not-supported.exception';
export * from './domain/exceptions/channel-adapter-lacks-field-updater.exception';
export * from './domain/exceptions/no-linked-offers.exception';
export * from './domain/exceptions/no-product-master-adapter.exception';
export * from './domain/exceptions/content-publish-missing-version.exception';
export * from './application/services/content-draft.service.interface';
export * from './application/services/content-state-reader.service.interface';
export * from './application/services/content-suggestion.service.interface';
export { ContentSuggestionService } from './application/services/content-suggestion.service';
export * from './application/types/content-draft.types';
export * from './application/types/content-state.types';
export * from './application/types/content-suggestion.types';
export * from './content.tokens';
export { ContentModule } from './content.module';

// ORM entities are exposed on the host-only `@openlinker/core/content/orm-entities`
// sub-path (#594). Plugins must not import them from here.
