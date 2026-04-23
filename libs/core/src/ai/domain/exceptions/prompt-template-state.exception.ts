/**
 * Prompt Template State Exception
 *
 * Thrown when an operation is attempted against a row whose state does not
 * permit it — editing a `published` or `archived` row, publishing a row that
 * is not `draft`, or losing a concurrent-publish race. Maps to HTTP 400 at
 * the API boundary with a message directing the caller to refresh.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import type { PromptTemplateState } from '../types/prompt-template.types';

export class PromptTemplateStateException extends Error {
  public readonly templateId: string;
  public readonly actualState: PromptTemplateState | null;
  public readonly requiredState: PromptTemplateState;

  constructor(args: {
    templateId: string;
    actualState: PromptTemplateState | null;
    requiredState: PromptTemplateState;
    operation: string;
  }) {
    const actual = args.actualState ?? 'missing';
    super(
      `Prompt template ${args.templateId} cannot ${args.operation}: state is "${actual}" but "${args.requiredState}" is required.`,
    );
    this.name = 'PromptTemplateStateException';
    this.templateId = args.templateId;
    this.actualState = args.actualState;
    this.requiredState = args.requiredState;
    Error.captureStackTrace(this, this.constructor);
  }
}
