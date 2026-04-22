/**
 * Content Publisher Port
 *
 * Abstraction over "where does this content value get pushed to". Lets
 * `ContentDraftService` stay platform-agnostic — it asks the publisher to
 * push a (productId, connectionId, fieldKey, value) tuple and gets back an
 * opaque `baseVersion` to record on the row.
 *
 * The MVP `IntegrationsContentPublisher` resolves master rows
 * (`connectionId === null`) via `ProductMasterPort.updateProduct`. Channel
 * rows throw `ChannelContentPublishNotSupportedException` until #339/#342
 * wire offer discovery + `MarketplacePort.updateOfferFields`.
 *
 * @module libs/core/src/content/domain/ports
 */
import type { FieldKey } from '../types/content.types';

export interface ContentPublishRequest {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
  value: string;
}

export interface ContentPublishResult {
  /**
   * Opaque platform-specific version marker (e.g. PrestaShop `date_upd`,
   * Allegro `revision`). Recorded as `baseVersion` on the row so the next
   * inbound reconcile can detect divergence by string inequality.
   */
  baseVersion: string;
}

export interface ContentPublisherPort {
  publish(request: ContentPublishRequest): Promise<ContentPublishResult>;
}
