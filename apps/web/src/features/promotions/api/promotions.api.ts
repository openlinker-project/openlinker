/**
 * Promotions API client (#3935)
 *
 * `/promotions`: the list in the order it is checked, one promotion, the write
 * routes, the exhaustive reorder, the cap resume, the dry run and the history of
 * what a promotion did to orders.
 *
 * @module apps/web/src/features/promotions/api
 */
import type {
  Promotion,
  PromotionDryRunResult,
  PromotionEvaluateInput,
  PromotionHistory,
  PromotionWriteInput,
} from './promotions.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface PromotionsApi {
  /** Promotions in the order they are checked. */
  list: () => Promise<Promotion[]>;
  get: (id: string) => Promise<Promotion>;
  create: (input: PromotionWriteInput) => Promise<Promotion>;
  /** A full replace: the body must carry the whole definition. */
  replace: (id: string, input: PromotionWriteInput) => Promise<Promotion>;
  remove: (id: string) => Promise<void>;
  /** Exhaustive: EVERY promotion id, once each, in the new order. */
  reorder: (promotionIds: readonly string[]) => Promise<Promotion[]>;
  resume: (id: string, additionalUnits: number) => Promise<Promotion>;
  /** The dry run: nothing is written. */
  evaluate: (input: PromotionEvaluateInput) => Promise<PromotionDryRunResult>;
  history: (id: string) => Promise<PromotionHistory>;
}

export function createPromotionsApi(request: ApiRequest): PromotionsApi {
  const one = (id: string): string => `/promotions/${encodeURIComponent(id)}`;
  return {
    list: () => request<Promotion[]>('/promotions'),
    get: (id) => request<Promotion>(one(id)),
    create: (input) => request<Promotion>('/promotions', { method: 'POST', body: JSON.stringify(input) }),
    replace: (id, input) => request<Promotion>(one(id), { method: 'PUT', body: JSON.stringify(input) }),
    remove: (id) => request<void>(one(id), { method: 'DELETE' }),
    reorder: (promotionIds) =>
      request<Promotion[]>('/promotions/order', { method: 'PUT', body: JSON.stringify({ promotionIds }) }),
    resume: (id, additionalUnits) =>
      request<Promotion>(`${one(id)}/resume`, { method: 'POST', body: JSON.stringify({ additionalUnits }) }),
    evaluate: (input) =>
      request<PromotionDryRunResult>('/promotions/evaluate', { method: 'POST', body: JSON.stringify(input) }),
    history: (id) => request<PromotionHistory>(`${one(id)}/history`),
  };
}
