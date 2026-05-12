/**
 * Allegro — Content-Publish Error Extractor
 *
 * Sniffs the FE `ApiError.details` shape `{ code: 'CHANNEL_PUBLISH_FAILED',
 * errors }` (#486) and returns the typed `errors[]` for inline rendering by
 * `StructuredErrorList`. Returns `null` for any other shape — the
 * `extractPlatformErrors` dispatcher in `features/content/lib/` iterates
 * plugins until one matches, so silent `null` is the correct
 * non-applicable signal.
 *
 * Moved from `features/content/lib/extract-allegro-errors.ts` to
 * `plugins/allegro/` (#613) so the Content feature stays
 * platform-neutral. The matcher logic is unchanged.
 *
 * @module plugins/allegro
 */
import { ApiError } from '../../shared/api/api-error';
import type { StructuredError } from '../../shared/types/structured-error.types';

interface ChannelPublishFailedBody {
  code: 'CHANNEL_PUBLISH_FAILED';
  errors: StructuredError[];
}

function isChannelPublishFailedBody(value: unknown): value is ChannelPublishFailedBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { code?: unknown; errors?: unknown };
  if (candidate.code !== 'CHANNEL_PUBLISH_FAILED') return false;
  if (!Array.isArray(candidate.errors)) return false;
  return candidate.errors.every((e) => {
    if (typeof e !== 'object' || e === null) return false;
    const entry = e as { code?: unknown; message?: unknown };
    return typeof entry.code === 'string' && typeof entry.message === 'string';
  });
}

export function extractAllegroContentPublishErrors(err: unknown): StructuredError[] | null {
  if (!(err instanceof ApiError)) return null;
  if (!isChannelPublishFailedBody(err.details)) return null;
  return err.details.errors;
}
