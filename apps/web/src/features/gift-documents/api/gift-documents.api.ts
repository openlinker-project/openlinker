/**
 * Gift documents - API client (#3941)
 *
 * The OpenLinker-wide default is `GET`/`PUT /sales-documents/settings`; the
 * per-connection override lives in `connection.config` and is written through
 * the connections API (see `use-save-gift-on-documents`).
 *
 * @module apps/web/src/features/gift-documents/api
 */
import type { GiftDocumentFormChoice } from '../lib/gift-lines';
import type {
  DocumentProvidersResponse,
  GiftDocumentSettingsResponse,
} from './gift-documents.types';

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface GiftDocumentsApi {
  getSettings: () => Promise<GiftDocumentSettingsResponse>;
  saveSettings: (
    form: GiftDocumentFormChoice,
    unitPrice?: string,
  ) => Promise<GiftDocumentSettingsResponse>;
  getProviders: () => Promise<DocumentProvidersResponse>;
}

export function createGiftDocumentsApi(request: ApiRequest): GiftDocumentsApi {
  return {
    getSettings: () => request<GiftDocumentSettingsResponse>('/sales-documents/settings'),
    saveSettings: (form, unitPrice) =>
      request<GiftDocumentSettingsResponse>('/sales-documents/settings', {
        method: 'PUT',
        body: JSON.stringify({
          giftDocumentForm: form,
          ...(form === 'custom-price' && unitPrice !== undefined
            ? { giftDocumentUnitPrice: unitPrice }
            : {}),
        }),
      }),
    getProviders: () =>
      request<DocumentProvidersResponse>('/sales-documents/settings/document-providers'),
  };
}
