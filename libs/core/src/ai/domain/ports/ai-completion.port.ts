/**
 * AI Completion Port
 *
 * Capability port for requesting AI text completions. Application services
 * inject this via AI_COMPLETION_PORT_TOKEN and call `complete(...)` without
 * coupling to any provider SDK.
 *
 * @module libs/core/src/ai/domain/ports
 */
import type { AiCompletionInput, AiCompletionResult } from '../types/ai-completion.types';

export interface AiCompletionPort {
  complete(input: AiCompletionInput): Promise<AiCompletionResult>;
}
