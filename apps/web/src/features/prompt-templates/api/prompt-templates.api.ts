/**
 * Prompt Templates API Client
 *
 * Thin HTTP adapter over the admin-only `/prompt-templates` endpoints.
 * Instantiated by `createApiClient()` and consumed through
 * `useApiClient().promptTemplates`.
 *
 * @module apps/web/src/features/prompt-templates/api
 */
import type {
  CreatePromptTemplateInput,
  PromptTemplate,
  PromptTemplateChannel,
  PromptTemplateListFilters,
  PromptTemplateSummary,
  RenderedPrompt,
  RenderPromptTemplateInput,
  RevertPromptTemplateInput,
  UpdatePromptTemplateInput,
} from './prompt-templates.types';

export interface PromptTemplatesApi {
  list: (filters?: PromptTemplateListFilters) => Promise<PromptTemplateSummary[]>;
  get: (id: string) => Promise<PromptTemplate>;
  getVersions: (
    key: string,
    channel: PromptTemplateChannel | null,
  ) => Promise<PromptTemplate[]>;
  getLatest: (
    key: string,
    channel: PromptTemplateChannel | null,
  ) => Promise<PromptTemplate>;
  create: (input: CreatePromptTemplateInput) => Promise<PromptTemplate>;
  update: (id: string, input: UpdatePromptTemplateInput) => Promise<PromptTemplate>;
  publish: (id: string) => Promise<PromptTemplate>;
  archive: (id: string, opts?: { force?: boolean }) => Promise<PromptTemplate>;
  revert: (input: RevertPromptTemplateInput) => Promise<PromptTemplate>;
  render: (id: string, input: RenderPromptTemplateInput) => Promise<RenderedPrompt>;
  remove: (id: string) => Promise<void>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function channelToQuery(channel: PromptTemplateChannel | null): string {
  return channel === null ? 'master' : channel;
}

function buildListQuery(filters?: PromptTemplateListFilters): string {
  const params = new URLSearchParams();
  if (filters?.key !== undefined && filters.key !== '') {
    params.set('key', filters.key);
  }
  if (filters?.channel !== undefined) {
    params.set('channel', filters.channel);
  }
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createPromptTemplatesApi(request: ApiRequest): PromptTemplatesApi {
  return {
    list(filters): Promise<PromptTemplateSummary[]> {
      return request<PromptTemplateSummary[]>(`/prompt-templates${buildListQuery(filters)}`);
    },
    get(id): Promise<PromptTemplate> {
      return request<PromptTemplate>(`/prompt-templates/${id}`);
    },
    getVersions(key, channel): Promise<PromptTemplate[]> {
      const params = new URLSearchParams({ key, channel: channelToQuery(channel) });
      return request<PromptTemplate[]>(`/prompt-templates/versions?${params.toString()}`);
    },
    getLatest(key, channel): Promise<PromptTemplate> {
      const params = new URLSearchParams({ key, channel: channelToQuery(channel) });
      return request<PromptTemplate>(`/prompt-templates/latest?${params.toString()}`);
    },
    create(input): Promise<PromptTemplate> {
      return request<PromptTemplate>(`/prompt-templates`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    update(id, input): Promise<PromptTemplate> {
      return request<PromptTemplate>(`/prompt-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
    },
    publish(id): Promise<PromptTemplate> {
      return request<PromptTemplate>(`/prompt-templates/${id}/publish`, {
        method: 'POST',
      });
    },
    archive(id, opts): Promise<PromptTemplate> {
      return request<PromptTemplate>(`/prompt-templates/${id}/archive`, {
        method: 'POST',
        body: JSON.stringify(opts ?? {}),
      });
    },
    revert(input): Promise<PromptTemplate> {
      return request<PromptTemplate>(`/prompt-templates/revert`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    render(id, input): Promise<RenderedPrompt> {
      return request<RenderedPrompt>(`/prompt-templates/${id}/render`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async remove(id): Promise<void> {
      await request<void>(`/prompt-templates/${id}`, { method: 'DELETE' });
    },
  };
}
