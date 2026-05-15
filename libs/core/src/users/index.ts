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
export { RefreshToken } from './domain/entities/refresh-token.entity';
export type { UserRepositoryPort } from './domain/ports/user-repository.port';
export type { PasswordResetTokenRepositoryPort } from './domain/ports/password-reset-token-repository.port';
export type { PasswordResetNotifierPort } from './domain/ports/password-reset-notifier.port';
export type { RefreshTokenRepositoryPort } from './domain/ports/refresh-token-repository.port';
export { UserNotFoundException } from './domain/exceptions/user-not-found.exception';
export { InvalidPasswordResetTokenException } from './domain/exceptions/invalid-password-reset-token.exception';
export { WeakPasswordException } from './domain/exceptions/weak-password.exception';
export { RefreshTokenReuseDetectedException } from './domain/exceptions/refresh-token-reuse-detected.exception';
export { UsersModule } from './users.module';
export * from './users.tokens';
export {
  UserRoleValues,
  PermissionValues,
  ROLE_PERMISSIONS,
} from './domain/types/role.types';
export type { UserRole, Permission } from './domain/types/role.types';
export {
  RefreshTokenRevocationReasonValues,
} from './domain/types/refresh-token.types';
export type { RefreshTokenRevocationReason } from './domain/types/refresh-token.types';

// Users-context ORM entities have no external consumer today; the TypeORM CLI
// discovers them via the `**/*.orm-entity.{ts,js}` glob in
// `apps/api/src/database/data-source.ts`. If a future host or integration test
// fixture needs them, add a `users/orm-entities.ts` sub-barrel (#594).
