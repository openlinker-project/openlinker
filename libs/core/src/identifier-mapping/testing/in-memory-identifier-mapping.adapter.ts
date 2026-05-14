/**
 * In-Memory Identifier-Mapping Adapter
 *
 * Test-time-only adapter implementing `IdentifierMappingPort` for plugin
 * authors and unit specs that need to exercise identifier-mapping flows
 * without spinning Postgres. Replicates the production service's semantics:
 * `ol_{prefix}_{uuid}` internal-ID format (via the shared `formatInternalId`
 * helper — single source of truth shared with `IdentifierMappingService`),
 * idempotent `getOrCreateInternalId`, and the domain exception types
 * (`DuplicateIdentifierMappingError`, `IdentifierMappingConflictException`).
 *
 * **Placement**: lives at `<context>/testing/` rather than
 * `<context>/infrastructure/adapters/` because it is never wired into a
 * production module graph — only consumed by `*.spec.ts` files in plugin
 * packages. The AI fake (`fake-ai-completion.adapter.ts`) lives at
 * `infrastructure/adapters/` because it IS wired into production when
 * `OL_AI_PROVIDER=fake`; that's a different role.
 *
 * @module libs/core/src/identifier-mapping/testing
 * @see {@link IdentifierMappingPort} for the port contract
 * @see {@link IdentifierMappingService} for the production implementation
 */
import type {
  IdentifierMappingPort,
} from '../domain/ports/identifier-mapping.port';
import type {
  ExternalIdMapping,
  IdentifierMappingRequest,
  MappingContext,
} from '../domain/types/identifier-mapping.types';
import { formatInternalId } from '../domain/types/identifier-mapping.types';
import { DuplicateIdentifierMappingError } from '../domain/exceptions/duplicate-identifier-mapping.error';
import { IdentifierMappingConflictException } from '../domain/exceptions/identifier-mapping-conflict.exception';

/**
 * Stored row shape. The composite key `(entityType, externalId, connectionId)`
 * is enforced by the `Map`'s key derivation (`keyOf` below). `internalId` and
 * `platformType` are denormalized for the reverse-lookup path.
 */
interface Row {
  readonly entityType: string;
  readonly externalId: string;
  readonly connectionId: string;
  readonly internalId: string;
  readonly platformType: string;
  readonly context: MappingContext | null;
}

/**
 * Seed input for {@link InMemoryIdentifierMappingAdapter.seed}.
 */
export interface InMemoryIdentifierMappingSeed {
  entityType: string;
  externalId: string;
  connectionId: string;
  internalId: string;
  context?: MappingContext;
}

export class InMemoryIdentifierMappingAdapter implements IdentifierMappingPort {
  private readonly rows = new Map<string, Row>();

  /**
   * @param connectionPlatformMap optional map of `connectionId` → `platformType`.
   *
   * **Strictness mode** — chosen by whether the map is empty:
   * - **Empty (default)**: `platformType` denormalises to `''` on every row.
   *   Use this when the spec does not assert on `ExternalIdMapping.platformType`.
   * - **Non-empty**: every `connectionId` passed to a write method MUST be a
   *   key of the map. An unknown `connectionId` throws an `Error` — matching
   *   the production FK-violation that the real repository would surface
   *   when the `connections` row does not exist.
   *
   * This split avoids two failure modes: (a) specs that don't care about
   * `platformType` getting noise from a strict check, and (b) specs that do
   * care getting silent `''` values that diverge from the production adapter.
   */
  constructor(private readonly connectionPlatformMap: Readonly<Record<string, string>> = {}) {}

  getInternalId(
    entityType: string,
    externalId: string,
    connectionId: string,
  ): Promise<string | null> {
    const row = this.rows.get(keyOf(entityType, externalId, connectionId));
    return Promise.resolve(row?.internalId ?? null);
  }

  getExternalIds(entityType: string, internalId: string): Promise<ExternalIdMapping[]> {
    const result: ExternalIdMapping[] = [];
    for (const row of this.rows.values()) {
      if (row.entityType === entityType && row.internalId === internalId) {
        result.push({
          externalId: row.externalId,
          platformType: row.platformType,
          connectionId: row.connectionId,
          entityType: row.entityType,
        });
      }
    }
    return Promise.resolve(result);
  }

  listExternalIdsByConnection(entityType: string, connectionId: string): Promise<string[]> {
    const result: string[] = [];
    for (const row of this.rows.values()) {
      if (row.entityType === entityType && row.connectionId === connectionId) {
        result.push(row.externalId);
      }
    }
    return Promise.resolve(result);
  }

  getOrCreateInternalId(
    entityType: string,
    externalId: string,
    connectionId: string,
    context?: MappingContext,
  ): Promise<string> {
    const guard = this.checkConnectionKnown(connectionId);
    if (guard) return Promise.reject(guard);
    const key = keyOf(entityType, externalId, connectionId);
    const existing = this.rows.get(key);
    if (existing) {
      return Promise.resolve(existing.internalId);
    }
    const internalId = this.generateInternalId(entityType);
    this.rows.set(key, this.buildRow(entityType, externalId, connectionId, internalId, context));
    return Promise.resolve(internalId);
  }

