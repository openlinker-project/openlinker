/**
 * Shopify GraphQL Client
 *
 * Minimal transport for the Admin GraphQL API: one POST per operation to
 * `https://{shop}/admin/api/{version}/graphql.json`, `X-Shopify-Access-Token`
 * auth, a per-attempt timeout, typed errors. Built per adapter bag, never a DI
 * singleton, because it closes over one connection's token.
 *
 * Outbound pacing is the injected `fetchImpl`'s job (the connection-bound
 * transport). A rate-limiter rejection is rethrown UNWRAPPED so the job runner
 * can requeue without spending an attempt.
 *
 * Two retries happen here, both bounded to ONE extra attempt, because each is
 * cheaper to settle in place than to send the whole job back through the
 * runner's ladder:
 *   - a 401 on a MINTED token: the token aged out early or was revoked, so it
 *     is dropped and minted once more. A stored token is never retried - only
 *     the operator can replace it.
 *   - a cost-based `THROTTLED` answer whose wait (from `throttleStatus`) is
 *     short. A longer wait surfaces as `ShopifyGraphqlError` and the retry
 *     classifier defers the job penalty-free.
 *
 * `mutate` turns `userErrors` into `ShopifyUserErrorsException`: a mutation
 * with user errors wrote nothing, and returning its payload would let a caller
 * read a refusal as success.
 *
 * Redirects are never followed (the token must not be replayed to a host the
 * operator did not configure) and the body is size-capped while it is read.
 *
 * @module libs/integrations/shopify/src/infrastructure/http
 */
import type { FetchLike } from '@openlinker/shared/http';
import { RateLimitAbortedError, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

import { ShopifyApiError } from '../../domain/exceptions/shopify-api.error';
import { ShopifyGraphqlError } from '../../domain/exceptions/shopify-graphql.error';
import { ShopifyNetworkError } from '../../domain/exceptions/shopify-network.error';
import {
  ShopifyUserErrorsException,
  type ShopifyUserErrorEntry,
} from '../../domain/exceptions/shopify-user-errors.exception';
import type {
  ShopifyGraphqlEnvelope,
  ShopifyThrottleStatus,
} from '../../domain/types/shopify-api.types';
import type { ShopifyAccessTokenProvider } from './shopify-access-token.provider';
import { parseShopifyJson, readShopifyBody } from './shopify-response-body';

const REQUEST_TIMEOUT_MS = 30_000;

/** Longest throttle wait settled in place; anything longer is deferred by the runner. */
const MAX_INLINE_THROTTLE_WAIT_MS = 5_000;

export type ShopifyVariables = Readonly<Record<string, unknown>>;

export interface ShopifyGraphqlClientConfig {
  readonly storeDomain: string;
  readonly apiVersion: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ShopifyGraphqlClient {
  private readonly endpoint: string;

  constructor(
    config: ShopifyGraphqlClientConfig,
    private readonly tokens: ShopifyAccessTokenProvider,
    private readonly fetchImpl: FetchLike,
  ) {
    this.endpoint = `https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`;
  }

  /** Runs a query and returns its `data`. */
  async query<T>(document: string, variables: ShopifyVariables = {}): Promise<T> {
    return this.execute<T>(document, variables);
  }

  /**
   * Runs a mutation and returns the payload under `payloadField`, after
   * refusing one that carries user errors. `userErrorsField` names the
   * payload's error list where Shopify spells it differently
   * (`orderCancelUserErrors`).
   */
  async mutate<P extends object>(
    document: string,
    variables: ShopifyVariables,
    payloadField: string,
    userErrorsField = 'userErrors',
  ): Promise<P> {
    const data = await this.execute<Record<string, unknown>>(document, variables);
    const payload = data[payloadField];
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      throw new ShopifyNetworkError(`Shopify ${payloadField} answered with no payload`);
    }
    const userErrors = (payload as Record<string, unknown>)[userErrorsField];
    if (Array.isArray(userErrors) && userErrors.length > 0) {
      throw new ShopifyUserErrorsException(payloadField, userErrors as ShopifyUserErrorEntry[]);
    }
    return payload as P;
  }

  private async execute<T>(document: string, variables: ShopifyVariables): Promise<T> {
    let retriedAuth = false;
    let retriedThrottle = false;
    for (;;) {
      const access = await this.tokens.get();
      try {
        return await this.send<T>(access.token, document, variables);
      } catch (error) {
        const authRejected =
          (error instanceof ShopifyApiError && error.isAuthRejection()) ||
          (error instanceof ShopifyGraphqlError && error.isInvalidToken());
        if (authRejected && access.renewable && !retriedAuth) {
          retriedAuth = true;
          await this.tokens.invalidate();
          continue;
        }
        if (error instanceof ThrottledWithWait && !retriedThrottle) {
          retriedThrottle = true;
          await sleep(error.waitMs);
          continue;
        }
        if (error instanceof ThrottledWithWait) {
          throw error.graphqlError;
        }
        throw error;
      }
    }
  }

  private async send<T>(token: string, document: string, variables: ShopifyVariables): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ query: document, variables }),
        redirect: 'manual',
        signal: controller.signal,
      });
      text = await readShopifyBody(response);
    } catch (error) {
      if (error instanceof RateLimitTimeoutError || error instanceof RateLimitAbortedError) {
        throw error;
      }
      if (error instanceof ShopifyNetworkError) {
        throw error;
      }
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new ShopifyNetworkError(
        controller.signal.aborted
          ? `Shopify request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `Shopify request failed: ${cause.message}`,
        controller.signal.aborted,
        cause,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new ShopifyApiError(response.status, text);
    }
    const envelope = parseShopifyJson<ShopifyGraphqlEnvelope<T>>(text);
    if (envelope === null) {
      throw new ShopifyNetworkError(
        `Shopify returned an unreadable response (HTTP ${response.status}, not JSON)`,
      );
    }
    if (envelope.errors !== undefined && envelope.errors.length > 0) {
      const graphqlError = new ShopifyGraphqlError(
        envelope.errors.map((e) => e.extensions?.code ?? ''),
        envelope.errors.map((e) => e.message),
      );
      if (graphqlError.isThrottled()) {
        const waitMs = throttleWaitMs(
          envelope.extensions?.cost?.requestedQueryCost,
          envelope.extensions?.cost?.throttleStatus,
        );
        if (waitMs !== null && waitMs <= MAX_INLINE_THROTTLE_WAIT_MS) {
          throw new ThrottledWithWait(waitMs, graphqlError);
        }
      }
      throw graphqlError;
    }
    if (envelope.data === null || envelope.data === undefined) {
      throw new ShopifyNetworkError('Shopify answered with neither data nor errors');
    }
    return envelope.data;
  }
}

/** Internal signal: a throttle that clears within the inline budget. Never escapes the client. */
class ThrottledWithWait extends Error {
  constructor(
    readonly waitMs: number,
    readonly graphqlError: ShopifyGraphqlError,
  ) {
    super('throttled');
  }
}

/** Time until the bucket holds enough points for the query, or null when it cannot be computed. */
function throttleWaitMs(
  requestedCost: number | undefined,
  status: ShopifyThrottleStatus | undefined,
): number | null {
  if (requestedCost === undefined || status === undefined || status.restoreRate <= 0) {
    return null;
  }
  const missing = Math.max(0, requestedCost - status.currentlyAvailable);
  return Math.ceil((missing / status.restoreRate) * 1000) + 250;
}
