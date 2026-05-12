/**
 * Extract Allegro errors
 *
 * Pulls the structured `errors[]` array off the FE's `ApiError.details`
 * shape when the BE responds with `{ code: 'CHANNEL_PUBLISH_FAILED', errors }`
 * (#486). Returns `null` for any other error / shape so callers can do
 * `errors ?? null` and fall through to the bare-string `<Alert>` cleanly.
 *
 * The error rows use `StructuredError` from `shared/ui/structured-error-list`
 * (the same shape Allegro returns) — content-publish today happens to be an
 * Allegro-only flow, but the shape stays platform-neutral so the panel can
 * render PrestaShop / Shopify / … errors with the same primitive.
 *
 * @module apps/web/src/features/content/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import type { StructuredError } from '../../../shared/ui/structured-error-list';

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

export function extractAllegroErrors(err: unknown): StructuredError[] | null {
  if (!(err instanceof ApiError)) return null;
  if (!isChannelPublishFailedBody(err.details)) return null;
  return err.details.errors;
}
