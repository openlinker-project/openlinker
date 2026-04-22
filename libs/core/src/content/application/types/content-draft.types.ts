/**
 * Content Draft Application-Layer Types
 *
 * Command and query DTOs for `ContentDraftService`. Kept separate from the
 * domain types because they describe the application surface (caller intent)
 * rather than domain invariants.
 *
 * @module libs/core/src/content/application/types
 */
import type { FieldKey } from '../../domain/types/content.types';

export interface SaveDraftCommand {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
  value: string;
  /** Acting user id (string) for audit. `null` is reserved for system writers; user-driven save commands always carry a user id. */
  userId: string;
}

export interface DiscardDraftCommand {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
}

export interface PublishDraftCommand {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
}

export interface ReconcileExternalCommand {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
  externalValue: string;
  externalVersion: string;
}

export interface ResolveValueQuery {
  productId: string;
  /**
   * `null` resolves the master value only. A non-null connectionId resolves
   * channel-with-master-fallback (channel draft → channel base → master draft → master base → null).
   */
  connectionId: string | null;
  fieldKey: FieldKey;
}
