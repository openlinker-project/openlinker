/**
 * Allegro Account Types
 *
 * Shapes for the authenticated-account read (`GET /me`). Used by
 * `AllegroAccountReader` to capture the seller identity at OAuth completion so
 * an in-place re-auth (#819) can verify it still authorizes the same seller
 * (#820). `AllegroMeResponse` types only the fields we consume; `/me` returns
 * more (email, company, features, …).
 *
 * This file contains types only (per engineering standards).
 *
 * @module libs/integrations/allegro/src/domain/types
 */

/** Subset of Allegro `GET /me` we read. `id` is the stable account id. */
export interface AllegroMeResponse {
  id: string;
  login: string;
}

/** Neutral seller identity captured from `/me`. `sellerId` is the match key. */
export interface AllegroAccountIdentity {
  sellerId: string;
  login: string;
}
