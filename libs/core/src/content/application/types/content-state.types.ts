/**
 * Content State Types
 *
 * Read-side shape returned by `IContentStateReaderService.readState`. Mirrors
 * the editor panel layout: a single master summary + one summary per active
 * content-capable connection with linked offers for the product.
 *
 * @module libs/core/src/content/application/types
 */

export interface ContentMasterState {
  baseValue: string | null;
  draftValue: string | null;
  hasConflict: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ContentChannelState {
  connectionId: string;
  connectionName: string;
  platformType: string;
  connectionStatus: string;
  baseValue: string | null;
  draftValue: string | null;
  hasConflict: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  linkedOfferCount: number;
}

export interface ContentState {
  productId: string;
  master: ContentMasterState;
  channels: ContentChannelState[];
}
