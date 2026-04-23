/**
 * Prompt Template Service Interface
 *
 * Application-layer contract for the prompt-template CRUD + publish +
 * revert + render lifecycle. Implemented by `PromptTemplateService` and
 * consumed by the `PromptTemplatesController` and (eventually) the
 * `ContentSuggestionService` in #342.
 *
 * @module libs/core/src/ai/application/services
 */
import type { PromptTemplate } from '../../domain/entities/prompt-template.entity';
import type {
  PromptTemplateListFilters,
  PromptTemplateSummary,
} from '../../domain/ports/prompt-template-repository.port';
import type { PromptTemplateChannel } from '../../domain/types/prompt-template.types';
import type {
  CreateDraftCommand,
  RenderCommand,
  RenderedPrompt,
  RevertToCommand,
  UpdateDraftCommand,
} from '../types/prompt-template-commands.types';

export interface IPromptTemplateService {
  /** One summary per `(key, channel)` pair; drives the admin list view. */
  listLatestByKey(filters?: PromptTemplateListFilters): Promise<PromptTemplateSummary[]>;

  /** Fetch by UUID. Throws `PromptTemplateNotFoundException` when missing. */
  getById(id: string): Promise<PromptTemplate>;

  /** Version history for a `(key, channel)` pair, newest first. */
  getVersions(
    key: string,
    channel: PromptTemplateChannel | null,
  ): Promise<PromptTemplate[]>;

  /** Most recent `published` row for the pair, or `null` when none. */
  getLatestPublished(
    key: string,
    channel: PromptTemplateChannel | null,
  ): Promise<PromptTemplate | null>;

  /** Start a new draft. `version` is the next monotonic value for the pair. */
  createDraft(cmd: CreateDraftCommand): Promise<PromptTemplate>;

  /** Update the content of a `draft`. Rejects if state ≠ `draft`. */
  updateDraft(id: string, cmd: UpdateDraftCommand): Promise<PromptTemplate>;

  /** Archive the current published row and flip the draft to `published`. */
  publish(id: string, actor: string | null): Promise<PromptTemplate>;

  /** Clone a historical version into a brand-new draft (version + 1). */
  revertTo(cmd: RevertToCommand): Promise<PromptTemplate>;

  /** Render the latest-published template for a `(key, channel)` pair. */
  render(cmd: RenderCommand): Promise<RenderedPrompt>;

  /** Render a specific row by id — drives the admin preview endpoint. */
  renderById(id: string, values: Record<string, unknown>): Promise<RenderedPrompt>;

  /** Delete a draft row. Rejects if state ≠ `draft`. */
  deleteDraft(id: string): Promise<void>;
}
