/**
 * Content Feature — API Client
 *
 * Thin HTTP adapter over the admin-only `/products/:id/content/*`
 * endpoints. Instantiated by `createApiClient()`; consumed via
 * `useApiClient().content`.
 *
 * @module apps/web/src/features/content/api
 */
import type {
  ContentFieldResponse,
  ContentState,
  DiscardContentDraftInput,
  PublishContentInput,
  SaveContentDraftInput,
  SuggestContentInput,
  SuggestionResponse,
} from './content.types';

export interface ContentApi {
  get: (productId: string) => Promise<ContentState>;
  saveDraft: (productId: string, input: SaveContentDraftInput) => Promise<ContentFieldResponse>;
  discardDraft: (productId: string, input: DiscardContentDraftInput) => Promise<void>;
  publish: (productId: string, input: PublishContentInput) => Promise<ContentFieldResponse>;
  suggest: (productId: string, input: SuggestContentInput) => Promise<SuggestionResponse>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createContentApi(request: ApiRequest): ContentApi {
  return {
    get(productId): Promise<ContentState> {
      return request<ContentState>(`/products/${productId}/content`);
    },
    saveDraft(productId, input): Promise<ContentFieldResponse> {
      return request<ContentFieldResponse>(`/products/${productId}/content/draft`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async discardDraft(productId, input): Promise<void> {
      await request<void>(`/products/${productId}/content/discard`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    publish(productId, input): Promise<ContentFieldResponse> {
      return request<ContentFieldResponse>(`/products/${productId}/content/publish`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    suggest(productId, input): Promise<SuggestionResponse> {
      return request<SuggestionResponse>(`/products/${productId}/content/suggest`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  };
}
