/**
 * Static Token Provider Adapter
 *
 * Returns a fixed bearer token. Fine for sandbox/dev and a temp API token; a
 * real deployment would swap in an OAuth-refreshing provider behind the same
 * port.
 *
 * @module adapters
 */

import type { TokenProviderPort } from '../domain/ports/token-provider.port.ts';

export class StaticTokenProviderAdapter implements TokenProviderPort {
  readonly #token: string;

  constructor(token: string) {
    if (!token || token.trim().length === 0) {
      throw new Error('StaticTokenProviderAdapter: token must be a non-empty string');
    }
    this.#token = token;
  }

  getToken(): string {
    return this.#token;
  }
}
