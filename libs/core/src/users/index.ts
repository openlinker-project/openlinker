/**
 * Users Module Public API
 *
 * Exports domain entities, ports, exceptions, types, and the NestJS module
 * for the users bounded context.
 *
 * @module libs/core/src/users
 */
export { User } from './domain/entities/user.entity';
export { PasswordResetToken } from './domain/entities/password-reset-token.entity';
export type { UserRepositoryPort } from './domain/ports/user-repository.port';
export type { PasswordResetTokenRepositoryPort } from './domain/ports/password-reset-token-repository.port';
export type { PasswordResetNotifierPort } from './domain/ports/password-reset-notifier.port';
export { UserNotFoundException } from './domain/exceptions/user-not-found.exception';
export { InvalidPasswordResetTokenException } from './domain/exceptions/invalid-password-reset-token.exception';
export {
  UsersModule,
  USER_REPOSITORY_TOKEN,
  PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN,
} from './users.module';
export {
  UserRoleValues,
  PermissionValues,
  ROLE_PERMISSIONS,
} from './domain/types/role.types';
export type { UserRole, Permission } from './domain/types/role.types';

// ORM entities exported for testing and TypeORM CLI usage
export { UserOrmEntity } from './infrastructure/persistence/entities/user.orm-entity';
export { PasswordResetTokenOrmEntity } from './infrastructure/persistence/entities/password-reset-token.orm-entity';
