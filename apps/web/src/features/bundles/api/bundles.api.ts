/**
 * Bundles API client (#3624)
 *
 * @module apps/web/src/features/bundles/api
 */
import type {
  BundleComponentInput,
  BundleCreated,
  BundleDefinition,
  BundleDetail,
  BundleHistoryEntry,
  BundleUsedIn,
} from './bundles.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface BundlesApi {
  get: (variantId: string) => Promise<BundleDetail>;
  history: (variantId: string) => Promise<BundleHistoryEntry[]>;
  usedIn: (variantId: string) => Promise<BundleUsedIn[]>;
  create: (variantId: string, components: BundleComponentInput[]) => Promise<BundleCreated>;
  update: (variantId: string, components: BundleComponentInput[]) => Promise<BundleDefinition>;
}

export function createBundlesApi(request: ApiRequest): BundlesApi {
  return {
    get: (variantId) => request<BundleDetail>(`/bundle-definitions/${encodeURIComponent(variantId)}`),
    history: (variantId) =>
      request<BundleHistoryEntry[]>(`/bundle-definitions/${encodeURIComponent(variantId)}/history`),
    usedIn: (variantId) =>
      request<BundleUsedIn[]>(`/bundle-definitions/used-in/${encodeURIComponent(variantId)}`),
    create: (variantId, components) =>
      request<BundleCreated>('/bundle-definitions', {
        method: 'POST',
        body: JSON.stringify({ variantId, components }),
      }),
    update: (variantId, components) =>
      request<BundleDefinition>(`/bundle-definitions/${encodeURIComponent(variantId)}`, {
        method: 'PUT',
        body: JSON.stringify({ components }),
      }),
  };
}
