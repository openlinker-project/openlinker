/**
 * Shopify Order Contact Refused Exception
 *
 * The contact refresh (`OrderContactRefresher`) will not touch this copy of the
 * order, and says why: Shopify no longer has it, or it is cancelled or closed.
 * Deterministic, so never retried. Core warn-logs it, because the refresh is
 * best-effort and the order itself already sits where it belongs.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export const ShopifyOrderContactRefusalValues = ['not-found', 'cancelled', 'closed'] as const;
export type ShopifyOrderContactRefusal = (typeof ShopifyOrderContactRefusalValues)[number];

export class ShopifyOrderContactRefusedException extends Error {
  constructor(
    readonly externalOrderId: string,
    readonly reason: ShopifyOrderContactRefusal,
    detail: string,
  ) {
    super(`Shopify order ${externalOrderId} contact not refreshed (${reason}): ${detail}`);
    this.name = 'ShopifyOrderContactRefusedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
