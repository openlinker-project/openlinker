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
 * A failure is a {@link BuyerEmailSaveError} naming which of the two writes
 * failed; the editor shows its message as the save error. A `wording` failure
 * means the sender WAS saved, which the editor needs to know.
 *
 * `PATCH /connections/:id` replaces `config` wholesale, so the config is
 * RE-READ immediately before the write rather than taken from the page's
 * cache: a cached copy would silently undo any other key changed since the
 * page loaded (the #2016 shallow-spread hazard). The rule is re-read the same
 * way, because `PUT /automations/:id` also replaces the whole definition and
 * the automation composer edits the same rule. A write racing inside the
 * remaining read-to-write gap is still last-write-wins.
 *
 * @module apps/web/src/features/buyer-emails/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { automationQueryKeys, type AutomationRule } from '../../automation';
import { connectionsQueryKeys } from '../../connections';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { BuyerEmailTemplate, BuyerEmailTemplateSettings } from '../api/buyer-emails.types';
import { getMessages, interpolate } from '../../../shared/i18n';
import {
  readBuyerEmailsSettings,
  withBuyerEmailsSettings,
  withRuleWording,
  withTemplateSettings,
} from '../lib/buyer-emails-config';

/** Which of the save's two writes failed, so the message can say what was kept. */
export class BuyerEmailSaveError extends Error {
  readonly stage: 'settings' | 'wording';

  constructor(message: string, stage: 'settings' | 'wording') {
    super(message);
    this.name = 'BuyerEmailSaveError';
    this.stage = stage;
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
        throw new BuyerEmailSaveError(
          interpolate(getMessages('buyer-emails').editor.saveSettingsFailed, {
            reason: describeApiError(error, 'buyer-emails'),
          }),
          'settings',
        );
      }
      if (input.rule) {
        try {
          // Re-read for the same reason as the config above: `PUT` replaces the
          // whole rule, so building it from the copy the editor loaded would undo
          // any edit made in the automation composer since - including switching
          // the rule off, which a stale `isActive` would silently reverse.
          const fresh = await apiClient.automations.get(input.rule.id);
          await apiClient.automations.replace(
            fresh.id,
            withRuleWording(fresh, input.wording, fresh.isActive || input.settings.enabled)
          );
        } catch (error) {
          throw new BuyerEmailSaveError(
            interpolate(getMessages('buyer-emails').editor.saveWordingFailed, {
              reason: describeApiError(error, 'buyer-emails'),
            }),
            'wording',
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
