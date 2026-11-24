/**
 * Return gifts API client (#3943)
 *
 * The gifts on a return's order and the operator's decision on each. A separate
 * module from `returns.api.ts` on purpose: these routes return plain, narrow
 * shapes and nothing here reads the return envelope.
 *
 * @module apps/web/src/features/returns/api
 */
export const RETURN_GIFT_DECISION_VALUES = ['keep', 'ask_back', 'deduct'] as const;
export type ReturnGiftDecision = (typeof RETURN_GIFT_DECISION_VALUES)[number];

export interface ReturnGift {
  giftLineId: string;
  sku: string | null;
  name: string | null;
  quantity: number;
  giftSource: string;
  /** Whole quantity at the catalogue price; `null` when the catalogue has none. */
  standalonePriceGross: number | null;
  /** `null` until the operator decides. */
  decision: ReturnGiftDecision | null;
  deductionGross: number | null;
  note: string | null;
  decidedAt: string | null;
}

export interface ReturnGifts {
  gifts: ReturnGift[];
  currency: string | null;
  refundDeductionGross: number;
}

export interface ReturnGiftsApi {
  getReturnGifts: (returnId: string) => Promise<ReturnGifts>;
  decideReturnGift: (
    returnId: string,
    giftLineId: string,
    body: { decision: ReturnGiftDecision; deductionGross?: number; note?: string }
  ) => Promise<ReturnGift>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createReturnGiftsApi(request: ApiRequest): ReturnGiftsApi {
  const base = (returnId: string): string => `/returns/${encodeURIComponent(returnId)}/gifts`;
  return {
    getReturnGifts: (returnId) => request(base(returnId)),
    decideReturnGift: (returnId, giftLineId, body) =>
      request(`${base(returnId)}/${encodeURIComponent(giftLineId)}/decision`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  };
}
