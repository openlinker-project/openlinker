/**
 * Prompt Templates — Query Key Factory
 *
 * Centralised TanStack Query keys so every query hook and every mutation's
 * invalidation agree on the same key shape.
 *
 * @module apps/web/src/features/prompt-templates/api
 */
import type { PromptTemplateChannel, PromptTemplateListFilters } from './prompt-templates.types';

const channelKey = (channel: PromptTemplateChannel | null): string =>
  channel === null ? 'master' : channel;

export const promptTemplatesQueryKeys = {
  all: ['prompt-templates'] as const,
  list: (filters?: PromptTemplateListFilters) =>
    [
      'prompt-templates',
      'list',
      filters?.key ?? 'all',
      filters?.channel ?? 'all',
    ] as const,
  detail: (id: string) => ['prompt-templates', 'detail', id] as const,
  versions: (key: string, channel: PromptTemplateChannel | null) =>
    ['prompt-templates', 'versions', key, channelKey(channel)] as const,
  latest: (key: string, channel: PromptTemplateChannel | null) =>
    ['prompt-templates', 'latest', key, channelKey(channel)] as const,
};
