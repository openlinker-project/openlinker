/**
 * KSeF HTTP Client Factory
 *
 * Wires the per-connection KSeF transport graph and breaks the construction
 * cycle (client → handshake → token-encryptor → public-key-cache → client) at
 * the factory level using a mutable holder:
 *
 *   1. Construct `KsefHttpClient` first with a deferred token lifecycle that
 *      reads the handshake from a holder. Its unauthenticated endpoints
 *      (`/auth/*`, `/security/public-key-certificates`) work before any token
 *      exists, so the cache + handshake can use the client.
 *   2. Construct `MfPublicKeyCacheService`, `KsefTokenEncryptor`,
 *      `KsefAuthHandshakeService` — all referencing that same client instance.
 *   3. Populate the holder with the handshake.
 *
 * No service instantiates the client; the client never instantiates a service.
 * This keeps the graph acyclic at the constructor level (no NestJS forwardRef).
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import type { CachePort } from '@openlinker/shared/cache';
import type { KsefEnvironment } from '../../domain/types/ksef-connection.types';
import type { KsefAuthenticationToken } from './ksef-http-client.types';
import { KsefHttpClient, type KsefTokenLifecycle } from './ksef-http-client';
import type { KsefRateLimiter } from './ksef-rate-limiter';
import { resolveKsefBaseUrl } from './ksef-hosts';
import { MfPublicKeyCacheService } from '../crypto/mf-public-key-cache.service';
import { KsefTokenEncryptor } from './auth/ksef-token-encryptor.service';
import {
  KsefAuthHandshakeService,
  type KsefTokenAuthMaterial,
} from './auth/ksef-auth-handshake.service';
import { KsefConfigException } from '../../domain/exceptions/ksef-config.exception';

export interface CreateKsefHttpClientInput {
  connectionId: string;
  env: KsefEnvironment;
  /** Resolved ksef-token material. Qualified-seal wiring is deferred to C4. */
  authMaterial: KsefTokenAuthMaterial;
  cache?: CachePort;
  /**
   * Proactive per-hour rate-limit pacer (#1594) shared across connections. When
   * present, the client throttles the three online-session write endpoints
   * against KSeF's documented ceilings. Omitted by callers (e.g. the connection
   * tester) that never issue documents.
   */
  rateLimiter?: KsefRateLimiter;
  /**
   * Rate-limit bucket key — the seller NIP (KSeF buckets by NIP), so sibling
   * connections on the same NIP share one bucket. Falls back to `connectionId`
   * inside the client when absent.
   */
  rateLimitBucketKey?: string;
}

export interface KsefHttpClientBundle {
  httpClient: KsefHttpClient;
  publicKeyCache: MfPublicKeyCacheService;
  handshake: KsefAuthHandshakeService;
}

/**
 * Build a fully-wired KSeF HTTP client + the auth/crypto services that share it.
 */
export function createKsefHttpClient(input: CreateKsefHttpClientInput): KsefHttpClientBundle {
  const baseUrl = resolveKsefBaseUrl(input.env);

  // Mutable holder populated in step 3; read lazily by the lifecycle callbacks.
  const holder: { handshake: KsefAuthHandshakeService | null } = { handshake: null };

  const runHandshake = (): Promise<KsefAuthenticationToken> => {
    if (!holder.handshake) {
      throw new KsefConfigException('KSeF auth handshake used before wiring completed');
    }
    return holder.handshake.authenticate(input.authMaterial);
  };

  const lifecycle: KsefTokenLifecycle = {
    authenticate: () => runHandshake(),
    // No dedicated refresh endpoint is wired yet (C4); a full re-handshake
    // rotates the token. Cheap relative to the document flow and keeps the
    // token-lifecycle contract honest.
    refresh: () => runHandshake(),
  };

  // 1. Client first (its unauthenticated endpoints bootstrap the services).
  const httpClient = new KsefHttpClient(input.connectionId, baseUrl, lifecycle, undefined, {
    rateLimiter: input.rateLimiter,
    bucketKey: input.rateLimitBucketKey,
  });

  // 2. Services share the one client instance.
  const publicKeyCache = new MfPublicKeyCacheService(input.connectionId, httpClient, input.cache);
  const tokenEncryptor = new KsefTokenEncryptor(publicKeyCache);
  const handshake = new KsefAuthHandshakeService(input.connectionId, httpClient, tokenEncryptor);

  // 3. Close the cycle.
  holder.handshake = handshake;

  return { httpClient, publicKeyCache, handshake };
}
