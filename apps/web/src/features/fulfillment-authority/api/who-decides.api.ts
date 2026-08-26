/**
 * Fulfillment Authority API Client
 *
 * Typed client for the "Who decides what" surface (#2353): the status read and
 * the preset apply.
 *
 * `POST /fulfillment-authority/presets/preview` is deliberately absent — #2355
 * owns the generated-diff confirm dialog and adds the call with it.
 *
 * Both calls run their response through the feature's Zod parse rather than
 * casting it, so a contract break surfaces as a reported unreadable response
 * instead of `undefined` rendered into a cell.
 *
 * @module apps/web/src/features/fulfillment-authority/api
 */
import { parseAuthorityStatus } from './who-decides.schema';
import type { AuthorityPresetId, AuthorityStatus } from './who-decides.types';

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
