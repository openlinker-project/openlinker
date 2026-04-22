/**
 * Content Draft Service Interface
 *
 * Application-layer contract for managing the draft lifecycle of product
 * content fields: save, discard, publish, inbound-reconcile, and resolve.
 *
 * @module libs/core/src/content/application/services
 */
import type { ProductContentField } from '../../domain/entities/product-content-field.entity';
import type {
  DiscardDraftCommand,
  PublishDraftCommand,
  ReconcileExternalCommand,
  ResolveValueQuery,
  SaveDraftCommand,
} from '../types/content-draft.types';

export interface IContentDraftService {
  /** Upsert the row's `draftValue`. Implicitly clears `hasConflict` (re-saving acknowledges the divergence). */
  saveDraft(cmd: SaveDraftCommand): Promise<ProductContentField>;

  /** Null out `draftValue` on the row. No-op when the row does not exist. */
  discardDraft(cmd: DiscardDraftCommand): Promise<void>;

  /** Push the draft to the platform via `ContentPublisherPort`, then clear the draft and update the base. */
  publishDraft(cmd: PublishDraftCommand): Promise<ProductContentField>;

  /** Inbound sync hook: silently update base when no draft; mark conflict when draft + divergence. */
  reconcileExternal(cmd: ReconcileExternalCommand): Promise<ProductContentField>;

  /** Read-side resolution: returns the value the application should display / use, with channel→master fallback. */
  resolveValue(query: ResolveValueQuery): Promise<string | null>;
}
