/**
 * A4 — Send Email Executor (#2361, spec §5.3b A4)
 *
 * *"Send an email"*. Delegates to the shipped `MailerPort` and adds nothing but
 * the merge-field rendering §5.3b specifies.
 *
 * **`MAILER_TOKEN` is bound in both hosts since #3552** (`MailerTransportModule`),
 * so a worker-side firing (the T4 deadline sweep) sends like an api-side one. A
 * process that still resolves no mailer is a misconfigured host: the step then
 * reports a `failed` result rather than crashing the job or skipping quietly, so
 * an operator can tell "this deployment cannot send email" from "the email
 * bounced".
 *
 * **An absent buyer address is `failed`, never `nothing-to-do`.** Under
 * `OL_STORE_PII=false` the snapshot carries no `customerEmail`, so a rule
 * addressed to the buyer can never deliver on that deployment; reporting that as
 * "nothing to do" would read as a decision OpenLinker made rather than a
 * configuration the operator can change.
 *
 * @module libs/core/src/automation/application/services/executors
 * @implements {AutomationActionExecutorPort}
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

import type {
  IBuyerEmailNotificationService,
  IOrderRecordService,
  SendBuyerEmailResult,
} from '@openlinker/core/orders';
import type { IReturnsService } from '@openlinker/core/returns';
import type { IShipmentQueryService } from '@openlinker/core/shipping';
import type { MailerPort } from '@openlinker/core/users';

import {
  formatMergeAmount,
  formatMergeDate,
  renderAutomationTemplate,
} from '../../../domain/domain-services/render-automation-template';
import { availabilityForAction } from '../../../domain/types/automation-action-availability.types';
import type {
  AutomationActionExecutionInput,
  AutomationActionExecutorPort,
} from '../../../domain/ports/automation-action-executor.port';
import { ATTRIBUTION_OPENLINKER } from '../../../domain/types/automation-step-result.types';
import type { AutomationStepResult } from '../../../domain/types/automation-step-result.types';
import { AutomationDelegateResolverService } from '../automation-delegate-resolver.service';

// Both contracts are imported TYPE-ONLY — see the note in the A3 executor: a
// type import erases at build time, so it adds no runtime edge, while binding to
// the real contract makes an upstream signature change a compile error here
// rather than a runtime failure inside a job.

/**
 * Who a send failure is attributed to (#2387) — the mailer, whose words the
 * `report.message` carries verbatim. Not a marketplace: nothing marketplace-side
 * is involved in sending an email.
 */
export const AUTOMATION_MAILER_REPORTER = 'The email sender';

type AutomationMergeContext = Parameters<typeof renderAutomationTemplate>[1];

type OrderRecordRead = Awaited<ReturnType<IOrderRecordService['getOrderRecord']>>;


@Injectable()
export class SendEmailExecutorService implements AutomationActionExecutorPort {
  private readonly logger = new Logger(SendEmailExecutorService.name);

  constructor(private readonly delegates: AutomationDelegateResolverService) {}

