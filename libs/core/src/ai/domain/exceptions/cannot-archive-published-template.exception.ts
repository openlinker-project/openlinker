/**
 * Cannot Archive Published Template Exception
 *
 * Thrown when an admin attempts to archive a `published` row without
 * `{ force: true }`. The partial unique index on the `prompt_templates`
 * table enforces at most one published row per `(key, channel)` — so the
 * target row is by definition the only published version, and archiving
 * it would leave the suggestion service with no template to render for
 * that pair until a replacement is published.
 *
 * The API surfaces this as **HTTP 409** so callers can either pick a
 * different row, publish a replacement first, or retry with `force: true`.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import type { PromptTemplateChannel } from '../types/prompt-template.types';

export class CannotArchivePublishedTemplateException extends Error {
  public readonly templateId: string;
  public readonly key: string;
  public readonly channel: PromptTemplateChannel | null;

  constructor(args: {
    templateId: string;
    key: string;
    channel: PromptTemplateChannel | null;
  }) {
    const channelLabel = args.channel ?? 'master';
    super(
      `Cannot archive published template ${args.templateId} (key=${args.key}, channel=${channelLabel}): no other published version exists for this (key, channel) pair. Publish a replacement first, or pass { "force": true } to bypass.`,
    );
    this.name = 'CannotArchivePublishedTemplateException';
    this.templateId = args.templateId;
    this.key = args.key;
    this.channel = args.channel;
    Error.captureStackTrace(this, this.constructor);
  }
}
