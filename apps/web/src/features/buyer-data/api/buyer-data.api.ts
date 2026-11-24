/**
 * Buyer Data API (#4289)
 *
 * The one route this feature owns: the trial run. It counts what a set of rules
 * WOULD touch and writes nothing. The rules themselves are saved through the
 * operational-settings and connections APIs.
 *
 * @module apps/web/src/features/buyer-data/api
 */
import { z } from 'zod';
import type { ApiRequest } from '../../../app/api/api-client';
import type { BuyerDataPreview, BuyerDataPreviewInput } from './buyer-data.types';

const previewSchema = z.object({
  toHide: z.number(),
  toErase: z.number(),
  total: z.number(),
  totalOrders: z.number(),
  skippedProtected: z.number().default(0),
  samples: z
    .array(z.object({ orderRef: z.string(), placedAt: z.string(), maskedBuyer: z.string() }))
    .default([]),
});

export function parseBuyerDataPreview(raw: unknown): BuyerDataPreview {
  return previewSchema.parse(raw);
}

export interface BuyerDataApi {
  preview: (input: BuyerDataPreviewInput) => Promise<BuyerDataPreview>;
}

export function createBuyerDataApi(request: ApiRequest): BuyerDataApi {
  return {
    async preview(input): Promise<BuyerDataPreview> {
      return parseBuyerDataPreview(
        await request<unknown>('/orders/buyer-data-retention/preview', {
          method: 'POST',
          body: JSON.stringify(input),
        })
      );
    },
  };
}
