/**
 * Connection-Config Read Policy
 *
 * `Connection.config` is an untyped JSONB blob at the boundary, and
 * `EparagonyConnectionConfig` declares two fields as REQUIRED because they are
 * required for a working connection - `EparagonyConnectionConfigShapeValidatorAdapter`
 * refuses to persist a connection without them.
 *
 * That leaves exactly one place where an unchecked assertion is needed, and this
 * is it: one documented function rather than an `as unknown as` scattered across
 * the factory and the connection tester. Callers still verify what they actually
 * depend on - a row written before the validator existed, or edited straight in
 * the database, would otherwise reach the adapter half-configured.
 *
 * Pure - no I/O, no framework.
 *
 * @module libs/integrations/eparagony/src/domain/policies
 */
import type { EparagonyConnectionConfig } from '../types/eparagony-config.types';

export function readEparagonyConnectionConfig(
  raw: Record<string, unknown> | null | undefined,
): EparagonyConnectionConfig {
  return (raw ?? {}) as unknown as EparagonyConnectionConfig;
}
