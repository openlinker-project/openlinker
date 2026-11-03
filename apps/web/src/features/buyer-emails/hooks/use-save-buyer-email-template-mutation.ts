/**
 * Save Buyer Email Template Mutation (#3555)
 *
 * One save, two writes, in this order: the connection's per-template switch
 * and sender (`PATCH /connections/:id`), then the shared wording on the seeded
 * rule (`PUT /automations/:id`). Saving an ENABLED template also activates its
 * rule - the connection opt-in still decides who gets mail, so an active rule
 * sends nothing for a connection that has not opted in. Nothing ever
 * deactivates the rule here: another connection may rely on it.
 *
 * The connection write goes first because it is the one that decides what is
 * sent; if the rule write then fails, the error names it and nothing is
 * rolled back - the sender is saved and the wording is not, and the message
 * says exactly that rather than reading as one failed save.
 *
 * A failure is a {@link BuyerEmailSaveError} naming which write failed and, for
 * a refused sender, which field - so the editor can put the server's sentence
 * under that field instead of only in a toast.
 *
 * `PATCH /connections/:id` replaces `config` wholesale, so the config is
 * RE-READ immediately before the write rather than taken from the page's
 * cache: a cached copy would silently undo any other key changed since the
 * page loaded (the #2016 shallow-spread hazard). A write racing inside the
 * remaining read-to-write gap is still last-write-wins.
 *
 * @module apps/web/src/features/buyer-emails/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { automationQueryKeys, type AutomationRule } from '../../automation';
import { connectionsQueryKeys } from '../../connections';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { BuyerEmailTemplate, BuyerEmailTemplateSettings } from '../api/buyer-emails.types';
import { BUYER_EMAILS_COPY } from '../lib/buyer-emails.copy';
import {
  buyerEmailFieldOfServerMessage,
  type BuyerEmailServerField,
} from '../lib/buyer-email-editor.schema';
import {
  readBuyerEmailsSettings,
  withBuyerEmailsSettings,
  withRuleWording,
  withTemplateSettings,
} from '../lib/buyer-emails-config';

/** Which of the save's two writes failed, and the editor field a refusal names. */
export class BuyerEmailSaveError extends Error {
  readonly stage: 'settings' | 'wording';
  /** The server's own sentence, for showing under {@link field}. */
  readonly serverMessage: string;
  readonly field: BuyerEmailServerField | null;

  constructor(
    message: string,
    stage: 'settings' | 'wording',
    serverMessage: string,
    field: BuyerEmailServerField | null,
  ) {
    super(message);
    this.name = 'BuyerEmailSaveError';
    this.stage = stage;
    this.serverMessage = serverMessage;
    this.field = field;
  }
}

export interface SaveBuyerEmailTemplateInput {
  connectionId: string;
  template: BuyerEmailTemplate;
  settings: BuyerEmailTemplateSettings;
  rule: AutomationRule | null;
  wording: { subject: string; body: string };
}

export function useSaveBuyerEmailTemplateMutation(): UseMutationResult<
  void,
  BuyerEmailSaveError,
  SaveBuyerEmailTemplateInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveBuyerEmailTemplateInput): Promise<void> => {
      try {
        const { config } = await apiClient.connections.getById(input.connectionId);
        const current = readBuyerEmailsSettings(config);
        await apiClient.connections.update(input.connectionId, {
          config: withBuyerEmailsSettings(
            config,
            withTemplateSettings(current, input.template, input.settings)
          ),
        });
      } catch (error) {
        const reason = messageOf(error);
        throw new BuyerEmailSaveError(
          BUYER_EMAILS_COPY.editor.saveSettingsFailed(reason),
          'settings',
          reason,
          buyerEmailFieldOfServerMessage(reason, input.template),
        );
      }
      if (input.rule) {
        try {
          await apiClient.automations.replace(
            input.rule.id,
            withRuleWording(
              input.rule,
              input.wording,
              input.rule.isActive || input.settings.enabled
            )
          );
        } catch (error) {
          const reason = messageOf(error);
          throw new BuyerEmailSaveError(
            BUYER_EMAILS_COPY.editor.saveWordingFailed(reason),
            'wording',
            reason,
            null,
          );
        }
      }
    },
    onSettled: async (_result, _error, input) => {
      await queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all });
      if (input.rule) {
        await queryClient.invalidateQueries({
          queryKey: automationQueryKeys.list(input.rule.trigger),
        });
      }
    },
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
