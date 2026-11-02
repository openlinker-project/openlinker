/**
 * Buyer Email Delivery Domain Entity (#3554)
 *
 * One automatic buyer email attempt for an order. Anemic per ADR-011.
 * `suppressionReason` is set only for `suppressed`; `recipient` is null under
 * `OL_STORE_PII=false` or when there was no address to send to.
 *
 * @module libs/core/src/orders/domain/entities
 */
import type { BuyerEmailTemplate } from '@openlinker/core/identifier-mapping';
import type {
  BuyerEmailOutcome,
  BuyerEmailSuppressionReason,
} from '../types/buyer-email-delivery.types';

export class BuyerEmailDelivery {
  constructor(
    public readonly id: string,
    public readonly internalOrderId: string,
    public readonly connectionId: string,
    public readonly templateKey: BuyerEmailTemplate,
    /** What the email is about: the return id for `return-received`, else the order id. */
    public readonly subjectRef: string,
    public readonly outcome: BuyerEmailOutcome,
    public readonly suppressionReason: BuyerEmailSuppressionReason | null,
    public readonly recipient: string | null,
    public readonly createdAt: Date
  ) {}
}
