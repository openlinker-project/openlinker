/**
 * Prompt Template Render Exception
 *
 * Thrown by the pure render helper when a declared required variable is
 * absent from the caller-supplied `values` map. Maps to HTTP 422 at the API
 * boundary.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
export class PromptTemplateRenderException extends Error {
  public readonly missingVariableName: string;

  constructor(missingVariableName: string) {
    super(`Missing required variable "${missingVariableName}" for prompt template render.`);
    this.name = 'PromptTemplateRenderException';
    this.missingVariableName = missingVariableName;
    Error.captureStackTrace(this, this.constructor);
  }
}
