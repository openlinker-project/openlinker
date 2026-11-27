/**
 * Automatic shipping labels - API client (#2729)
 *
 * Two reads, both keyed on the connection that does the packing:
 *
 * - `getRefusals` - recent refusals, split into "needs your input" and
 *   "retrying automatically".
 * - `preview` - what a DRAFT configuration would do to recent orders. A POST
 *   only because the draft travels in a body; it buys nothing and writes
 *   nothing.
 *
 * Saving the settings is not here: it is a `PATCH /connections/:id` that
 * replaces `config` whole, so it lives in `use-save-auto-dispatch-mutation.ts`
 * beside the fresh read it must be built from.
 *
 * @module apps/web/src/features/auto-dispatch/api
 */
import { parseAutoDispatchPreview, parseAutoDispatchRefusals } from './auto-dispatch.schema';
import type {
  AutoDispatchPreview,
  AutoDispatchPreviewRequest,
  AutoDispatchRefusals,
} from './auto-dispatch.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface AutoDispatchApi {
  /** `GET /connections/:id/auto-dispatch/refusals`; `null` when the response cannot be read. */
  getRefusals: (connectionId: string, limit?: number) => Promise<AutoDispatchRefusals | null>;
  /** `POST /connections/:id/auto-dispatch/preview`; `null` when the response cannot be read. */
  preview: (
    connectionId: string,
    input: AutoDispatchPreviewRequest
  ) => Promise<AutoDispatchPreview | null>;
}

export function createAutoDispatchApi(request: ApiRequest): AutoDispatchApi {
  const base = (connectionId: string): string =>
    `/connections/${encodeURIComponent(connectionId)}/auto-dispatch`;

  return {
    async getRefusals(connectionId, limit): Promise<AutoDispatchRefusals | null> {
      const query = limit === undefined ? '' : `?limit=${String(limit)}`;
      return parseAutoDispatchRefusals(
        await request<unknown>(`${base(connectionId)}/refusals${query}`)
      );
    },
    async preview(connectionId, input): Promise<AutoDispatchPreview | null> {
      return parseAutoDispatchPreview(
        await request<unknown>(`${base(connectionId)}/preview`, {
          method: 'POST',
          body: JSON.stringify(input),
        })
      );
    },
  };
}
