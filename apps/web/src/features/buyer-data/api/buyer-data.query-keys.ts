/**
 * Buyer Data Query Keys (#4289)
 *
 * @module apps/web/src/features/buyer-data/api
 */
import type { BuyerDataPreviewInput } from './buyer-data.types';

export const buyerDataQueryKeys = {
  all: ['buyer-data'] as const,
  impact: (input: BuyerDataPreviewInput) => ['buyer-data', 'impact', input] as const,
};
