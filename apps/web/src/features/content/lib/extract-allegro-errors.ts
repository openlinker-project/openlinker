/**
 * Extract Allegro errors
 *
 * Pulls the structured `errors[]` array off the FE's `ApiError.details`
 * shape when the BE responds with `{ code: 'CHANNEL_PUBLISH_FAILED', errors }`
 * (#486). Returns `null` for any other error / shape so callers can do
 * `errors ?? null` and fall through to the bare-string `<Alert>` cleanly.
 *
 * @module apps/web/src/features/content/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import type { AllegroLikeError } from '../../../shared/lib/allegro-error-mapping';

interface ChannelPublishFailedBody {
  code: 'CHANNEL_PUBLISH_FAILED';
  errors: AllegroLikeError[];
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

export function extractAllegroErrors(err: unknown): AllegroLikeError[] | null {
  if (!(err instanceof ApiError)) return null;
  if (!isChannelPublishFailedBody(err.details)) return null;
  return err.details.errors;
}
