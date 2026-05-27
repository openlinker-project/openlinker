/**
 * Allegro Account Reader
 *
 * Reads the authenticated seller identity from Allegro `GET /me` for a raw
 * access token (used at OAuth completion, before a connection — and therefore
 * the per-connection `AllegroHttpClient` — exists). Owns the `/me` request
 * contract (path, `Accept` version header) and response parsing, keeping that
 * Allegro-API knowledge in the plugin package rather than the host (#820;
 * the broader OAuth-surface relocation is tracked in #859).
 *
 * @module libs/integrations/allegro/src/infrastructure/http
 * @see {@link AllegroMeResponse} for the consumed response shape
 */
import { Injectable } from '@nestjs/common';

import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import { AllegroAuthenticationException } from '../../domain/exceptions/allegro-authentication.exception';
import { AllegroNetworkException } from '../../domain/exceptions/allegro-network.exception';
import type {
  AllegroAccountIdentity,
  AllegroMeResponse,
} from '../../domain/types/allegro-account.types';

const ME_REQUEST_TIMEOUT_MS = 10_000;
/** Allegro requires this versioned media type on every REST call. */
const ALLEGRO_ACCEPT_HEADER = 'application/vnd.allegro.public.v1+json';

@Injectable()
export class AllegroAccountReader {
  /**
   * Fetch the seller identity authorized by `accessToken`. `baseUrl` is the
   * environment's Allegro API host (the host resolves it). Throws on a non-200
   * response or a body without a usable account `id` — callers treat a failure
   * as fatal to OAuth completion so a connection is never seller-anchored to an
   * unverified account.
   */
  async fetchSellerIdentity(baseUrl: string, accessToken: string): Promise<AllegroAccountIdentity> {
    const meUrl = new URL('/me', baseUrl).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ME_REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(meUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: ALLEGRO_ACCEPT_HEADER,
        },
        signal: controller.signal,
      });
    } catch (error) {
      // DNS / TLS / connection-refused / abort-on-timeout — transient, retryable.
      const message = error instanceof Error ? error.message : String(error);
      throw new AllegroNetworkException(`Allegro GET /me request failed: ${message}`, meUrl, {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => undefined);
      const message = `Allegro GET /me failed: ${response.status} ${response.statusText}`;
      if (response.status === 401) {
        throw new AllegroAuthenticationException(message, response.status, meUrl);
      }
      throw new AllegroApiException(message, response.status, responseBody, meUrl);
    }

    const body = (await response.json()) as Partial<AllegroMeResponse> | null;
    if (!body || typeof body.id !== 'string' || body.id.length === 0) {
      throw new AllegroApiException(
        'Allegro GET /me returned no account id',
        response.status,
        undefined,
        meUrl,
      );
    }

    return {
      sellerId: body.id,
      login: typeof body.login === 'string' && body.login.length > 0 ? body.login : body.id,
    };
  }
}
