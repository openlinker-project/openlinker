/**
 * Prompt Template Repository Port
 *
 * Persistence contract for `PromptTemplate` rows. Methods cover only the
 * read/write shapes the application service needs — the port deliberately
 * omits a broad "save" or "findAll" surface.
 *
 * @module libs/core/src/ai/domain/ports
 */
import type { PromptTemplate } from '../entities/prompt-template.entity';
import type {
  PromptTemplateChannel,
  PromptTemplateState,
  PromptTemplateVariable,
} from '../types/prompt-template.types';

/**
 * Filter for the "latest per (key, channel)" list view. Both fields optional;
 * `null` on `channel` means "only master rows", `undefined` means "no filter".
 */
export interface PromptTemplateListFilters {
  key?: string;
  channel?: PromptTemplateChannel | null;
}

/**
 * Summary row used by the admin list view. One summary per `(key, channel)`
 * pair describing the published vs draft positions so the UI can render the
 * row without a second fetch.
 */
export interface PromptTemplateSummary {
  key: string;
  channel: PromptTemplateChannel | null;
  latestVersion: number;
  latestId: string;
  latestState: PromptTemplateState;
  publishedVersion: number | null;
  publishedId: string | null;
  hasDraft: boolean;
  updatedAt: Date;
}

/**
 * Insert payload for a new row (either an initial draft or a revert clone).
 */
export interface PromptTemplateInsert {
  key: string;
  channel: PromptTemplateChannel | null;
  version: number;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: readonly PromptTemplateVariable[];
  state: PromptTemplateState;
  publishedAt: Date | null;
  createdBy: string | null;
}

/**
 * Partial update to a draft row. The repository rejects updates to
 * non-draft rows at the SQL level (WHERE state='draft').
 */
export interface PromptTemplateContentUpdate {
  systemPrompt?: string;
  userPromptTemplate?: string;
  variables?: readonly PromptTemplateVariable[];
}

export interface PromptTemplateRepositoryPort {
  findById(id: string): Promise<PromptTemplate | null>;
  findByKeyChannelVersion(
    key: string,
    channel: PromptTemplateChannel | null,
    version: number,
  ): Promise<PromptTemplate | null>;
  findLatestPublished(
    key: string,
    channel: PromptTemplateChannel | null,
  ): Promise<PromptTemplate | null>;
  findVersions(key: string, channel: PromptTemplateChannel | null): Promise<PromptTemplate[]>;
  listLatestByKey(filters?: PromptTemplateListFilters): Promise<PromptTemplateSummary[]>;
  insert(payload: PromptTemplateInsert): Promise<PromptTemplate>;
  updateContent(id: string, patch: PromptTemplateContentUpdate): Promise<PromptTemplate>;
  /**
   * Transactional publish: validates that `id` is a draft, archives any
   * currently-published row for the same `(key, channel)`, and flips the
   * target to `published`. The repository reads `(key, channel)` off the
   * target row inside the transaction — callers just pass the id.
   */
  publishTransition(id: string): Promise<PromptTemplate>;
  /**
   * Set state to `archived`, guarded by an expected prior state. Closes the
   * race-window between the service-level state check and the write — if
   * the row's state changed in the meantime (e.g. a concurrent publish),
   * the UPDATE matches zero rows and the repo throws
   * `PromptTemplateStateException` so the caller can re-fetch and retry.
   *
   * Mirrors the safety posture of `publishTransition` without the multi-
   * statement transaction (archive is a single UPDATE).
   */
  archiveById(
    id: string,
    expectedPriorState: PromptTemplateState,
  ): Promise<PromptTemplate>;
  nextVersion(key: string, channel: PromptTemplateChannel | null): Promise<number>;
  deleteById(id: string): Promise<void>;
}
