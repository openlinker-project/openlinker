/**
 * Saved Views API Client
 *
 * Thin HTTP adapter over `/saved-views` (#4241). A view's definition is opaque
 * to the server beyond its limits; reading it back is tolerant, so a stored
 * definition is coerced here instead of trusted.
 *
 * @module apps/web/src/features/saved-views/api
 */
import { coerceViewDefinition } from '../lib/coerce-view-definition';
import type {
  CreateSavedViewInput,
  SavedView,
  SetDefaultViewInput,
  UpdateSavedViewInput,
} from '../lib/saved-view.types';

export interface SavedViewsApi {
  list: (pageKey: string) => Promise<SavedView[]>;
  create: (input: CreateSavedViewInput) => Promise<SavedView>;
  update: (id: string, input: UpdateSavedViewInput) => Promise<SavedView>;
  remove: (id: string) => Promise<void>;
  setDefault: (input: SetDefaultViewInput) => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function reviveView(view: SavedView): SavedView {
  return { ...view, definition: coerceViewDefinition(view.definition) };
}

export function createSavedViewsApi(request: ApiRequest): SavedViewsApi {
  return {
    async list(pageKey): Promise<SavedView[]> {
      const rows = await request<SavedView[]>(`/saved-views?pageKey=${encodeURIComponent(pageKey)}`);
      return rows.map(reviveView);
    },
    async create(input): Promise<SavedView> {
      return reviveView(
        await request<SavedView>('/saved-views', { method: 'POST', body: JSON.stringify(input) }),
      );
    },
    async update(id, input): Promise<SavedView> {
      return reviveView(
        await request<SavedView>(`/saved-views/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify(input),
        }),
      );
    },
    async remove(id): Promise<void> {
      await request<void>(`/saved-views/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async setDefault(input): Promise<void> {
      await request<void>('/saved-views/default', { method: 'PUT', body: JSON.stringify(input) });
    },
  };
}
