/**
 * Buyer Email Delivery Repository Port (#3554)
 *
 * Append-only, except that a later bounce report may move a `sent` row to
 * `bounced` (`markBounced`), which is the only transition a delivery has.
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { BuyerEmailTemplate } from '@openlinker/core/identifier-mapping';
import type { BuyerEmailDelivery } from '../entities/buyer-email-delivery.entity';
import type { BuyerEmailSuppressionReason } from '../domain-services/buyer-email-gate.domain-service';
import type { BuyerEmailOutcome } from '../types/buyer-email-delivery.types';

export interface RecordBuyerEmailDeliveryInput {
  internalOrderId: string;
  connectionId: string;
  templateKey: BuyerEmailTemplate;
  subjectRef: string;
  outcome: BuyerEmailOutcome;
  suppressionReason: BuyerEmailSuppressionReason | null;
  recipient: string | null;
}

export interface BuyerEmailDeliveryRepositoryPort {
  record(input: RecordBuyerEmailDeliveryInput): Promise<BuyerEmailDelivery>;
  /** Moves a `sent` row to `bounced`; `false` when no such sent row exists. */
  markBounced(deliveryId: string): Promise<boolean>;
  /**
   * Whether this email was already SENT for this subject - the at-most-once
   * check that keeps a three-parcel return to one "return received" email.
   */
  hasSent(internalOrderId: string, templateKey: BuyerEmailTemplate, subjectRef: string): Promise<boolean>;
  /** Newest first. */
  listByOrder(internalOrderId: string, limit: number): Promise<BuyerEmailDelivery[]>;
}
