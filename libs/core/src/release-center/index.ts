/**
 * Release Center Context Public API
 *
 * Per-user release cursor and item state, plus installation-wide step state
 * (ADR-086). A zero-sibling-edge leaf, not in the root barrel.
 *
 * @module libs/core/src/release-center
 */
export * from './domain/types/release-center.types';
export * from './domain/entities/release-center.entity';
export * from './domain/exceptions/release-center.exceptions';
export type {
  AdvanceReleaseCursorResult,
  ReleaseCursorRepositoryPort,
} from './domain/ports/release-cursor-repository.port';
export type { ReleaseItemStateRepositoryPort } from './domain/ports/release-item-state-repository.port';
export type {
  IReleaseCursorService,
  ReleaseCursorUpdate,
} from './application/services/release-cursor.service.interface';
export type {
  IReleaseItemStateService,
  ReleaseStateSnapshot,
} from './application/services/release-item-state.service.interface';
export { ReleaseCenterModule } from './release-center.module';
export * from './release-center.tokens';
