/**
 * Automation Query Keys (#2364)
 *
 * @module apps/web/src/features/automation/api
 */
import type { AutomationTrigger } from './automation.types';

export const automationQueryKeys = {
  all: ['automations'] as const,
  vocabulary: () => ['automations', 'vocabulary'] as const,
  summary: () => ['automations', 'summary'] as const,
  list: (trigger: AutomationTrigger) => ['automations', 'list', trigger] as const,
  detail: (ruleId: string) => ['automations', 'detail', ruleId] as const,
  runs: (ruleId: string) => ['automations', 'runs', ruleId] as const,
};
