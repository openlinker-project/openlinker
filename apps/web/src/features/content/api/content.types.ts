/**
 * Content Feature — Frontend Types
 *
 * Hand-written wire types mirroring the backend DTOs in
 * `apps/api/src/content/http/dto/*`. Local to the FE so the web bundle
 * stays independent of NestJS / core imports.
 *
 * @module apps/web/src/features/content/api
 */

export const FieldKeyValues = ['description'] as const;
export type FieldKey = (typeof FieldKeyValues)[number];

/**
 * Channel scoping for a prompt template. Opaque platform identifier that
 * matches `connection.platformType`. Open-world per #580 — channel is just
 * a `string`; the closed `['prestashop', 'allegro']` enum used to live here
 * and has been removed so plugin authors can author templates against new
 * channels without an FE edit.
 *
 * Kept as a named type alias rather than inlining `string` everywhere so
 * call sites stay self-documenting.
 */
export type PromptTemplateChannel = string;

export interface ContentMasterState {
  baseValue: string | null;
  draftValue: string | null;
  hasConflict: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ContentChannelState {
  connectionId: string;
  connectionName: string;
  platformType: string;
  connectionStatus: string;
  baseValue: string | null;
  draftValue: string | null;
  hasConflict: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  linkedOfferCount: number;
}

export interface ContentState {
  productId: string;
  master: ContentMasterState;
  channels: ContentChannelState[];
}

export interface ContentFieldResponse {
  id: string;
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
  draftValue: string | null;
  baseValue: string | null;
  baseVersion: string | null;
  hasConflict: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SuggestionUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface SuggestionResponse {
  suggestion: string;
  requestId: string;
  templateKey: string;
  templateVersion: number;
  templateChannel: PromptTemplateChannel | null;
  modelUsed: string;
  latencyMs: number;
  usage: SuggestionUsage;
}

export interface SaveContentDraftInput {
  connectionId: string | null;
  fieldKey: FieldKey;
  value: string;
}

export interface DiscardContentDraftInput {
  connectionId: string | null;
  fieldKey: FieldKey;
}

export interface PublishContentInput {
  connectionId: string | null;
  fieldKey: FieldKey;
}

export interface SuggestContentInput {
  channel: PromptTemplateChannel | null;
  tone?: string;
  extraInstructions?: string;
}
