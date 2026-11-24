/**
 * Buyer Email Delivery Repository Port (#3554)
 *
 * A suppression is appended as it is decided. A send is CLAIMED first: a
 * `pending` row taken under a partial unique index on the subject, so of two
 * concurrent firings for one subject exactly one gets to send (a return
 * received in two parcels on two lines is not serialised by any lock). The
 * claim is then settled to `sent` / `bounced`, or released when nothing
 * reached a mail server.
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { BuyerEmailTemplate } from '@openlinker/core/identifier-mapping';
import type { BuyerEmailDelivery } from '../entities/buyer-email-delivery.entity';
import type { BuyerEmailSuppressionReason } from '../types/buyer-email-delivery.types';

interface BuyerEmailSubject {
  internalOrderId: string;
  connectionId: string;
  templateKey: BuyerEmailTemplate;
  subjectRef: string;
}

export interface RecordBuyerEmailSuppressionInput extends BuyerEmailSubject {
  suppressionReason: BuyerEmailSuppressionReason;
  recipient: string | null;
}

export interface ClaimBuyerEmailSendInput extends BuyerEmailSubject {
  recipient: string | null;
}

export interface BuyerEmailDeliveryRepositoryPort {
  recordSuppression(input: RecordBuyerEmailSuppressionInput): Promise<BuyerEmailDelivery>;
  /**
   * Take the subject's send slot as a `pending` row. `null` when the slot is
   * already held by a `pending` or `sent` row - the at-most-once answer that
   * keeps a three-parcel return to one "return received" email.
   */
  claimSend(input: ClaimBuyerEmailSendInput): Promise<BuyerEmailDelivery | null>;
  /** Settle a claim to what the mail server answered. */
  settleClaim(deliveryId: string, outcome: 'sent' | 'bounced'): Promise<void>;
  /** Give the slot back: nothing reached a mail server, so a later firing may send. */
  releaseClaim(deliveryId: string): Promise<void>;
  /** Newest first. */
  listByOrder(internalOrderId: string, limit: number): Promise<BuyerEmailDelivery[]>;
}
