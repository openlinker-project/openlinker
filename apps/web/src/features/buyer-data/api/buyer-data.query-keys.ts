/**
 * Buyer Data Query Keys (#4289)
 *
 * @module apps/web/src/features/buyer-data/api
 */
import type { BuyerDataPreviewInput } from './buyer-data.types';

export const buyerDataQueryKeys = {
  all: ['buyer-data'] as const,
  plan: (input: BuyerDataPreviewInput) => ['buyer-data', 'plan', input] as const,
  histogram: (connectionId: string | undefined) =>
    ['buyer-data', 'histogram', connectionId ?? 'all'] as const,
};
