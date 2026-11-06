/**
 * Shopify GraphQL Client
 *
 * Transport for the Admin GraphQL API: one POST per operation to
 * `https://{shop}/admin/api/{version}/graphql.json`, `X-Shopify-Access-Token`
 * auth, a per-attempt timeout, typed errors. Built per resolution, never a DI
 * singleton, because it closes over one connection's token.
 *
 * Pacing has two layers. Request count goes through the injected
 * `fetchImpl` (the connection-bound transport and the store's shared bucket).
 * Query COST is paced here: the last `throttleStatus` Shopify reported for
 * the store is kept in a process-wide memo, and a call waits (up to a bound)
 * until the bucket has refilled enough for the previous query's cost. A
 * rate-limiter rejection is rethrown UNWRAPPED so the job runner can requeue
 * without spending an attempt.
 *
 * Two retries happen here, each bounded to ONE extra attempt, because each is
 * cheaper to settle in place than to send the job back through the runner:
 *   - a 401 on a renewable token (minted or OAuth): the token is renewed once.
 *     A pre-issued token is never retried - only the operator can replace it.
 *   - a `THROTTLED` answer whose wait is short. A longer wait surfaces as
 *     `ShopifyGraphqlError` and the retry classifier defers the job.
 *
 * `mutate` turns `userErrors` into `ShopifyUserErrorsException`: a mutation
 * with user errors wrote nothing, and returning its payload would let a
 * caller read a refusal as success.
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
import {
  throttleWaitMs,
  type ShopifyThrottleObservation,
} from '../../domain/policies/shopify-throttle.policy';
import type { ShopifyGraphqlEnvelope } from '../../domain/types/shopify-api.types';
import type { ShopifyAccessTokenProvider } from './shopify-access-token.provider';
import { parseShopifyJson, readShopifyBody } from './shopify-response-body';

const REQUEST_TIMEOUT_MS = 30_000;

/** Longest wait settled in place, before a call or after a `THROTTLED`; longer waits go to the runner. */
const MAX_INLINE_THROTTLE_WAIT_MS = 5_000;

export type ShopifyVariables = Readonly<Record<string, unknown>>;

/** Last throttle observation per store domain, owned by the plugin instance. */
export type ShopifyThrottleMemo = Map<string, ShopifyThrottleObservation>;

export interface ShopifyGraphqlClientConfig {
  readonly storeDomain: string;
  readonly apiVersion: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ShopifyGraphqlClient {
  private readonly endpoint: string;
  private readonly storeDomain: string;

  constructor(
    config: ShopifyGraphqlClientConfig,
    private readonly tokens: ShopifyAccessTokenProvider,
    private readonly fetchImpl: FetchLike,
    private readonly throttleMemo: ShopifyThrottleMemo = new Map(),
  ) {
    this.storeDomain = config.storeDomain;
    this.endpoint = `https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`;
  }

  /** Runs a query and returns its `data`. */
  async query<T>(document: string, variables: ShopifyVariables = {}): Promise<T> {
    return this.execute<T>(document, variables);
  }

  /**
   * Runs a mutation and returns the payload under `payloadField`, after
   * refusing one that carries user errors. `userErrorsField` names the
   * payload's error list where Shopify spells it differently.
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
      await this.paceByCost();
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
        if (error instanceof ShopifyGraphqlError && error.isThrottled() && !retriedThrottle) {
          const wait = this.currentWaitMs();
          if (wait <= MAX_INLINE_THROTTLE_WAIT_MS) {
            retriedThrottle = true;
            await sleep(wait);
            continue;
          }
        }
        throw error;
      }
    }
  }

  /** Waits for a refill the last observation says is close; leaves a long one to Shopify's own refusal. */
  private async paceByCost(): Promise<void> {
    const wait = this.currentWaitMs();
    if (wait > 0 && wait <= MAX_INLINE_THROTTLE_WAIT_MS) {
      await sleep(wait);
    }
  }

  private currentWaitMs(): number {
    const observation = this.throttleMemo.get(this.storeDomain);
    return observation === undefined
      ? 0
      : throttleWaitMs(observation, observation.lastQueryCost, Date.now());
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
      if (
        error instanceof RateLimitTimeoutError ||
        error instanceof RateLimitAbortedError ||
        error instanceof ShopifyNetworkError
      ) {
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
    this.recordThrottle(envelope);
    if (envelope.errors !== undefined && envelope.errors.length > 0) {
      throw new ShopifyGraphqlError(
        envelope.errors.map((e) => e.extensions?.code ?? ''),
        envelope.errors.map((e) => e.message),
      );
    }
    if (envelope.data === null || envelope.data === undefined) {
      throw new ShopifyNetworkError('Shopify answered with neither data nor errors');
    }
    return envelope.data;
  }

  private recordThrottle(envelope: ShopifyGraphqlEnvelope<unknown>): void {
    const cost = envelope.extensions?.cost;
    if (cost?.throttleStatus === undefined) {
      return;
    }
    this.throttleMemo.set(this.storeDomain, {
      status: cost.throttleStatus,
      lastQueryCost: cost.requestedQueryCost ?? 0,
      observedAtMs: Date.now(),
    });
  }
}