  createMapping(
    entityType: string,
    externalId: string,
    connectionId: string,
    internalId: string,
    context?: MappingContext,
  ): Promise<void> {
    const guard = this.checkConnectionKnown(connectionId);
    if (guard) return Promise.reject(guard);
    const key = keyOf(entityType, externalId, connectionId);
    if (this.rows.has(key)) {
      return Promise.reject(
        new DuplicateIdentifierMappingError(
          entityType,
          externalId,
          this.platformTypeFor(connectionId),
          connectionId,
        ),
      );
    }
    this.rows.set(key, this.buildRow(entityType, externalId, connectionId, internalId, context));
    return Promise.resolve();
  }

  async batchGetOrCreateInternalIds(
    requests: IdentifierMappingRequest[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const req of requests) {
      const internalId = await this.getOrCreateInternalId(
        req.entityType,
        req.externalId,
        req.connectionId,
        req.context,
      );
      result.set(`${req.externalId}:${req.connectionId}`, internalId);
    }
    return result;
  }

  getOrCreateExactMapping(
    entityType: string,
    externalId: string,
    internalId: string,
    connectionId: string,
    context?: MappingContext,
  ): Promise<string> {
    const guard = this.checkConnectionKnown(connectionId);
    if (guard) return Promise.reject(guard);
    const key = keyOf(entityType, externalId, connectionId);
    const existing = this.rows.get(key);
    if (existing) {
      if (existing.internalId === internalId) {
        return Promise.resolve(externalId);
      }
      return Promise.reject(
        new IdentifierMappingConflictException(
          entityType,
          externalId,
          connectionId,
          existing.internalId,
          internalId,
        ),
      );
    }
    this.rows.set(key, this.buildRow(entityType, externalId, connectionId, internalId, context));
    return Promise.resolve(externalId);
  }

  deleteMapping(entityType: string, externalId: string, connectionId: string): Promise<void> {
    this.rows.delete(keyOf(entityType, externalId, connectionId));
    return Promise.resolve();
  }

  // ----- test helpers (not part of the port contract) -----

  /**
   * Reset all stored mappings. Typical use: `beforeEach(() => adapter.clear())`.
   */
  clear(): void {
    this.rows.clear();
  }

  /**
   * Pre-populate a mapping without going through `getOrCreateInternalId`.
   * Overwrites any existing row at the same `(entityType, externalId, connectionId)` key.
   *
   * Honours strict mode: throws synchronously when `connectionPlatformMap`
   * is non-empty and `connectionId` is missing — `seed` is a test helper
   * (not part of the port contract), so a sync throw is the right shape.
   */
  seed(input: InMemoryIdentifierMappingSeed): void {
    const guard = this.checkConnectionKnown(input.connectionId);
    if (guard) throw guard;
    this.rows.set(
      keyOf(input.entityType, input.externalId, input.connectionId),
      this.buildRow(
        input.entityType,
        input.externalId,
        input.connectionId,
        input.internalId,
        input.context,
      ),
    );
  }

  // ----- internals -----

  private buildRow(
    entityType: string,
    externalId: string,
    connectionId: string,
    internalId: string,
    context: MappingContext | undefined,
  ): Row {
    return {
      entityType,
      externalId,
      connectionId,
      internalId,
      platformType: this.platformTypeFor(connectionId),
      context: context ?? null,
    };
  }

  /**
   * Always-safe `platformType` lookup. Returns `''` for unknown ids in both
   * modes. Callers wanting strict-mode behaviour MUST call
   * {@link checkConnectionKnown} first and short-circuit on a non-null result.
   */
  private platformTypeFor(connectionId: string): string {
    return this.connectionPlatformMap[connectionId] ?? '';
  }

  /**
   * Strict-mode guard. Returns an `Error` describing the unknown id when the
   * `connectionPlatformMap` is non-empty AND the id is missing; returns `null`
   * otherwise. Returned (not thrown) so public methods can `return Promise.reject(err)`
   * and the port's `Promise<T>` contract isn't violated by a synchronous throw.
   */
  private checkConnectionKnown(connectionId: string): Error | null {
    if (this.connectionPlatformMap[connectionId] !== undefined) {
      return null;
    }
    if (Object.keys(this.connectionPlatformMap).length === 0) {
      return null;
    }
    return new Error(
      `InMemoryIdentifierMappingAdapter: unknown connectionId '${connectionId}'. ` +
        `Seed it in the constructor's connectionPlatformMap or omit the map to opt into lax mode.`,
    );
  }

  private generateInternalId(entityType: string): string {
    // Delegates to the shared `formatInternalId` helper so the test fake and
    // the production `IdentifierMappingService` can never drift on ID shape.
    return formatInternalId(entityType);
  }
}

function keyOf(entityType: string, externalId: string, connectionId: string): string {
  return `${entityType}\x00${externalId}\x00${connectionId}`;
}
