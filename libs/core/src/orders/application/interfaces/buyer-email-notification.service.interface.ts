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
import type {
  BuyerEmailSuppressionReason,
  BuyerEmailTestRefusalReason,
} from '../../domain/types/buyer-email-delivery.types';

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

/**
 * A test send from the template editor (#3555): the text the operator is
 * editing, the connection's sender for that template, to ONE address the
 * operator types. Not gated by the opt-in (testing a template before switching
 * it on is the point) and never recorded on an order.
 *
 * The address is not pinned to the actor's own: an administrator may test with
 * a shared mailbox. What keeps that from being an untraceable way to email
 * anyone from the shop's sender is that every send is capped per actor
 * ({@link BUYER_EMAIL_TEST_SEND_LIMIT}) and logged with the actor, the
 * connection, the template and the recipient.
 */
export interface SendBuyerEmailTestInput {
  /** The signed-in user asking for the test. Scopes the limit and the audit line. */
  actorUserId: string;
  connectionId: string;
  templateKey: BuyerEmailTemplate;
  to: string;
  subject: string;
  text: string;
}

export type SendBuyerEmailTestResult =
  | { status: 'sent' }
  | { status: 'refused'; reason: BuyerEmailTestRefusalReason; message: string }
  | { status: 'failed'; message: string };

export interface IBuyerEmailNotificationService {
  send(input: SendBuyerEmailInput): Promise<SendBuyerEmailResult>;
  sendTest(input: SendBuyerEmailTestInput): Promise<SendBuyerEmailTestResult>;
  listForOrder(internalOrderId: string): Promise<BuyerEmailDelivery[]>;
}
