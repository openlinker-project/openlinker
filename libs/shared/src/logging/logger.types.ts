/**
 * Logger Types
 *
 * Enumerated log levels following the documented `as const + union` pattern
 * (engineering-standards "Union Types"). `LogLevelValues` is the runtime
 * array; `LogLevel` is the derived union type.
 *
 * @module libs/shared/src/logging
 */
export const LogLevelValues = ['log', 'debug', 'warn', 'error'] as const;
export type LogLevel = (typeof LogLevelValues)[number];
