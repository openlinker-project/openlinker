/**
 * Gifts API client (#3940)
 *
 * The manual add-gift edit (`POST /orders/:id/edits/gift`) and the order's
 * gift-attention reads. The promotions themselves live in `features/promotions`.
 *
 * @module apps/web/src/features/gifts/api
 */
import type {
  AddGiftInput,
  AddGiftResult,
  GiftAttentionEntry,
  GiftAttentionResult,
} from './gifts.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface GiftsApi {
  addGiftToOrder: (internalOrderId: string, input: AddGiftInput) => Promise<AddGiftResult>;
  /** The order's add-gift firings that did not give their gift. */
  getGiftAttention: (internalOrderId: string) => Promise<GiftAttentionResult>;
  /** "Send without the gift": records that a person handled this firing. */
  skipGiftAttention: (internalOrderId: string, runId: string) => Promise<GiftAttentionEntry>;
}

export function createGiftsApi(request: ApiRequest): GiftsApi {
  return {
    addGiftToOrder: (internalOrderId, input) =>
      request<AddGiftResult>(`/orders/${encodeURIComponent(internalOrderId)}/edits/gift`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    getGiftAttention: (internalOrderId) =>
      request<GiftAttentionResult>(`/orders/${encodeURIComponent(internalOrderId)}/gift-attention`),
    skipGiftAttention: (internalOrderId, runId) =>
      request<GiftAttentionEntry>(
        `/orders/${encodeURIComponent(internalOrderId)}/gift-attention/${encodeURIComponent(runId)}/skip`,
        { method: 'POST' },
      ),
  };
}