  async execute(input: AutomationActionExecutionInput): Promise<AutomationStepResult> {
    const step = { stepIndex: input.stepIndex, action: 'send-email' } as const;
    if (input.action.action !== 'send-email') {
      return {
        ...step,
        status: 'failed',
        detail: 'Step is not a send-email action.',
        report: {
          attributedTo: ATTRIBUTION_OPENLINKER,
          message: 'Step is not a send-email action.',
        },
      };
    }
    const { recipient, subject, body } = input.action;

    const mailer = this.delegates.resolve<MailerPort>({
      barrel: '@openlinker/core/users',
      tokenName: 'MAILER_TOKEN',
    });
    if (!mailer) {
      // The DECLARED reason (#2363), not a second wording of it: `/automations/
      // vocabulary` reports A4 as `partial` with this exact sentence, so what the
      // composer warned about and what the run log says are the same statement.
      const declared = availabilityForAction('send-email').reason;
      // Logged as well as returned. The declared string is a standing fact about
      // the build; this line is the timestamped observation that it just bit, on
      // this rule, in this process — which is what an operator correlates against
      // when they ask why one trigger sends and another does not.
      this.logger.warn(
        `Automation "${input.rule.name}" (${input.rule.id}) step ${input.stepIndex} ` +
          `could not send: no MailerPort is bound in this process.`
      );
      return {
        ...step,
        status: 'failed',
        detail: declared ?? 'No email sender is configured in this process, so no email was sent.',
        // OpenLinker's own refusal, not a re-wording of anyone else's (#2387).
        report: {
          attributedTo: ATTRIBUTION_OPENLINKER,
          message:
            declared ?? 'No email sender is configured in this process, so no email was sent.',
        },
        unavailableReason: declared ?? undefined,
      };
    }

    const orderId = await this.resolveOrderId(input);
    const record = await this.readOrderRecord(input, orderId);

    if (input.action.buyerEmailTemplate !== undefined) {
      return this.sendBuyerEmail(input, orderId, record, step);
    }

    let to: string;
    if (recipient.kind === 'address') {
      to = recipient.address;
    } else {
      const buyerEmail = record?.buyerEmail;
      if (!buyerEmail) {
        return {
          ...step,
          status: 'failed',
          detail:
            'No buyer email is stored for this order, so nothing was sent. Send to a fixed address instead, or enable buyer-detail storage.',
        };
      }
      to = buyerEmail;
    }

    // `{order.source}` is deliberately absent from the resolvable set — see
    // `AUTOMATION_MERGE_FIELDS`. An operator who types it gets it back verbatim,
    // which reads as "not supported" rather than as a fact about their order.
    const context = await this.mergeContext(input, orderId, record);

    try {
      await mailer.sendEmail({
        to,
        subject: renderAutomationTemplate(subject, context),
        text: renderAutomationTemplate(body, context),
      });
      return { ...step, status: 'done', detail: `To ${to}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Automation "${input.rule.name}" (${input.rule.id}) could not send its email to ${to}: ${message}`
      );
      return {
        ...step,
        status: 'failed',
        detail: `Sending the email failed: ${message}`,
        // The mailer's own words, verbatim (#2387).
        report: { attributedTo: AUTOMATION_MAILER_REPORTER, message },
      };
    }
  }

  /**
   * The #3554 buyer-email path: the send goes through the order connection's
   * `config.buyerEmails` opt-in and is recorded on the order timeline. A
   * suppression is `nothing-to-do` - a decision the operator's own connection
   * settings made, with the reason stated - never `failed`.
   */
  private async sendBuyerEmail(
    input: AutomationActionExecutionInput,
    orderId: string | null,
    record: OrderRecordRead,
    step: { stepIndex: number; action: 'send-email' }
  ): Promise<AutomationStepResult> {
    if (input.action.action !== 'send-email' || input.action.buyerEmailTemplate === undefined) {
      return { ...step, status: 'failed', detail: 'Step is not a buyer-email action.' };
    }
    const notifications = this.delegates.resolve<IBuyerEmailNotificationService>({
      barrel: '@openlinker/core/orders',
      tokenName: 'BUYER_EMAIL_NOTIFICATION_SERVICE_TOKEN',
    });
    if (!notifications) {
      const message = 'Buyer emails are not available in this process, so nothing was sent.';
      return {
        ...step,
        status: 'failed',
        detail: message,
        report: { attributedTo: ATTRIBUTION_OPENLINKER, message },
      };
    }
    if (orderId === null || !record) {
      const message = 'The order this email is about could not be read, so nothing was sent.';
      return {
        ...step,
        status: 'failed',
        detail: message,
        report: { attributedTo: ATTRIBUTION_OPENLINKER, message },
      };
    }
    const context = await this.mergeContext(input, orderId, record);
    const result = await notifications.send({
      internalOrderId: orderId,
      connectionId: record.sourceConnectionId,
      templateKey: input.action.buyerEmailTemplate,
      // The firing's own subject: the return for T6, the order otherwise.
      subjectRef: input.facts.subjectId,
      recipient: record.buyerEmail,
      subject: renderAutomationTemplate(input.action.subject, context),
      text: renderAutomationTemplate(input.action.body, context),
    });
    return this.toStepResult(step, result);
  }

