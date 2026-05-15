/**
 * Users DI Tokens
 *
 * Symbol tokens for dependency injection in the users bounded context.
 *
 * @module libs/core/src/users
 */

export const USER_REPOSITORY_TOKEN = Symbol('UserRepositoryPort');
export const PASSWORD_RESET_TOKEN_REPOSITORY_TOKEN = Symbol('PasswordResetTokenRepositoryPort');
export const PASSWORD_RESET_NOTIFIER_TOKEN = Symbol('PasswordResetNotifierPort');
export const REFRESH_TOKEN_REPOSITORY_TOKEN = Symbol('RefreshTokenRepositoryPort');
