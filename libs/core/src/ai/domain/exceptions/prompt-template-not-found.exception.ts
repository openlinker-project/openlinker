/**
 * Prompt Template Not Found Exception
 *
 * Thrown by the application service when a lookup (by id or by
 * key+channel+version) does not resolve to an existing row. Maps to HTTP 404
 * at the API boundary.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import type { PromptTemplateChannel } from '../types/prompt-template.types';

export class PromptTemplateNotFoundException extends Error {
  public readonly templateId: string | null;
  public readonly key: string | null;
  public readonly channel: PromptTemplateChannel | null;
  public readonly version: number | null;

  constructor(args: {
    templateId?: string;
    key?: string;
    channel?: PromptTemplateChannel | null;
    version?: number;
  }) {
    const parts: string[] = [];
    if (args.templateId !== undefined) parts.push(`id=${args.templateId}`);
    if (args.key !== undefined) parts.push(`key=${args.key}`);
    if (args.channel !== undefined) parts.push(`channel=${args.channel ?? 'master'}`);
    if (args.version !== undefined) parts.push(`version=${args.version}`);
    super(`Prompt template not found: ${parts.join(', ')}`);
    this.name = 'PromptTemplateNotFoundException';
    this.templateId = args.templateId ?? null;
    this.key = args.key ?? null;
    this.channel = args.channel ?? null;
    this.version = args.version ?? null;
    Error.captureStackTrace(this, this.constructor);
  }
}