  private toStepResult(
    step: { stepIndex: number; action: 'send-email' },
    result: SendBuyerEmailResult
  ): AutomationStepResult {
    switch (result.status) {
      case 'sent':
        return { ...step, status: 'done', detail: 'Sent to the buyer' };
      case 'suppressed':
        return {
          ...step,
          status: 'nothing-to-do',
          detail: `${result.message} Nothing was sent.`,
        };
      case 'bounced':
        return {
          ...step,
          status: 'failed',
          detail: `The buyer's mail server refused the address: ${result.message}`,
          report: { attributedTo: AUTOMATION_MAILER_REPORTER, message: result.message },
        };
      case 'failed':
        return {
          ...step,
          status: 'failed',
          detail: `Sending the email failed: ${result.message}`,
          report: { attributedTo: AUTOMATION_MAILER_REPORTER, message: result.message },
        };
    }
  }

  private async mergeContext(
    input: AutomationActionExecutionInput,
    orderId: string | null,
    record: OrderRecordRead
  ): Promise<AutomationMergeContext> {
    const shipmentTracking = await this.readTrackingNumber(input, orderId);
    return {
      orderReference: orderId ?? input.facts.subjectId,
      orderTotal: formatMergeAmount(input.facts.totalGross, input.facts.currency),
      orderPlacedAt: formatMergeDate(record?.placedAt),
      orderDispatchBy: formatMergeDate(record?.dispatchByAt),
      buyerName: record?.buyerName,
      shipmentTracking,
      holdReason: input.facts.holdReason,
      ruleName: input.rule.name,
    };
  }

  /**
   * The order a firing is about: the subject itself, or for a return subject
   * (T6/T7) the order the return is attributed to. `null` for an orphan return
   * or a read fault - the caller degrades to unrendered fallbacks.
   */
  private async resolveOrderId(input: AutomationActionExecutionInput): Promise<string | null> {
    if (input.facts.subjectKind === 'order') return input.facts.subjectId;
    if (input.facts.subjectKind !== 'return') return null;
    const returns = this.delegates.resolve<IReturnsService>({
      barrel: '@openlinker/core/returns',
      tokenName: 'RETURNS_SERVICE_TOKEN',
    });
    if (!returns) return null;
    try {
      return (await returns.getReturn(input.facts.subjectId))?.internalOrderId ?? null;
    } catch (error) {
      this.logger.warn(
        `Automation "${input.rule.name}" (${input.rule.id}) could not read return ` +
          `${input.facts.subjectId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Best-effort tracking read for `{shipment.tracking}` (#3553). Resolved through
   * the delegate seam, so `automation` takes no `shipping` sibling edge. A
   * missing binding or a failed read renders the field's "not yet" fallback: a
   * parcel with no number yet is a normal state, and a read fault must not fail
   * an email whose other fields are fine.
   *
   * Known trade-off: on a failed read the buyer reads "not yet" even if a
   * number exists. Accepted over blocking the send; the warning below is the
   * operator's trace.
   */
  private async readTrackingNumber(
    input: AutomationActionExecutionInput,
    orderId: string | null
  ): Promise<string | undefined> {
    if (orderId === null) return undefined;
    const shipments = this.delegates.resolve<IShipmentQueryService>({
      barrel: '@openlinker/core/shipping',
      tokenName: 'SHIPMENT_QUERY_SERVICE_TOKEN',
    });
    if (!shipments) return undefined;
    try {
      return (await shipments.getLatestOutboundTrackingNumber(orderId)) ?? undefined;
    } catch (error) {
      this.logger.warn(
        `Automation "${input.rule.name}" (${input.rule.id}) could not read the tracking number of ` +
          `order ${orderId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  /**
   * Best-effort order read for the buyer address and the order-shaped merge
   * fields. A failure degrades to unrendered fallbacks rather than failing the
   * step — an absent `{order.placedAt}` is a worse email, not a wrong action —
   * except on the `buyer` recipient path, where the caller turns a missing
   * address into a reported failure.
   */
  private async readOrderRecord(
    input: AutomationActionExecutionInput,
    orderId: string | null
  ): Promise<OrderRecordRead> {
    if (orderId === null) {
      return null;
    }
    const orders = this.delegates.resolve<IOrderRecordService>({
      barrel: '@openlinker/core/orders',
      tokenName: 'ORDER_RECORD_SERVICE_TOKEN',
    });
    if (!orders) {
      return null;
    }
    try {
      return await orders.getOrderRecord(orderId);
    } catch (error) {
      this.logger.warn(
        `Automation "${input.rule.name}" (${input.rule.id}) could not read order ` +
          `${orderId} for its email: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }
}
