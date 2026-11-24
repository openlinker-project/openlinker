/**
 * Buyer Data API (#4289)
 *
 * The two reads this feature owns: the plan (it counts what a set of rules WOULD
 * touch and writes nothing) and the age histogram of the orders in scope. The rules themselves are saved through the
 * operational-settings and connections APIs.
 *
 * @module apps/web/src/features/buyer-data/api
 */
import { z } from 'zod';
import type { ApiRequest } from '../../../app/api/api-client';
import type {
  BuyerDataAgeHistogram,
  BuyerDataPreview,
  BuyerDataPreviewInput,
} from './buyer-data.types';

const previewSchema = z.object({
  toHide: z.number(),
  toErase: z.number(),
  total: z.number(),
  totalOrders: z.number(),
  skippedProtected: z.number().default(0),
  // Optional-tolerant until every server reports the split.
  skippedByReason: z
    .object({
      openReturn: z.number().default(0),
      hold: z.number().default(0),
      invoicePending: z.number().default(0),
    })
    .default({ openReturn: 0, hold: 0, invoicePending: 0 }),
  samples: z
    .array(z.object({ orderRef: z.string(), placedAt: z.string(), maskedBuyer: z.string() }))
    .default([]),
});

const histogramSchema = z.object({
  bucketUnit: z.literal('month').default('month'),
  buckets: z
    .array(
      z.object({
        ageMonths: z.number(),
        visible: z.number().default(0),
        hidden: z.number().default(0),
        erased: z.number().default(0),
      })
    )
    .default([]),
  totalOrders: z.number().default(0),
  oldestPlacedAt: z.string().nullable().default(null),
});

export function parseBuyerDataAgeHistogram(raw: unknown): BuyerDataAgeHistogram {
  return histogramSchema.parse(raw);
}

export function parseBuyerDataPreview(raw: unknown): BuyerDataPreview {
  return previewSchema.parse(raw);
}

export interface BuyerDataApi {
  preview: (input: BuyerDataPreviewInput, signal?: AbortSignal) => Promise<BuyerDataPreview>;
  ageHistogram: (connectionId?: string, signal?: AbortSignal) => Promise<BuyerDataAgeHistogram>;
}

export function createBuyerDataApi(request: ApiRequest): BuyerDataApi {
  return {
    async preview(input, signal): Promise<BuyerDataPreview> {
      return parseBuyerDataPreview(
        await request<unknown>('/orders/buyer-data-retention/preview', {
          method: 'POST',
          body: JSON.stringify(input),
          signal,
        })
      );
    },
    async ageHistogram(connectionId, signal): Promise<BuyerDataAgeHistogram> {
      const query =
        connectionId === undefined ? '' : `?connectionId=${encodeURIComponent(connectionId)}`;
      return parseBuyerDataAgeHistogram(
        await request<unknown>(`/orders/buyer-data-retention/age-histogram${query}`, { signal })
      );
    },
  };
}
