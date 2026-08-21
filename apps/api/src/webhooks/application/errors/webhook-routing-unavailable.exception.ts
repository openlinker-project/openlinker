/**
 * Webhook Routing Unavailable Exception
 *
 * A TRANSIENT failure while resolving a verified webhook to its sync job
 * (#2280) — a connection read that failed, an adapter registry lookup that
 * threw, anything that is not a deterministic configuration fault.
 *
 * It exists to keep "retry me" distinguishable at the HTTP boundary. Once
 * routing moved onto the request path, an un-typed rethrow fell through the
 * controller's legacy message matcher, and a message containing "not found"
 * (e.g. `AdapterNotFoundException`'s `Adapter not found: {adapterKey}`) mapped
 * to **404** — which marketplaces treat as permanent and commonly answer by
 * tearing down the webhook subscription. This maps to 503 instead, which is
 * what the source needs to hear to try again.
 *
 * A DETERMINISTIC fault is not this: it resolves to `unroutable`, which is
 * recorded durably as a `deadlettered` delivery and answered 202.
 *
 * @module apps/api/src/webhooks/application/errors
 */
export class WebhookRoutingUnavailableException extends Error {
  constructor(
    public readonly provider: string,
    public readonly connectionId: string,
    public readonly cause: unknown
  ) {
    super(
      `Webhook routing temporarily unavailable for provider=${provider}, connectionId=${connectionId}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = 'WebhookRoutingUnavailableException';
    Error.captureStackTrace(this, this.constructor);
  }
}
