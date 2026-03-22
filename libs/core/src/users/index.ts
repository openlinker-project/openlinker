/**
 * Users Module Public API
 *
 * Exports domain entities, ports, exceptions, and the NestJS module for the
 * users bounded context.
 *
 * @module libs/core/src/users
 */
export { User } from './domain/entities/user.entity';
export type { UserRepositoryPort } from './domain/ports/user-repository.port';
export { UserNotFoundException } from './domain/exceptions/user-not-found.exception';
export { UsersModule, USER_REPOSITORY_TOKEN } from './users.module';

// ORM entity exported for testing and TypeORM CLI usage
export { UserOrmEntity } from './infrastructure/persistence/entities/user.orm-entity';
