/**
 * Prompt Template — Domain Entity
 *
 * Versioned, stateful template row for an LLM prompt. Composed of a
 * `systemPrompt` + `userPromptTemplate` pair plus declared variables for the
 * render helper. `channel` is nullable — a NULL channel means "master"
 * (generic) template; a non-null channel scopes the template to a specific
 * marketplace / shop.
 *
 * Plain class, no decorators. ORM mapping lives in
 * `infrastructure/persistence/entities/prompt-template.orm-entity.ts`.
 *
 * @module libs/core/src/ai/domain/entities
 */
import type {
  PromptTemplateChannel,
  PromptTemplateState,
  PromptTemplateVariable,
} from '../types/prompt-template.types';

export class PromptTemplate {
  constructor(
    public readonly id: string,
    public readonly key: string,
    /** `null` channel = master (generic). Non-null scopes the template to that channel. */
    public readonly channel: PromptTemplateChannel | null,
    public readonly version: number,
    public readonly systemPrompt: string,
    public readonly userPromptTemplate: string,
    public readonly variables: readonly PromptTemplateVariable[],
    public readonly state: PromptTemplateState,
    public readonly publishedAt: Date | null,
    public readonly createdBy: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
