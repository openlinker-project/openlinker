/**
 * Bundles API client (#3624)
 *
 * @module apps/web/src/features/bundles/api
 */
import type {
  BundleComponentInput,
  BundleCreated,
  BundleCreationTarget,
  CreateBundleProductInput,
  CreatedBundleProduct,
  BundleDefinition,
  BundleDetail,
  BundleHistoryEntry,
  BundleUsedIn,
  MultipackConfirmed,
} from './bundles.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface BundlesApi {
  get: (variantId: string) => Promise<BundleDetail>;
  history: (variantId: string) => Promise<BundleHistoryEntry[]>;
  usedIn: (variantId: string) => Promise<BundleUsedIn[]>;
  /** One request for every variant of a product. */
  usedInMany: (variantIds: readonly string[]) => Promise<BundleUsedIn[]>;
  create: (variantId: string, components: BundleComponentInput[]) => Promise<BundleCreated>;
  update: (variantId: string, components: BundleComponentInput[]) => Promise<BundleDefinition>;
  /** Writes the master's composition as the next version (#3932). Only on the operator's click. */
  syncFromMaster: (variantId: string) => Promise<BundleDefinition>;
  /** Product masters, and whether each can create a product from OpenLinker (#3935). */
  creationTargets: () => Promise<BundleCreationTarget[]>;
  /** Creates the product a new bundle is sold as, at a product master (#3935). */
  createProduct: (input: CreateBundleProductInput) => Promise<CreatedBundleProduct>;
  /** "This offer sells N x product": lets every held multipack order continue. */
  confirmMultipack: (variantId: string, packQuantity: number) => Promise<MultipackConfirmed>;
}

export function createBundlesApi(request: ApiRequest): BundlesApi {
  return {
    get: (variantId) => request<BundleDetail>(`/bundle-definitions/${encodeURIComponent(variantId)}`),
    history: (variantId) =>
      request<BundleHistoryEntry[]>(`/bundle-definitions/${encodeURIComponent(variantId)}/history`),
    usedIn: (variantId) =>
      request<BundleUsedIn[]>(`/bundle-definitions/used-in/${encodeURIComponent(variantId)}`),
    usedInMany: (variantIds) =>
      request<BundleUsedIn[]>(
        `/bundle-definitions/used-in?variantIds=${encodeURIComponent(variantIds.join(','))}`,
      ),
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
    syncFromMaster: (variantId) =>
      request<BundleDefinition>(`/bundle-definitions/${encodeURIComponent(variantId)}/sync-from-master`, {
        method: 'POST',
      }),
    creationTargets: () => request<BundleCreationTarget[]>('/bundle-product-creation/targets'),
    createProduct: (input) =>
      request<CreatedBundleProduct>('/bundle-product-creation/products', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    confirmMultipack: (variantId, packQuantity) =>
      request<MultipackConfirmed>('/bundle-definitions/multipack-confirmations', {
        method: 'POST',
        body: JSON.stringify({ variantId, packQuantity }),
      }),
  };
}
