/**
 * Buyer Emails Query Keys (#3555)
 *
 * @module apps/web/src/features/buyer-emails/api
 */
export const buyerEmailsQueryKeys = {
  all: ['buyer-emails'] as const,
  forOrder: (internalOrderId: string) => ['buyer-emails', 'order', internalOrderId] as const,
};
