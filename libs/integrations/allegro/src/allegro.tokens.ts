/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the Allegro integration module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/integrations/allegro/src
 */

// Token for dependency injection (interfaces can't be used as values)
export const ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN = Symbol('AllegroQuantityCommandRepositoryPort');


