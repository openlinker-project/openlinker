# ADR-047: Streamed per-variant progress for long marketplace fan-outs

- **Status**: Proposed
- **Date**: 2026-08-20
- **Authors**: @norbert-kulus-blockydevs

## Context

The bulk publish wizard's Resolve step matches every selected variant's EAN to a marketplace category. Allegro exposes no bulk GTIN lookup, so `resolveCategoriesForBatchByEan` issues **one `GET /sale/products?phrase={ean}&mode=GTIN` per variant** at a fixed in-flight cap of 3. Measured against the real util with a latency-injecting fake HTTP client: wall time is `ceil(n / 3) * per-call latency` to within 1%, one call per item, max in-flight 3.

`POST .../categories/resolve-batch` then answers all-or-nothing, so the browser observes nothing between "sent" and "answered". Driving the real wizard (`apps/e2e/tests/perf/bulk-resolve-latency.spec.ts`) shows what that costs an operator:

| batch | per-call latency | total | longest unchanged screen | outcome |
|---|---|---|---|---|
| 45 variants | 600 ms | 9.5 s | **8.9 s** | Review |
| 120 variants | 600 ms | 10.4 s | 5.8 s | Review |
| 50 variants | 1 900 ms | **127.5 s** | **127.0 s** | error |

Two aggravating facts. The step's counter counts *chunks*, and half of them are instant availability reads, so `1 of 2` means `0 of 1`. And nothing on that screen animates: it renders `loading-state__spinner`, a class with no CSS anywhere in `apps/web`.

A chunk is capped at 50 variants, so it crosses the SPA's 30 s request timeout at roughly **1.76 s per marketplace call** — independent of how many products were selected. Past that, `shouldRetryTransient` re-runs the whole chunk three more times: four attempts, all abandoned at 30 s, 200 lookups spent for zero delivered results, and the server never learns the client left.

## Decision

Report resolution progress **per variant, over a streamed response**. The contract is a new core sub-capability (`EanCategoryMatcherStreaming`) alongside the existing `EanCategoryMatcher`; the transport is **NDJSON over POST** with a mandatory terminal line; an adapter that cannot stream degrades to the batch path.

Retry is narrowed rather than removed: while **no** event has been delivered, retry (that is the #1709 cold-start case); once events are flowing, resume the unresolved variants and never restart the chunk.

## Alternatives considered

- **SSE via Nest's `@Sse()`**: rejected — it registers a GET route, and 120 `{variantId, ean}` pairs do not fit a query string, so it needs a POST/GET handshake. Decisively, `EventSource` cannot set `Authorization: Bearer`, so the client reads the body with `fetch` regardless — at which point the SSE framing buys nothing over one JSON object per line.
- **Smaller chunk size**: rejected — the counter ticks more often, but chunk count rises and so does concurrent marketplace load (`3 x chunks`), moving the batch toward 429s. Treats the symptom and worsens the cause.
- **A DB-backed job polled like the #741 bulk-batch progress page**: rejected — survives a page reload, but adds a table, a job type and a handler for an operation that lasts ~10 s and has no value once finished.
- **Keep the batch call, estimate client-side** (elapsed timer + expected range): rejected as the primary fix — no backend change, but it cannot name the product in flight, cannot count resolved variants, and does not remove the 30 s cliff. Kept as the fallback rendering for a destination that does not stream.
- **Raise the client timeout**: rejected — moves the cliff instead of removing it, and lengthens the time to the first honest error.
- **Change `EanCategoryMatcher` itself to an `AsyncIterable`**: rejected — a breaking shape change for every existing call site and adapter, to gain nothing a sibling capability does not give (ADR-002 composition is the established pattern).

## Consequences

**Pros:**
- Progress advances tens of times per batch instead of two or three, and names the product in flight.
- The 30 s cliff disappears: there is no single long request to abandon, so the four-attempt amplification cannot occur.
- Cancellation becomes expressible — a disconnect can stop scheduling further marketplace work. Today there is nothing to cancel.
- A destination that borrows a taxonomy can reuse an owner's matcher (#2210), so Erli gains category detection it never had.

**Cons / trade-offs:**
- **First streaming endpoint in the repo** (`grep -r '@Sse|text/event-stream|ReadableStream' apps/api apps/web` returns nothing), so framing and teardown must be tested rather than assumed.
- A reverse proxy in front of the API must not buffer. `apps/web/nginx.conf` serves only the SPA and does not proxy `/v1`, but a deployment that does needs buffering off.
- **Cancellation is coarse.** `AllegroHttpClient` builds its own `AbortController` per request and accepts no external signal, so up to 3 in-flight calls finish and their results are discarded. Threading a signal to the client is a separate change.
- Two response shapes for one question (batch and stream) until every consumer moves.

**Migration path:**
- The batch route and method stay. The streaming method is additive, advertised per adapter, and the core service falls back when it is absent.

## Appendix: Allegro application tokens cannot search the catalogue

Probed live against the Allegro sandbox on 2026-08-19, because the cheaper design for #2210 would have been to let Erli match EANs with the Allegro **application** credentials it may already hold (#1382 / [ADR-031](./031-erli-allegro-category-catalog-via-client-credentials.md)).

With a `grant_type=client_credentials` token: `/sale/categories`, `/sale/categories/{id}`, `/sale/categories/{id}/parameters`, `/sale/categories/{id}/product-parameters`, `/sale/category-events`, `/sale/matching-categories`, `/sale/delivery-methods` and `/order/carriers` all answer **200**. But `GET /sale/products?phrase={ean}` answers **403 `AccessDeniedException`** — with and without `mode=GTIN` — even though the token carries `allegro:api:sale:offers:read`. `/sale/offers`, `/sale/offer-events` and `/offers/listing` are also 403. `GET /sale/products/{ean}?idType=GTIN` answers **404 `ProductNotFound`** for every EAN tried, including nine with live sandbox offers, so it could not be shown to work either.

Scope is not the gate; seller context is. The catalogue search therefore requires a seller connection, which is why #2210 borrows one instead of using application credentials.

## References

- Related issues: #2205 (epic), #2206, #2207, #2208, #2209, #2210, #2211, #2212, #1709 (why retry exists), #1934 (per-connection capability gate), #1522 (mapping fallback), #741 (polled batch progress)
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md), [ADR-025](./025-erli-marketplace-adapter.md), [ADR-031](./031-erli-allegro-category-catalog-via-client-credentials.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Listings (Offers)
