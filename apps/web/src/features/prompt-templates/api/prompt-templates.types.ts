/**
 * Prompt Templates — Frontend Types
 *
 * Hand-written wire types mirroring the backend DTOs in
 * `apps/api/src/ai/http/dto/*`. Kept FE-local so the web bundle stays
 * independent of NestJS / core imports.
 *
 * @module apps/web/src/features/prompt-templates/api
 */

export const PromptTemplateStateValues = ['draft', 'published', 'archived'] as const;
export type PromptTemplateState = (typeof PromptTemplateStateValues)[number];

export const PromptTemplateChannelValues = ['prestashop', 'allegro'] as const;
export type PromptTemplateChannel = (typeof PromptTemplateChannelValues)[number];

export const PromptTemplateVariableTypeValues = ['string', 'number', 'object', 'array'] as const;
export type PromptTemplateVariableType = (typeof PromptTemplateVariableTypeValues)[number];

export interface PromptTemplateVariable {
  name: string;
  type: PromptTemplateVariableType;
  required: boolean;
  description?: string;
}

export interface PromptTemplate {
  id: string;
  key: string;
  channel: PromptTemplateChannel | null;
  version: number;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: PromptTemplateVariable[];
  state: PromptTemplateState;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplateSummary {
  key: string;
  channel: PromptTemplateChannel | null;
  latestVersion: number;
  latestId: string;
  latestState: PromptTemplateState;
  publishedVersion: number | null;
  publishedId: string | null;
  hasDraft: boolean;
  updatedAt: string;
}

export interface RenderedPrompt {
  templateId: string;
  version: number;
  systemPrompt: string;
  userPrompt: string;
}

export interface PromptTemplateListFilters {
  key?: string;
  /** `'master'` → NULL channel filter. Omit for no filter. */
  channel?: PromptTemplateChannel | 'master';
}

export interface CreatePromptTemplateInput {
  key: string;
  channel: PromptTemplateChannel | null;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: PromptTemplateVariable[];
}

export interface UpdatePromptTemplateInput {
  systemPrompt?: string;
  userPromptTemplate?: string;
  variables?: PromptTemplateVariable[];
}

export interface RevertPromptTemplateInput {
  key: string;
  channel: PromptTemplateChannel | null;
  version: number;
}

export interface RenderPromptTemplateInput {
  values: Record<string, unknown>;
}

export interface VersionsQuery {
  key: string;
  channel: PromptTemplateChannel | null;
}
