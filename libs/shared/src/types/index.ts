/**
 * Common Type Definitions
 *
 * Shared type utilities and type aliases used across the application.
 * Provides common type patterns for nullable, optional, and maybe types.
 *
 * @module libs/shared/src/types
 */
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type Maybe<T> = T | null | undefined;

