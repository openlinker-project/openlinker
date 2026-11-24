/**
 * Buyer Email Rules Hook (#3555)
 *
 * The seeded automation rule behind each template, one query per trigger
 * (`GET /automations` requires a trigger). Pass `only` to read one template's
 * trigger - the editor needs one rule, the list needs all four. A template
 * that was not read reads `null` like a missing one, so a caller asking for
 * one template must read only that template's entry. A template whose rule cannot be
 * found reads `null`: the editor then saves the switch and sender and says the
 * wording cannot be edited, rather than inventing a rule. A FAILED read also
 * leaves `rules` at `null`, so a caller must check `isError` first - absence
 * and failure are different statements to an operator.
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
  /** Re-runs every rule query; offered as the retry when the read failed. */
  refetch: () => void;
  rules: Record<BuyerEmailTemplate, AutomationRule | null>;
}

export function useBuyerEmailRules(only?: BuyerEmailTemplate): BuyerEmailRules {
  const apiClient = useApiClient();
  const templates: readonly BuyerEmailTemplate[] = only ? [only] : BUYER_EMAIL_TEMPLATE_VALUES;
  const results = useQueries({
    queries: templates.map((template) => {
      const trigger = BUYER_EMAIL_TEMPLATE_TRIGGER[template];
      return {
        queryKey: automationQueryKeys.list(trigger),
        queryFn: () => apiClient.automations.listByTrigger(trigger),
      };
    }),
  });

  const rules = Object.fromEntries(
    BUYER_EMAIL_TEMPLATE_VALUES.map((template) => [template, null]),
  ) as Record<BuyerEmailTemplate, AutomationRule | null>;
  templates.forEach((template, index) => {
    rules[template] = findTemplateRule(results[index]?.data?.items ?? [], template);
  });

  return {
    isLoading: results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
    refetch: (): void => {
      results.forEach((result) => void result.refetch());
    },
    rules,
  };
}
