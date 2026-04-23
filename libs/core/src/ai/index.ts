/**
 * AI Bounded Context — Public Surface
 *
 * Exports the capability port, types, exceptions, and DI tokens for the AI
 * bounded context. This now includes two concerns:
 *
 *   1. `AiCompletionPort` — provider-agnostic LLM completions. Implemented
 *      by adapters in `libs/integrations/ai/`.
 *   2. Prompt-template storage — editable, versioned templates with a
 *      draft/publish/archive state machine. Owned end-to-end by the core
 *      `AiModule` (repository + service + render helper).
 *
 * @module libs/core/src/ai
 */
export * from './domain/ports/ai-completion.port';
export * from './domain/types/ai-completion.types';
export * from './domain/exceptions/ai-completion.exception';
export * from './domain/exceptions/ai-rate-limit.exception';
export * from './domain/exceptions/ai-timeout.exception';
export * from './domain/exceptions/ai-invalid-response.exception';

export * from './domain/entities/prompt-template.entity';
export * from './domain/types/prompt-template.types';
export * from './domain/ports/prompt-template-repository.port';
export * from './domain/exceptions/prompt-template-not-found.exception';
export * from './domain/exceptions/prompt-template-state.exception';
export * from './domain/exceptions/prompt-template-render.exception';

export * from './application/services/prompt-template.service.interface';
export * from './application/types/prompt-template-commands.types';
export { renderTemplate } from './application/internal/render-template';
export type { RenderTemplateArgs } from './application/internal/render-template';

export * from './ai.tokens';
export { AiModule } from './ai.module';
