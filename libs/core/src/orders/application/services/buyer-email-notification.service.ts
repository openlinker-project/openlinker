/**
 * Buyer Email Notification Service (#3554)
 *
 * gate -> mailer -> record. The gate (`decideBuyerEmail`) reads the order's
 * connection opt-in; a refusal is recorded as `suppressed` with its reason, so
 * the timeline can say why the buyer got nothing. The channel is read from
 * capabilities, never `platformType`: `OfferManager` without `ProductMaster`
 * is a marketplace (a shop such as WooCommerce carries both).
 *
 * At most once per subject is a CLAIM taken before the mailer runs (a `pending`
 * row under a partial unique index), never a read: a return received in two
 * parcels on two lines fires twice concurrently, and no lock serialises the
 * two. A send that reached no mail server releases its claim so a later firing
 * may try again; one that did settles it to `sent` or `bounced`.
 *
 * The mailer is resolved lazily through `ModuleRef`, as `OrderDocumentEmailService`
 * does, so a host with no `MAILER_TOKEN` gets a reported failure, not a boot error.
 * A suppression row is best-effort: a failed write is logged, never turned into
 * a failed step.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IBuyerEmailNotificationService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Logger } from '@openlinker/shared/logging';
import { getEnvBoolean } from '@openlinker/shared/config';
import {
  CONNECTION_PORT_TOKEN,
  buyerEmailChannelKindOf,
  isSingleEmailAddress,
  readBuyerEmailTemplateSender,
  type Connection,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import { MAILER_TOKEN, type MailerPort } from '@openlinker/core/users';
import {
  BUYER_EMAIL_SUPPRESSION_MESSAGE,
  decideBuyerEmail,
} from '../../domain/domain-services/buyer-email-gate.domain-service';
import type { BuyerEmailDelivery } from '../../domain/entities/buyer-email-delivery.entity';
import {
  BuyerEmailDeliveryRepositoryPort,
  type RecordBuyerEmailSuppressionInput,
} from '../../domain/ports/buyer-email-delivery-repository.port';
import {
  isRecipientRejectedError,
  type BuyerEmailSuppressionReason,
} from '../../domain/types/buyer-email-delivery.types';
import { BUYER_EMAIL_DELIVERY_REPOSITORY_TOKEN } from '../../orders.tokens';
import type {
  IBuyerEmailNotificationService,
  SendBuyerEmailInput,
  SendBuyerEmailResult,
  SendBuyerEmailTestInput,
  SendBuyerEmailTestResult,
} from '../interfaces/buyer-email-notification.service.interface';

/** The timeline shows recent sends; an order is not emailed hundreds of times. */
export const BUYER_EMAIL_LIST_LIMIT = 50;

@Injectable()
export class BuyerEmailNotificationService implements IBuyerEmailNotificationService {
  private readonly logger = new Logger(BuyerEmailNotificationService.name);

  constructor(
    @Inject(BUYER_EMAIL_DELIVERY_REPOSITORY_TOKEN)
    private readonly repository: BuyerEmailDeliveryRepositoryPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    private readonly moduleRef: ModuleRef
  ) {}

  async send(input: SendBuyerEmailInput): Promise<SendBuyerEmailResult> {
    let connection: Connection;
    try {
      connection = await this.connections.get(input.connectionId);
    } catch (error) {
      return {
        status: 'failed',
        message: `The order's connection could not be read: ${describe(error)}`,
      };
    }

    const decision = decideBuyerEmail({
      connectionConfig: connection.config,
      templateKey: input.templateKey,
      buyerAddress: input.recipient,
      channelKind: buyerEmailChannelKindOf(connection.enabledCapabilities),
    });
    const base = {
      internalOrderId: input.internalOrderId,
      connectionId: input.connectionId,
      templateKey: input.templateKey,
      subjectRef: input.subjectRef,
    };

    if (decision.decision === 'suppressed') {
      return this.suppress(base, decision.reason, input.recipient ?? null);
    }

    const mailer = this.resolveMailer();
    if (mailer === null) {
      return { status: 'failed', message: 'No email sender is configured in this process.' };
    }

    // The gate refuses an empty address, so `recipient` is a string here.
    const to = input.recipient as string;
    let claim: BuyerEmailDelivery | null;
    try {
      claim = await this.repository.claimSend({ ...base, recipient: this.storable(to) });
    } catch (error) {
      return { status: 'failed', message: `The send could not be claimed: ${describe(error)}` };
    }
    if (claim === null) {
      return this.suppress(base, 'already-sent', to);
    }

    try {
      await mailer.sendEmail({
        to,
        subject: input.subject,
        text: input.text,
        ...(decision.fromAddress ? { from: decision.fromAddress } : {}),
        ...(decision.replyTo ? { replyTo: decision.replyTo } : {}),
      });
    } catch (error) {
      if (isRecipientRejectedError(error)) {
        await this.settle(claim.id, 'bounced');
        return { status: 'bounced', message: describe(error) };
      }
      // Nothing reached a mail server: give the slot back so a later firing may send.
      await this.release(claim.id);
      return { status: 'failed', message: describe(error) };
    }
    await this.settle(claim.id, 'sent');
    return { status: 'sent', deliveryId: claim.id };
  }

