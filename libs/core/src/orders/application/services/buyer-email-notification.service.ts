/**
 * Buyer Email Notification Service (#3554)
 *
 * gate -> mailer -> record. The gate (`decideBuyerEmail`) reads the order's
 * connection opt-in; a refusal is recorded as `suppressed` with its reason, so
 * the timeline can say why the buyer got nothing. The channel is read from
 * capabilities, never `platformType`: `OfferManager` without `ProductMaster`
 * is a marketplace (a shop such as WooCommerce carries both).
 *
 * The mailer is resolved lazily through `ModuleRef`, as `OrderDocumentEmailService`
 * does, so a host with no `MAILER_TOKEN` gets a reported failure, not a boot error.
 * Recording is best-effort: the email has already gone, so a failed row write is
 * logged and never turned into a failed send (which would invite a resend).
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
  type Connection,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import { MAILER_TOKEN, type MailerPort } from '@openlinker/core/users';
import {
  BUYER_EMAIL_SUPPRESSION_MESSAGE,
  decideBuyerEmail,
  type BuyerEmailChannelKind,
} from '../../domain/domain-services/buyer-email-gate.domain-service';
import type { BuyerEmailDelivery } from '../../domain/entities/buyer-email-delivery.entity';
import {
  BuyerEmailDeliveryRepositoryPort,
  type RecordBuyerEmailDeliveryInput,
} from '../../domain/ports/buyer-email-delivery-repository.port';
import { isRecipientRejectedError } from '../../domain/types/buyer-email-delivery.types';
import { BUYER_EMAIL_DELIVERY_REPOSITORY_TOKEN } from '../../orders.tokens';
import type {
  IBuyerEmailNotificationService,
  SendBuyerEmailInput,
  SendBuyerEmailResult,
} from '../interfaces/buyer-email-notification.service.interface';

/** The timeline shows recent sends; an order is not emailed hundreds of times. */
export const BUYER_EMAIL_LIST_LIMIT = 50;

export function channelKindOf(capabilities: readonly string[]): BuyerEmailChannelKind {
  return capabilities.includes('OfferManager') && !capabilities.includes('ProductMaster')
    ? 'marketplace'
    : 'shop';
}

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
      channelKind: channelKindOf(connection.enabledCapabilities),
    });
    const base = {
      internalOrderId: input.internalOrderId,
      connectionId: input.connectionId,
      templateKey: input.templateKey,
      subjectRef: input.subjectRef,
    };

    if (decision.decision === 'suppressed') {
      await this.record({
        ...base,
        outcome: 'suppressed',
        suppressionReason: decision.reason,
        recipient: input.recipient ?? null,
      });
      return {
        status: 'suppressed',
        reason: decision.reason,
        message: BUYER_EMAIL_SUPPRESSION_MESSAGE[decision.reason],
      };
    }

    // At most once per subject: a three-parcel return fires T6 three times and a
    // cancelled-then-redispatched order enters `shipped` twice, but the buyer
    // gets one email. A check before the send, not a constraint: two concurrent
    // firings for one subject are already serialised by their write sites.
    if (await this.repository.hasSent(input.internalOrderId, input.templateKey, input.subjectRef)) {
      await this.record({
        ...base,
        outcome: 'suppressed',
        suppressionReason: 'already-sent',
        recipient: input.recipient ?? null,
      });
      return {
        status: 'suppressed',
        reason: 'already-sent',
        message: BUYER_EMAIL_SUPPRESSION_MESSAGE['already-sent'],
      };
    }

    const mailer = this.resolveMailer();
    if (mailer === null) {
      return { status: 'failed', message: 'No email sender is configured in this process.' };
    }
    // The gate refuses an empty address, so `recipient` is a string here.
    const to = input.recipient as string;
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
        await this.record({ ...base, outcome: 'bounced', suppressionReason: null, recipient: to });
        return { status: 'bounced', message: describe(error) };
      }
      return { status: 'failed', message: describe(error) };
    }
    const delivery = await this.record({
      ...base,
      outcome: 'sent',
      suppressionReason: null,
      recipient: to,
    });
    return { status: 'sent', deliveryId: delivery?.id ?? null };
  }

  recordBounce(deliveryId: string): Promise<boolean> {
    return this.repository.markBounced(deliveryId);
  }

  listForOrder(internalOrderId: string): Promise<BuyerEmailDelivery[]> {
    return this.repository.listByOrder(internalOrderId, BUYER_EMAIL_LIST_LIMIT);
  }

  private async record(input: RecordBuyerEmailDeliveryInput): Promise<BuyerEmailDelivery | null> {
    try {
      return await this.repository.record({
        ...input,
        recipient: getEnvBoolean('OL_STORE_PII', true) ? input.recipient : null,
      });
    } catch (error) {
      this.logger.error(
        `Could not record a buyer email delivery: order=${input.internalOrderId} ` +
          `template=${input.templateKey} outcome=${input.outcome}: ${describe(error)}`,
        error instanceof Error ? error.stack : undefined
      );
      return null;
    }
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
