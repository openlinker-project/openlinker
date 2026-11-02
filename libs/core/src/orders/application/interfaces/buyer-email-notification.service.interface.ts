/**
 * Buyer Email Notification Service Interface (#3554)
 *
 * Sends one automatic transactional email to an order's buyer, only when the
 * order's connection opted in to that template, and records every attempt that
 * reaches a decision (sent / suppressed / bounced) for the order timeline.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { BuyerEmailTemplate } from '@openlinker/core/identifier-mapping';
import type { BuyerEmailDelivery } from '../../domain/entities/buyer-email-delivery.entity';
import type { BuyerEmailSuppressionReason } from '../../domain/types/buyer-email-delivery.types';

export interface SendBuyerEmailInput {
  internalOrderId: string;
  /** The connection the order came from; its `config.buyerEmails` decides. */
  connectionId: string;
  templateKey: BuyerEmailTemplate;
  /**
   * What the email is about, for the at-most-once check: the return id for
   * `return-received`, the order id otherwise.
   */
  subjectRef: string;
  /** The buyer's address, or absent when none is stored. */
  recipient: string | null | undefined;
  subject: string;
  text: string;
}

/**
 * `failed` means nothing reached a recipient's server and nothing was recorded:
 * the connection could not be read, no mailer is bound, the send could not be
 * claimed, or the transport was unreachable (its claim is then released). It is the caller's to report (an automation step marks itself
 * failed).
 */
export type SendBuyerEmailResult =
  | { status: 'sent'; deliveryId: string | null }
  | { status: 'suppressed'; reason: BuyerEmailSuppressionReason; message: string }
  | { status: 'bounced'; message: string }
  | { status: 'failed'; message: string };

export interface IBuyerEmailNotificationService {
  send(input: SendBuyerEmailInput): Promise<SendBuyerEmailResult>;
  listForOrder(internalOrderId: string): Promise<BuyerEmailDelivery[]>;
}
