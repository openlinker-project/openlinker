/**
 * A4 — Send Email Executor (#2361, spec §5.3b A4)
 *
 * *"Send an email"*. Delegates to the shipped `MailerPort` and adds nothing but
 * the merge-field rendering §5.3b specifies.
 *
 * **`MAILER_TOKEN` is bound only in `apps/api` today**, and automation fires
 * from the WORKER (the T4 deadline sweep, and T5 from its write site). So in the
 * worker this step reports a `failed` result naming the missing binding rather
 * than crashing the job or skipping quietly — an operator must be able to tell
 * "this deployment cannot send email" from "the email bounced". Binding a mailer
 * worker-side means relocating `DbBackedMailerAdapter` out of `apps/api/src/auth/`
 * to a host-shared home, which is an app-composition change rather than a line
 * in this slice.
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

import type { IOrderRecordService } from '@openlinker/core/orders';
import type { MailerPort } from '@openlinker/core/users';

import { renderAutomationTemplate } from '../../../domain/domain-services/render-automation-template';
import type {
  AutomationActionExecutionInput,
  AutomationActionExecutorPort,
} from '../../../domain/ports/automation-action-executor.port';
import type { AutomationStepResult } from '../../../domain/types/automation-step-result.types';
import { AutomationDelegateResolverService } from '../automation-delegate-resolver.service';

// Both contracts are imported TYPE-ONLY — see the note in the A3 executor: a
// type import erases at build time, so it adds no runtime edge, while binding to
// the real contract makes an upstream signature change a compile error here
// rather than a runtime failure inside a job.

@Injectable()
export class SendEmailExecutorService implements AutomationActionExecutorPort {
  private readonly logger = new Logger(SendEmailExecutorService.name);

  constructor(private readonly delegates: AutomationDelegateResolverService) {}

  async execute(input: AutomationActionExecutionInput): Promise<AutomationStepResult> {
    const step = { stepIndex: input.stepIndex, action: 'send-email' } as const;
    if (input.action.action !== 'send-email') {
      return { ...step, status: 'failed', detail: 'Step is not a send-email action.' };
    }
    const { recipient, subject, body } = input.action;

    const mailer = this.delegates.resolve<MailerPort>({
      barrel: '@openlinker/core/users',
      tokenName: 'MAILER_TOKEN',
    });
    if (!mailer) {
      return {
        ...step,
        status: 'failed',
        detail:
          'No email sender is configured in this process, so no email was sent. Automation emails currently require the API process.',
      };
    }

    const record = await this.readOrderRecord(input);

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

    // `{order.source}` / `{buyer.name}` / `{shipment.tracking}` are deliberately
    // absent from the resolvable set — see `AUTOMATION_MERGE_FIELDS`. An operator
    // who types one gets it back verbatim, which reads as "not supported" rather
    // than as a fact about their order.
    const context = {
      orderReference: input.facts.subjectId,
      orderTotal: this.formatTotal(input),
      orderPlacedAt: record?.placedAt?.toISOString(),
      orderDispatchBy: record?.dispatchByAt?.toISOString(),
      holdReason: input.facts.holdReason,
      ruleName: input.rule.name,
    };

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
        `Automation "${input.rule.name}" (${input.rule.id}) could not send its email to ${to}: ${message}`,
      );
      return { ...step, status: 'failed', detail: `Sending the email failed: ${message}` };
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
  ): Promise<Awaited<ReturnType<IOrderRecordService['getOrderRecord']>>> {
    if (input.facts.subjectKind !== 'order') {
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
      return await orders.getOrderRecord(input.facts.subjectId);
    } catch (error) {
      this.logger.warn(
        `Automation "${input.rule.name}" (${input.rule.id}) could not read order ` +
          `${input.facts.subjectId} for its email: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** `{order.total}` — the gross total with its currency, per §5.3b. */
  private formatTotal(input: AutomationActionExecutionInput): string | undefined {
    const { totalGross, currency } = input.facts;
    if (totalGross === undefined) return undefined;
    return currency === undefined ? String(totalGross) : `${totalGross} ${currency}`;
  }
}
