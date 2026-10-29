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
 * rolled back.
 *
 * @module apps/web/src/features/buyer-emails/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { automationQueryKeys, type AutomationRule } from '../../automation';
import { connectionsQueryKeys } from '../../connections';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { BuyerEmailTemplate, BuyerEmailTemplateSettings } from '../api/buyer-emails.types';
import {
  readBuyerEmailsSettings,
  withBuyerEmailsSettings,
  withRuleWording,
  withTemplateSettings,
} from '../lib/buyer-emails-config';

export interface SaveBuyerEmailTemplateInput {
  connectionId: string;
  connectionConfig: Record<string, unknown>;
  template: BuyerEmailTemplate;
  settings: BuyerEmailTemplateSettings;
  rule: AutomationRule | null;
  wording: { subject: string; body: string };
}

export function useSaveBuyerEmailTemplateMutation(): UseMutationResult<
  void,
  Error,
  SaveBuyerEmailTemplateInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveBuyerEmailTemplateInput): Promise<void> => {
      const current = readBuyerEmailsSettings(input.connectionConfig);
      await apiClient.connections.update(input.connectionId, {
        config: withBuyerEmailsSettings(
          input.connectionConfig,
          withTemplateSettings(current, input.template, input.settings),
        ),
      });
      if (input.rule) {
        await apiClient.automations.replace(
          input.rule.id,
          withRuleWording(input.rule, input.wording, input.rule.isActive || input.settings.enabled),
        );
      }
    },
    onSettled: async (_result, _error, input) => {
      await queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all });
      if (input.rule) {
        await queryClient.invalidateQueries({ queryKey: automationQueryKeys.list(input.rule.trigger) });
      }
    },
  });
}
