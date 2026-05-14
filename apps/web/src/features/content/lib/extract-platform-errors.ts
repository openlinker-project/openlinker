/**
 * Platform-neutral content-publish error extractor
 *
 * Replaces `extract-allegro-errors.ts` (#613). Iterates the platform
 * plugins until one's `extractContentPublishErrors` returns a non-null
 * result; falls back to `null` so the content editor renders the bare
 * mutation-error `<Alert>` cleanly.
 *
 * Dispatch is shape-based — the caller doesn't pass platform context.
 * That's intentional: the existing Allegro extractor matches on
 * `ApiError.details.code === 'CHANNEL_PUBLISH_FAILED'`, which is unique
 * enough that the first non-null match is always the right plugin.
 * If a future second platform emits a colliding shape, the dispatcher
 * can be tightened to take a `platformType` hint without changing the
 * caller signature.
 *
 * @module features/content/lib
 */
import type { Platform } from '../../../shared/plugins';
import type { StructuredError } from '../../../shared/types/structured-error.types';

export function extractPlatformErrors(
  err: unknown,
  plugins: readonly Platform[],
): StructuredError[] | null {
  for (const plugin of plugins) {
    const extracted = plugin.extractContentPublishErrors?.(err);
    if (extracted !== null && extracted !== undefined) {
      return extracted;
    }
  }
  return null;
}
