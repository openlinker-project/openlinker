# Implementation Plan: Erli Marketplace — E2E Verification + Operator Documentation

**Date**: 2026-06-24
**Status**: Draft / Ready for Review
**Estimated Effort**: 1.5–2.5 days (gated by Erli sandbox order availability)

---

## 1. Task Summary

**Objective**: Produce three deliverables on one branch / one PR:

1. **Operator documentation** for Erli — what to configure *on the Erli side* (sandbox/seller panel: API key, webhook prerequisites) and the *OpenLinker click-through* (add connection → test → install webhooks → create offer → observe stock & orders).
2. **A manual E2E verification run** against the live Erli **sandbox** (`https://sandbox.erli.dev/svc/shop-api`), with **screenshots** at each capturable stage, explicitly verifying: connection setup, offer creation, **stock-change propagation**, and **order ingestion** (webhook + inbox-poll backstop).
3. **Automated tests** covering the verified flows (extend the existing Erli vertical-slice int-specs; optionally add a Playwright screenshot script).

**Context**: All Erli code is already merged to `main` (plugin registered in `apps/api` + `apps/worker`; backend adapters + FE connection/offer UI present). The closed PRs (#1064 connection-fe, #1078 mapper, #1079 order-source, #1080 buyer-identity) were superseded — their code reached `main` via other PRs. No frankenbranch merge is needed; this branch is cut from `main`. Deferred follow-ups **#1066** (frozen-stock hot path) and **#1065** (variant-group populator) are **out of scope**.

**Classification**: Documentation + Testing/QA (no production-code changes expected; test-only + docs).

---

## 2. Scope & Non-Goals

### In Scope
- `docs/` operator guide for Erli onboarding + usage (Erli-side config + OL click-through + known quirks).
- Live sandbox verification of the **seller-controlled** paths: connection test (`GET /me`), webhook install (`PUT /hooks/{name}`), offer create (`POST /products/{id}` → 202), offer status read-back (`GET /products/{id}`), stock update (`PATCH /products/{id}`).
- Screenshots of every UI stage reachable in the web app.
- Order-ingestion verification **to the extent the sandbox allows** (see blocker in §5).
- Extending Erli int-specs (`apps/api/test/integration/erli/*`) for any gap surfaced during the run.
- Optional: a Playwright screenshot script under `apps/web` (devDependency) to make the capture repeatable.

### Out of Scope
- #1066 frozen-stock hot-path honoring; #1065 variant-group populator.
- Any change to the Erli adapter's production behavior.
- A PrestaShop master integration build-out (we *use* an existing PS connection if present; we do not build one).
- Generated-types / Swagger codegen.

### Constraints
- **Resource-constrained PC** — no full-repo test runs; scope every test command to a file/pattern; `--no-verify` allowed on commits; small agent batches. Docker is up but integration tests are slow.
- Single branch, single PR with the plan + docs + tests (no separate plan PR).
- All PR/issue comments in English.

---

## 3. Architecture Mapping

**Target Layer**: Documentation (`docs/`) + Testing (`apps/api/test/integration/erli/`, optionally `apps/web/e2e/`). No CORE or Integration runtime change.

**Capabilities exercised** (read-only, for verification): `OfferManagerPort` + `OfferCreator` / `OfferStatusReader` / `OfferFieldUpdater` / `OfferStockRestorer`; `OrderSourcePort`; `ConnectionTesterPort`; `WebhookProvisioningPort`; `WebhookEventTranslator`; core `OrderIngestionService`, `InventorySyncService`, `InventoryService` → `inventory.propagateToMarketplaces`.

**Existing components reused**:
- Adapters: `ErliOfferManagerAdapter`, `ErliOrderSourceAdapter`, `ErliConnectionTesterAdapter`, `ErliWebhookProvisioningAdapter`, `ErliWebhookEventTranslator`, scheduler tasks (`erli-orders-poll`, `erli-offer-status-sync`).
- Test harness: `ErliFakeHttpClient` + `installErliOffersHarness` / `erli-test-order-source.helper.ts` (`apps/api/test/integration/helpers/`).
- FE: `/connections/new/erli` setup page; `erli-create-offer-wizard.tsx` launched from the Listings page via `OfferCreationLauncher`.

**Core vs Integration justification**: Pure docs + tests; no boundary touched. New tests live in the host app's integration suite (where the real adapter + fake HTTP client are wired), matching the established Erli int-spec pattern (#991).

---

## 4. External / Domain Research (confirmed)

### Erli Sandbox API (`docs/architecture/adrs/erli-sandbox-swagger.json`, server `https://sandbox.erli.dev/svc/shop-api`)
- **Auth**: static bearer `apiKey` (ADR-025). Identity probe: `GET /me`.
- **Offers** = products: `POST /products/{externalId}` (create, **202 async**, ~20-min cache lag — read-after-write lies), `PATCH /products/{externalId}` (sparse update incl. `stock`), `GET /products/{externalId}` (status + `frozen` fields). Create body requires `name`, ≥1 https `images`, `price` (grosze), `stock`, `dispatchTime`; category optional (`externalCategories` source `allegro` → `shop` → omitted).
- **Webhooks**: `PUT /hooks/{hookName}` registers `{ url: <callbackBaseUrl>/webhooks/erli/<connectionId> }`. Fire-once, 5 s timeout, **no retry** → poll is the correctness backstop.
- **Orders**: `POST /orders/_search` (read/list), `GET /orders/{id}`, `PATCH /orders/{id}/status`. **No order-creation verb.** `GET /inbox` (≤500 unread, top-level array) + `POST /inbox/mark-read`. **No way to inject an inbox message or create an order via API** — see §5 blocker.

### OL flow mechanics (confirmed in code)
- **Connection config** (`erli-connection.types.ts`): `baseUrl` (set to `https://sandbox.erli.dev/svc/shop-api` for sandbox), `defaultDispatchTime` (required for offer create unless per-offer override), `callbackBaseUrl` (required for webhook install; dev = `http://host.docker.internal:3000`). Credentials: `{ apiKey }`.
- **Order ingestion**: webhook → `POST /webhooks/erli/{connectionId}` → `ErliWebhookEventTranslator` → core `InboundRoutingPolicy` → `marketplace.order.sync` job → `OrderIngestionService.syncOrderFromSource`. Poll backstop: scheduler `erli-orders-poll` (`*/5 * * * *`, job `marketplace.orders.poll`, cursor `erli.orders.inboxCursor`) → `ingestOrders` → `listOrderFeed` (reads `GET /inbox`). Both converge idempotently on one order record per `externalOrderId`.
- **Stock propagation** (event-driven, no cron): master `InventoryService.setInventory()` → enqueues `inventory.propagateToMarketplaces` → `InventoryPropagateToMarketplacesHandler` resolves Offer mappings → enqueues `marketplace.offerQuantity.update` per mapping → `MarketplaceOfferQuantityUpdateHandler` → core `InventorySyncService.updateOfferQuantity` → `ErliOfferManagerAdapter.updateOfferQuantity` → `PATCH /products/{id} { stock }`.
- **Offer status recon**: scheduler `erli-offer-status-sync` (`0 * * * *`, job `marketplace.offer.statusSync`, cursor `erli.offerStatus.scanOffset`, page 50) → `OfferStatusReader.getOfferStatus` → `GET /products/{id}` → `offer_status_snapshots`. **Opt-in** via `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=true`.

### Env / boot (confirmed)
- Servers: `pnpm dev:stack:up` (postgres, redis, mysql, phpmyadmin, prestashop, woocommerce), `pnpm start:dev:api` (:3000), `pnpm start:dev:worker`, `pnpm start:dev:web` (**:4173**, per `apps/web/vite.config.ts`).
- Auth: bootstrap admin seeded on API boot — `admin` / `admin` in dev (`bootstrap-admin.service.ts`). Login at `/login`.
- Scheduler opt-ins: `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED=true`, `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=true` (set in `apps/worker/.env.local`).
- Screenshots: **no browser-automation tool installed** (no Playwright/Puppeteer/Cypress). Either add Playwright as an `apps/web` devDependency for a scripted run, or capture manually.

---

## 5. Questions & Assumptions

### 🔴 BLOCKER — Order trigger in sandbox
The Erli sandbox exposes **no order-creation API**. An order can enter OL only if a **buyer places it on the Erli sandbox marketplace** (or Erli support pre-seeds one). Therefore the live order-ingestion E2E has three possible modes, decided with the user:
- **(A) Buyer-placed sandbox order** — user/Erli places a real test order on the connected sandbox account; we verify webhook + poll ingest it. Full fidelity.
- **(B) Pre-existing sandbox orders** — if the sandbox account already has orders, `POST /orders/_search` / `GET /inbox` surface them; we verify the poll ingests an existing one (no new purchase needed).
- **(C) Int-spec only** — order-ingest correctness verified via `ErliFakeHttpClient` (scripted inbox + order payloads), with the live run documenting the *expected* sequence. Lowest fidelity but unblocked today.

**Assumption**: default to **(B) then (C)** — probe the live sandbox for existing orders/inbox messages first; if none, fall back to the fake-HTTP int-spec for correctness and document the manual buyer step. Escalate to (A) only if the user can place a sandbox order.

### Other open questions / assumptions
- **Stock-propagation E2E needs a master + Offer mapping.** The trigger is a *master inventory change*, which requires a master (PrestaShop) connection with a product mapped to the Erli offer. **Assumption**: if no such mapping exists in the dev DB, verify the propagation chain at the **handler/adapter layer** (drive `marketplace.offerQuantity.update` directly, or `InventorySyncService.updateOfferQuantity`) and assert the resulting `PATCH /products/{id} {stock}` — rather than building a PS master. The live UI screenshot then shows the offer's stock value via `GET`/status snapshot.
- **Screenshots**: **Assumption** — add Playwright as an `apps/web` devDependency and a small script `apps/web/e2e/erli-walkthrough.spec.ts` for a repeatable capture; fall back to manual DevTools screenshots if the browser download is too heavy for the PC.
- **Web port**: code says **4173** (CLAUDE.md says 5173 — stale); verify at runtime.
- **Erli is "added and logged in"** per the user — assume a sandbox connection may already exist; reconcile with the add-connection step (reuse vs create fresh).

### Documentation gaps
- No prior operator/onboarding doc for Erli exists (only dev specs/ADR/plans). This plan creates the first.

---

## 6. Proposed Implementation Plan

### Phase 0 — Branch & environment bring-up
**Goal**: Running stack reachable; admin login works.
1. **Branch** — `erli-e2e-verification-and-operator-docs` off `origin/main` (done).
2. **Env files** — ensure `apps/api/.env.local` + `apps/worker/.env.local` exist with DB/Redis/JWT/`OL_PII_HASH_SALT`; add to worker env: `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED=true`, `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=true`. **Acceptance**: `pnpm --filter @openlinker/api migration:show` clean; API boots.
3. **Boot** — `pnpm dev:stack:up`; `pnpm start:dev:api`; `pnpm start:dev:worker`; `pnpm start:dev:web` (each backgrounded). **Acceptance**: `GET :3000/health` ok; web reachable on :4173; login `admin`/`admin` succeeds.

### Phase 1 — Erli-side prerequisites (documented as we go)
**Goal**: Capture exactly what must exist on the Erli sandbox for each flow.
1. Confirm sandbox login (`sandbox@openlinker.io`) and locate the **API key** in the seller panel. **Acceptance**: key obtained; `GET /me` via the OL connection test returns 2xx.
2. Note webhook prerequisites (callback URL reachability — `host.docker.internal:3000` from the worker/api container, or a tunnel if Erli must reach a public URL). **Acceptance**: documented; webhook install returns success or a clear, documented limitation (sandbox may not deliver webhooks to a localhost callback — poll then becomes the only path).
3. Probe for existing orders: `POST /orders/_search` + `GET /inbox` (via the running adapter or a one-off authed curl). **Acceptance**: record whether any order exists (decides §5 mode B vs C).

### Phase 2 — Connection setup (UI) + screenshots
**Goal**: Add/verify the Erli connection through the web UI.
1. `/connections/new` → **Erli** card → `/connections/new/erli`. Enter API key; set `config.baseUrl = https://sandbox.erli.dev/svc/shop-api`, `defaultDispatchTime`, `callbackBaseUrl`. **Screenshot**: platform picker, Erli setup form, post-create detail page.
2. **Test connection** action → `GET /me`. **Screenshot**: success state. **Acceptance**: connection Active.
3. **Install webhooks** action (if exposed) → `PUT /hooks/orderCreated` + `/hooks/orderStatusChanged`. **Screenshot**: result/warning. **Acceptance**: success or documented localhost limitation.

### Phase 3 — Offer creation (UI) + screenshots
**Goal**: List an offer on the sandbox and observe its lifecycle.
1. Listings page → launch **Erli offer wizard**; pick a variant (needs a product with EAN + ≥1 image in OL — note prerequisite), set price/stock/dispatch time. Submit. **Screenshots**: each wizard step, review, success toast. **Acceptance**: `POST /products/{id}` → 202; OL records `OfferCreationRecord` (draft).
2. Trigger / await **offer-status reconciliation** (`erli-offer-status-sync`) → `GET /products/{id}`. **Screenshot**: listing detail / status snapshot showing live status. **Acceptance**: `offer_status_snapshots` row written; status reflects Erli.

### Phase 4 — Stock-change verification
**Goal**: Prove a stock change reaches the Erli offer.
- **If a master mapping exists**: change master inventory → observe `inventory.propagateToMarketplaces` → `marketplace.offerQuantity.update` → `PATCH /products/{id} {stock}`; confirm new stock via `GET`. **Screenshot**: before/after stock in UI + worker logs.
- **Else (assumption path)**: drive `InventorySyncService.updateOfferQuantity` (or enqueue `marketplace.offerQuantity.update`) for the mapped Erli offer; assert the `PATCH` and the post-update `GET`. **Acceptance**: Erli offer stock changes to the pushed value.

### Phase 5 — Order ingestion verification (per §5 mode)
**Goal**: Prove an order ingests (webhook + poll), to the fidelity the sandbox allows.
- **Mode B** (existing order): let `erli-orders-poll` run (or trigger `ingestOrders`) → order appears in OL Orders. **Screenshot**: Orders list/detail.
- **Mode A** (buyer-placed): same, after the user places a sandbox order.
- **Mode C** (fallback): rely on int-spec (Phase 6) and document the expected live sequence.
- **Acceptance**: one `OrderRecord` per `externalOrderId`; webhook + poll converge (no duplicate). Document the path actually exercised.

### Phase 6 — Tests
**Goal**: Lock in the verified behavior; fill any gap found.
1. Review existing `apps/api/test/integration/erli/erli-orders-vertical-slice.int-spec.ts` and `erli-offers-vertical-slice.int-spec.ts`; add scenarios for anything exercised live but untested (e.g. stock-push end-to-end via the handler, webhook+poll convergence edge, status-recon snapshot write). **Run scoped**: `pnpm --filter @openlinker/api test:integration erli`. **Acceptance**: green, no new lint/type errors.
2. **(Optional)** Playwright: add `@playwright/test` devDependency to `apps/web`, `apps/web/playwright.config.ts`, and `apps/web/e2e/erli-walkthrough.spec.ts` that logs in and screenshots the connection + offer flow into `docs/assets/erli/`. **Acceptance**: `pnpm --filter @openlinker/web exec playwright test` produces the screenshots.

### Phase 7 — Documentation
**Goal**: The operator guide.
1. Write `docs/erli-operator-guide.md` (or `docs/integrations/erli-setup.md`): Erli-side setup (API key location, sandbox account, webhook/callback prerequisites + localhost caveat), OL click-through (add connection with the exact config fields, test, install webhooks, create offer, observe stock & orders), embedded screenshots from `docs/assets/erli/`, and the **known quirks** box (202 async ~20-min lag, no read-after-write, no webhook retry/5 s, stock not auto-restored on cancel, frozen fields, poll-as-backstop, opt-in scheduler env vars).
2. Cross-link from `docs/architecture/adrs/025-erli-marketplace-adapter.md` and the product spec. **Acceptance**: a new operator can follow it end-to-end without reading code.

### Phase 8 — Wrap-up
1. Scoped quality gate on changed packages only: `pnpm --filter @openlinker/api lint && pnpm --filter @openlinker/api type-check` (+ web if Playwright added). **No full-repo run.**
2. Commit with DCO (`git commit -s`), push, open PR (English body, screenshots, "How to reproduce"). One PR carries plan + docs + tests.

---

## 7. Alternatives Considered

- **Build a PrestaShop master + product mapping to drive the real stock-propagation cron path.** Rejected for scope — heavy setup; the handler-level drive proves the same chain. Revisit if a PS mapping already exists in the dev DB.
- **Mock the sandbox entirely (int-spec only, no live run).** Rejected as the *primary* approach — the user explicitly wants a live click-through with screenshots; but retained as the **fallback** for the order path that the sandbox can't trigger.
- **Manual DevTools screenshots only (no Playwright).** Viable and lightest; chosen as fallback. Playwright preferred when repeatability matters and the PC can afford the browser download.

---

## 8. Validation & Risks

- **Architecture compliance** ✅ — docs + tests only; no boundary touched.
- **Naming/structure** ✅ — int-specs follow `*.int-spec.ts` under `apps/api/test/integration/erli/`; docs under `docs/`.
- **Risks**:
  - **Order trigger (🔴)** — sandbox may have no orders and no way to create one → order E2E degrades to int-spec + documented manual step. Mitigation: §5 modes A/B/C.
  - **Webhook delivery to localhost** — Erli sandbox may not reach `host.docker.internal`/localhost → webhook leg unverifiable live; poll is the backstop and is verifiable. Mitigation: document; optionally use a tunnel (ngrok) if the user wants the webhook leg proven.
  - **Offer create prerequisites** — needs an OL product/variant with EAN + ≥1 https image; absent → wizard blocks. Mitigation: seed/select a suitable product first.
  - **202 async lag** — created offer won't read back immediately; recon is the truth source. Mitigation: document; don't assert read-after-write.
  - **Resource limits** — scope all test/lint to package + pattern; background long server processes; avoid `pnpm -r`.
- **Backward compatibility** ✅ — no runtime change.

---

## 9. Testing Strategy & Acceptance Criteria

- **Integration tests** (`apps/api/test/integration/erli/*.int-spec.ts`, real adapter + `ErliFakeHttpClient`): offer create body shape + 202→draft; sparse PATCH incl. frozen suppression; **stock push** `PATCH {stock}` via the quantity-update path; status-recon snapshot write; **order ingest** via scripted inbox + webhook→poll convergence (one record). Run scoped: `pnpm --filter @openlinker/api test:integration erli`.
- **Optional FE screenshot script** (`apps/web/e2e/erli-walkthrough.spec.ts`): login → connection → offer wizard captures.
- **Manual/live acceptance**:
  - [ ] Erli connection added via UI, **Test connection** green (`GET /me`).
  - [ ] Webhook install succeeds (or localhost limitation documented).
  - [ ] Offer created via wizard → 202 → recon shows live status.
  - [ ] Stock change reaches Erli (`PATCH {stock}` + post-`GET` confirms).
  - [ ] Order ingested (mode A/B) **or** int-spec covers it + manual step documented (mode C).
  - [ ] Screenshots captured for every reachable stage.
  - [ ] `docs/erli-operator-guide.md` lets a new operator complete setup unaided.

---

## 10. Alignment Checklist
- [x] Follows hexagonal architecture (no boundary touched)
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (existing int-spec harness, FE plugin flow)
- [x] Idempotency considered (order convergence; idempotency keys on offer create / quantity update)
- [x] Event-driven patterns acknowledged (inventory propagate; webhook→job; poll)
- [x] Rate limits & retries acknowledged (429 handling in tester/client; webhook no-retry → poll)
- [x] Error handling comprehensive (fail-closed offer create; documented quirks)
- [x] Testing strategy complete (scoped int-specs + optional Playwright)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready (pending §5 order-mode decision)
- [x] Plan saved as markdown

---

## Related Documentation
- [ADR-025 — Erli marketplace adapter](./architecture/adrs/025-erli-marketplace-adapter.md)
- [Product spec #978 — Erli marketplace integration](./specs/product-spec-978-erli-marketplace-integration.md)
- [Erli sandbox swagger](./architecture/adrs/erli-sandbox-swagger.json)
- [Architecture Overview](../architecture-overview.md) · [Engineering Standards](../engineering-standards.md) · [Testing Guide](../testing-guide.md)
