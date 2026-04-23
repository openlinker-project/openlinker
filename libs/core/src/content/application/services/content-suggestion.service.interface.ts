/**
 * Content Suggestion Service Interface
 *
 * Application-layer contract for generating AI-authored draft suggestions.
 * The service never writes to the platform and never persists the
 * suggestion as a draft — acceptance is an explicit follow-up call to
 * `ContentDraftService.saveDraft` by the controller.
 *
 * @module libs/core/src/content/application/services
 */
import type {
  SuggestDescriptionCommand,
  SuggestionResult,
} from '../types/content-suggestion.types';

export interface IContentSuggestionService {
  suggestDescription(cmd: SuggestDescriptionCommand): Promise<SuggestionResult>;
}
