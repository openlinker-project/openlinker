/**
 * Fulfillment Authority API Client
 *
 * Typed client for the "Who decides what" surface (#2353): the status read and
 * the preset apply.
 *
 * `previewPreset` is a READ despite being a POST: it commits nothing (the
 * service mutates an in-memory copy of the configs, re-resolves and diffs), and
 * it is authorised for a read-only role so the confirm dialog can explain a
 * change to somebody who then cannot make it.
 *
 * Both calls run their response through the feature's Zod parse rather than
 * casting it, so a contract break surfaces as a reported unreadable response
 * instead of `undefined` rendered into a cell.
 *
 * @module apps/web/src/features/fulfillment-authority/api
 */
import { parseAuthorityPresetPreview, parseAuthorityStatus } from './who-decides.schema';
import type {
  AuthorityPresetId,
  AuthorityPresetPreview,
  AuthorityStatus,
} from './who-decides.types';

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export interface FulfillmentAuthorityApi {
  /**
   * `GET /fulfillment-authority/status` — the seven rows, the inert states and
   * the preset catalogue.
   *
   * Authorised for a read-only role, which is why the page renders in full for
   * one and only the write control is gated.
   *
   * Resolves to `null` when the response cannot be read. The caller renders an
   * error rather than an empty table: § 2.3 promises seven rows on any install,
   * so an empty table would assert something false about the operator's setup.
   */
  getStatus: () => Promise<AuthorityStatus | null>;

  /**
   * `POST /fulfillment-authority/presets/preview` — what a preset would change.
   *
   * A dry run: it writes nothing, and is authorised for the same read-only role
   * as the status read. Resolves to `null` when the response cannot be read,
   * which the dialog reports and refuses to save on — never silently as
   * "nothing changes".
   */
  previewPreset: (presetId: AuthorityPresetId) => Promise<AuthorityPresetPreview | null>;

  /**
   * `PUT /fulfillment-authority/presets` — admin only.
   *
   * Returns the resulting status plus `applied`. A non-empty
   * `applied.failedConnectionIds` means the arrangement is PARTIALLY applied.
   * Rejects with an `ApiError`: 400 for a preset the server does not accept,
   * 422 when the result would leave something ambiguous (nothing written).
   */
  applyPreset: (presetId: AuthorityPresetId) => Promise<AuthorityStatus | null>;
}

export function createFulfillmentAuthorityApi(request: ApiRequest): FulfillmentAuthorityApi {
  return {
    async getStatus(): Promise<AuthorityStatus | null> {
      return parseAuthorityStatus(await request<unknown>('/fulfillment-authority/status'));
    },
    async previewPreset(presetId): Promise<AuthorityPresetPreview | null> {
      return parseAuthorityPresetPreview(
        await request<unknown>('/fulfillment-authority/presets/preview', {
          method: 'POST',
          body: JSON.stringify({ presetId }),
        }),
      );
    },
    async applyPreset(presetId): Promise<AuthorityStatus | null> {
      return parseAuthorityStatus(
        await request<unknown>('/fulfillment-authority/presets', {
          method: 'PUT',
          body: JSON.stringify({ presetId }),
        }),
      );
    },
  };
}
