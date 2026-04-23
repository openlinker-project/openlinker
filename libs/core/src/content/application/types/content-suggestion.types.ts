/**
 * Content Suggestion Types
 *
 * Command + result shapes for `IContentSuggestionService`. The suggest call
 * never persists — the result is returned to the caller and the operator
 * must explicitly accept it (which hits `ContentDraftService.saveDraft`).
 *
 * @module libs/core/src/content/application/types
 */
import type { AiCompletionUsage } from '@openlinker/core/ai';
import type { PromptTemplateChannel } from '@openlinker/core/ai';

export const DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS = 1024;

export interface SuggestDescriptionCommand {
  productId: string;
  /** `null` = master (generic); otherwise the channel-specific template. */
  channel: PromptTemplateChannel | null;
  tone?: string;
  extraInstructions?: string;
  /**
   * Override for the default max-output cap. Callers typically omit this —
   * `DEFAULT_SUGGESTION_MAX_OUTPUT_TOKENS` is sized for a long product
   * description. A future follow-up may move this onto the template row.
   */
  maxOutputTokens?: number;
  /**
   * Optional correlation id. Controllers populate this from the inbound
   * request id (or generate one) so logs on both sides share the same
   * identifier.
   */
  requestId?: string;
}

export interface SuggestionResult {
  suggestion: string;
  requestId: string;
  templateKey: string;
  templateVersion: number;
  templateChannel: PromptTemplateChannel | null;
  usage: AiCompletionUsage;
  modelUsed: string;
  latencyMs: number;
}
