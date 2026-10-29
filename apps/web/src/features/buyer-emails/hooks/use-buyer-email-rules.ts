/**
 * Buyer Email Rules Hook (#3555)
 *
 * The seeded automation rule behind each template, one query per trigger
 * (`GET /automations` requires a trigger). A template whose rule cannot be
 * found reads `null`: the editor then saves the switch and sender and says the
 * wording cannot be edited, rather than inventing a rule.
 *
 * @module apps/web/src/features/buyer-emails/hooks
 */
import { useQueries } from '@tanstack/react-query';
import { automationQueryKeys, type AutomationRule } from '../../automation';
import { useApiClient } from '../../../app/api/api-client-provider';
import { BUYER_EMAIL_TEMPLATE_VALUES, type BuyerEmailTemplate } from '../api/buyer-emails.types';
import { BUYER_EMAIL_TEMPLATE_TRIGGER, findTemplateRule } from '../lib/buyer-emails-config';

export interface BuyerEmailRules {
  isLoading: boolean;
  isError: boolean;
  rules: Record<BuyerEmailTemplate, AutomationRule | null>;
}

export function useBuyerEmailRules(): BuyerEmailRules {
  const apiClient = useApiClient();
  const results = useQueries({
    queries: BUYER_EMAIL_TEMPLATE_VALUES.map((template) => {
      const trigger = BUYER_EMAIL_TEMPLATE_TRIGGER[template];
      return {
        queryKey: automationQueryKeys.list(trigger),
        queryFn: () => apiClient.automations.listByTrigger(trigger),
      };
    }),
  });

  const rules = {} as Record<BuyerEmailTemplate, AutomationRule | null>;
  BUYER_EMAIL_TEMPLATE_VALUES.forEach((template, index) => {
    rules[template] = findTemplateRule(results[index]?.data?.items ?? [], template);
  });

  return {
    isLoading: results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
    rules,
  };
}
