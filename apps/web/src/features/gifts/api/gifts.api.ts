/**
 * Gifts API client (#3940)
 *
 * Gift rules (`/gift-rules`) and the manual add-gift edit
 * (`POST /orders/:id/edits/gift`).
 *
 * @module apps/web/src/features/gifts/api
 */
import type {
  AddGiftInput,
  AddGiftResult,
  GiftDryRunResult,
  GiftAttentionEntry,
  GiftAttentionResult,
  GiftEvaluateInput,
  GiftRule,
  GiftRuleWriteInput,
} from './gifts.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface GiftsApi {
  /** Gift rules in the order they are checked. */
  listRules: () => Promise<GiftRule[]>;
  getRule: (ruleId: string) => Promise<GiftRule>;
  createRule: (input: GiftRuleWriteInput) => Promise<GiftRule>;
  /** A full replace: the body must carry the whole definition. */
  replaceRule: (ruleId: string, input: GiftRuleWriteInput) => Promise<GiftRule>;
  deleteRule: (ruleId: string) => Promise<void>;
  /** Exhaustive: EVERY rule id, once each, in the new order. */
  reorderRules: (ruleIds: readonly string[]) => Promise<GiftRule[]>;
  resumeRule: (ruleId: string, additionalUnits: number) => Promise<GiftRule>;
  /** The dry run: nothing is written. */
  evaluate: (input: GiftEvaluateInput) => Promise<GiftDryRunResult>;
  addGiftToOrder: (internalOrderId: string, input: AddGiftInput) => Promise<AddGiftResult>;
  /** The order's add-gift firings that did not give their gift. */
  getGiftAttention: (internalOrderId: string) => Promise<GiftAttentionResult>;
  /** "Send without the gift": records that a person handled this firing. */
  skipGiftAttention: (internalOrderId: string, runId: string) => Promise<GiftAttentionEntry>;
}

export function createGiftsApi(request: ApiRequest): GiftsApi {
  const rule = (id: string): string => `/gift-rules/${encodeURIComponent(id)}`;
  return {
    listRules: () => request<GiftRule[]>('/gift-rules'),
    getRule: (ruleId) => request<GiftRule>(rule(ruleId)),
    createRule: (input) =>
      request<GiftRule>('/gift-rules', { method: 'POST', body: JSON.stringify(input) }),
    replaceRule: (ruleId, input) =>
      request<GiftRule>(rule(ruleId), { method: 'PUT', body: JSON.stringify(input) }),
    deleteRule: (ruleId) => request<void>(rule(ruleId), { method: 'DELETE' }),
    reorderRules: (ruleIds) =>
      request<GiftRule[]>('/gift-rules/order', { method: 'PUT', body: JSON.stringify({ ruleIds }) }),
    resumeRule: (ruleId, additionalUnits) =>
      request<GiftRule>(`${rule(ruleId)}/resume`, {
        method: 'POST',
        body: JSON.stringify({ additionalUnits }),
      }),
    evaluate: (input) =>
      request<GiftDryRunResult>('/gift-rules/evaluate', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
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