  async sendTest(input: SendBuyerEmailTestInput): Promise<SendBuyerEmailTestResult> {
    if (!isSingleEmailAddress(input.to)) {
      return {
        status: 'refused',
        reason: 'invalid-address',
        message: 'Enter one email address to send the test to.',
      };
    }
    let connection: Connection;
    try {
      connection = await this.connections.get(input.connectionId);
    } catch {
      return {
        status: 'refused',
        reason: 'connection-not-found',
        message: 'The connection could not be found.',
      };
    }
    // Not `readBuyerEmailsConfig`: that reads an opted-out connection as having
    // no templates, and a test send is what an operator does before opting in.
    const sender = readBuyerEmailTemplateSender(connection.config, input.templateKey);
    const mailer = this.resolveMailer();
    if (mailer === null) {
      return { status: 'failed', message: 'No email sender is configured in this process.' };
    }
    try {
      await mailer.sendEmail({
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(sender.fromAddress ? { from: sender.fromAddress } : {}),
        ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
      });
      return { status: 'sent' };
    } catch (error) {
      // The mailer's words go to the log only: they can carry a host or a
      // credential fragment, which a browser must not see.
      this.logger.warn(`Buyer email test send failed: ${describe(error)}`);
      return {
        status: 'failed',
        message: isRecipientRejectedError(error)
          ? 'The mail server refused this address.'
          : 'The email could not be sent. Check the mail settings.',
      };
    }
  }

  listForOrder(internalOrderId: string): Promise<BuyerEmailDelivery[]> {
    return this.repository.listByOrder(internalOrderId, BUYER_EMAIL_LIST_LIMIT);
  }

  private async suppress(
    base: Omit<RecordBuyerEmailSuppressionInput, 'suppressionReason' | 'recipient'>,
    reason: BuyerEmailSuppressionReason,
    recipient: string | null
  ): Promise<SendBuyerEmailResult> {
    try {
      await this.repository.recordSuppression({
        ...base,
        suppressionReason: reason,
        recipient: this.storable(recipient),
      });
    } catch (error) {
      this.logger.error(
        `Could not record a suppressed buyer email: order=${base.internalOrderId} ` +
          `template=${base.templateKey} reason=${reason}: ${describe(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    }
    return { status: 'suppressed', reason, message: BUYER_EMAIL_SUPPRESSION_MESSAGE[reason] };
  }

  /**
   * The email has already gone (or bounced), so a failed settle is logged and
   * never turned into a failed send: the claim stays `pending`, which still
   * holds the slot, the safe direction.
   */
  private async settle(deliveryId: string, outcome: 'sent' | 'bounced'): Promise<void> {
    try {
      await this.repository.settleClaim(deliveryId, outcome);
    } catch (error) {
      this.logger.error(
        `Could not settle buyer email claim ${deliveryId} as ${outcome}: ${describe(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /** A release that fails leaves the slot held: the buyer may miss it, never get it twice. */
  private async release(deliveryId: string): Promise<void> {
    try {
      await this.repository.releaseClaim(deliveryId);
    } catch (error) {
      this.logger.warn(`Could not release buyer email claim ${deliveryId}: ${describe(error)}`);
    }
  }

  private storable(recipient: string | null): string | null {
    return getEnvBoolean('OL_STORE_PII', true) ? recipient : null;
  }

  private resolveMailer(): MailerPort | null {
    try {
      return this.moduleRef.get<MailerPort>(MAILER_TOKEN, { strict: false });
    } catch {
      return null;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
