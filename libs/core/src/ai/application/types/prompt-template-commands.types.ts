/**
 * Prompt Template Commands & Queries
 *
 * Input / output shapes for the `IPromptTemplateService` surface. Kept
 * separate from the domain types so the wire contract of the service can
 * evolve without touching the entity or port.
 *
 * @module libs/core/src/ai/application/types
 */
import type {
  PromptTemplateChannel,
  PromptTemplateVariable,
} from '../../domain/types/prompt-template.types';

export interface CreateDraftCommand {
  key: string;
  channel: PromptTemplateChannel | null;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: readonly PromptTemplateVariable[];
  createdBy: string | null;
}

export interface UpdateDraftCommand {
  systemPrompt?: string;
  userPromptTemplate?: string;
  variables?: readonly PromptTemplateVariable[];
}

export interface RevertToCommand {
  key: string;
  channel: PromptTemplateChannel | null;
  version: number;
  createdBy: string | null;
}

export interface RenderCommand {
  key: string;
  channel: PromptTemplateChannel | null;
  values: Record<string, unknown>;
}

export interface RenderedPrompt {
  templateId: string;
  version: number;
  systemPrompt: string;
  userPrompt: string;
}
