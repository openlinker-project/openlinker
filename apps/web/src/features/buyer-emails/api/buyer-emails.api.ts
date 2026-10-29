/**
 * Buyer Emails API (#3555)
 *
 * The two buyer-email routes: an order's delivery history (read by admin,
 * operator and viewer) and the template editor's test send (admin). The
 * connection opt-in and the template wording are written through the existing
 * connections and automations APIs.
 *
 * @module apps/web/src/features/buyer-emails/api
 */
import { z } from 'zod';
import type { ApiRequest } from '../../../app/api/api-client';
import type { BuyerEmailDelivery, SendBuyerEmailTestInput } from './buyer-emails.types';

const deliverySchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  templateKey: z.string(),
  subjectRef: z.string(),
  outcome: z.enum(['pending', 'sent', 'suppressed', 'bounced']),
  suppressionReason: z.string().nullable(),
  suppressionMessage: z.string().nullable(),
  createdAt: z.string(),
});

/** A row this build cannot read is left out rather than shown as something it may not be. */
export function parseBuyerEmailDeliveries(raw: unknown): BuyerEmailDelivery[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    const parsed = deliverySchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export interface BuyerEmailsApi {
  listForOrder: (internalOrderId: string) => Promise<BuyerEmailDelivery[]>;
  sendTest: (input: SendBuyerEmailTestInput) => Promise<void>;
}

export function createBuyerEmailsApi(request: ApiRequest): BuyerEmailsApi {
  return {
    async listForOrder(internalOrderId): Promise<BuyerEmailDelivery[]> {
      return parseBuyerEmailDeliveries(
        await request<unknown>(`/orders/${encodeURIComponent(internalOrderId)}/buyer-emails`),
      );
    },
    async sendTest(input): Promise<void> {
      await request<unknown>('/buyer-emails/test', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
  };
}
