# Implementation Plan — Erli orders-half corrections (#992 spike fallout)

**Status:** ready to execute
**Author:** spike #992 follow-up
**Date:** 2026-06-17
**Source of truth:** `~/erli-992-spike-findings.md` + `docs/architecture/adrs/erli-sandbox-swagger.json` (authoritative OpenAPI pulled from the live sandbox).

---

## 1. Context

The #992 sandbox spike confirmed the real Erli Shop API contract. Outcome:

- **Offers-half PRs (#1056, #1058, #1060–#1063, #1077 — issues #981, #984, #985, #986, #988, #989, #991) match the real API and are good to go.** Do **not** touch their implementation.
- **Orders-half PRs need correction against the real contract before merge/go-live**: the `getOrder`/mapper/inbox/identity/webhook/writeback layers were built on provisional (wrong) wire shapes.
- **The connection-tester probe (#982) also needs correction** — it sits in the offers-half stack region but is a tester concern resolved by the spike.

This plan fixes **each problem on the branch/PR that actually owns that implementation**, then rebases the stack so the fixes propagate consistently and the combined tip stays testable end-to-end.

---

## 2. Fix matrix — what, where, exact delta

Each row = one fix on the branch that owns it. Deltas are from `~/erli-992-spike-findings.md`.

### FIX-982 — connection probe path  ·  branch `982-erli-connection-auth-validators-tester` · PR #1057
- **File:** `libs/integrations/erli/src/infrastructure/adapters/erli-connection-tester.adapter.ts`
- **Delta:** probe `GET /offers?limit=1` → **`GET /me`** (`/offers` does not exist; `/me` is the cheap authed identity endpoint, returns 200 with valid key, 401 otherwise).
- **Tests:** `erli-connection-tester.adapter.spec.ts` — update probe-path + success-message assertions.
- **Note:** the local e2e branch already uses `/delivery/priceLists` as a stop-gap; the **canonical** fix is `/me`. Align both to `/me`.

### FIX-994 — order → IncomingOrder mapper  ·  branch `994-erli-order-mapper` · PR #1078  ·  **largest change**
- **Files:** `erli-order.types.ts`, `erli-order.mapper.ts` (+ `*.spec.ts`)
- **Deltas:**
  - Buyer container `buyer` → **`user`** (`{ email, deliveryAddress, invoiceAddress }`); no `buyer.id`.
  - `lineItems` → **`items`** (`{ id, externalId, quantity, weight, unitPrice, unitPriceBeforeRebate, name, slug, ean, sku, taxRate }`).
  - **MONEY = INTEGER minor units (grosze)** — `unitPrice`, `unitPriceBeforeRebate`, `totalPrice`, `delivery.price` are integers. **Drop the decimal `price.amount` + currency-rounding logic** (overturns PR1078-TECH-02). Divide by 100 at the boundary, or keep minor units end-to-end. No `currency` field (PLN-only).
  - **COD** = `delivery.cod` **boolean** (not `paymentMethod: 'cod'|'payu'`).
  - `status` enum gains **`returned`** → `[pending, purchased, cancelled, returned]`.
  - **Address remap:** `firstName, lastName, companyName, address, street, buildingNumber, flatNumber, zip, city, country, phone` — i.e. `zip` (not `postalCode`), `country` (not `countryCode`), `buildingNumber`/`flatNumber` (not `street2`), **no `region`**.
  - Drop assumed top-level `subtotal`/`tax`/`shipping`/`orderNumber`/`placedAt`/`createdAt` (inbox payload carries `created`/`updated`).

### FIX-993 — inbox poll feed  ·  branch `993-erli-order-source` · PR #1079  (sits **above** 994 in the stack)
- **Files:** `erli-inbox.types.ts`, `erli-order-source.adapter.ts` (+ `*.spec.ts`)
- **Deltas:**
  - `GET /inbox` returns a **top-level ARRAY**, not `{ messages: [...] }`. Parse `response.data` directly.
  - Inbox message shape: `{ id, shopId, created, read, type, payload }`. Order id is **`payload.id` / `payload.externalOrderId`** (not top-level `orderId`); timestamp is **`created`** (not `occurredAt`).
  - **Ack = `POST /inbox/mark-read` `{ lastMessageId }`** (single mark-up-to-id call) — not per-message `PATCH /inbox/{id}`. Resolves PR1079-TECH-02 (serial-ack latency).
  - IDs are **24-char Mongo ObjectIds** (time-ordered, lexicographically sortable) → cursor comparison = **plain string compare**; **remove the numeric zero-pad** (`toCursor`).
  - `type` enum = `orderCreated, orderStatusChanged, productsNeedSync`. Order-event filter on first two is correct; cursor-starvation guard (PR1079-TECH-01) must still advance past `productsNeedSync`.
  - Remove the unsupported `limit` query param on `GET /inbox`.
  - **Optimisation (optional):** the inbox `payload` IS the full order → `getOrder` could read it directly and skip the extra `GET /orders/{id}` round-trip. Keep as a follow-up; not required for correctness.

### FIX-995 — buyer identity  ·  branch `995-erli-buyer-identity` · PR #1080
- **File:** `erli-email-normalizer.adapter.ts` (+ identity wiring/spec)
- **Delta:** identity keys on **`user.email`** (plain string, no Allegro-style `+tag` relay, no `buyer.id`) → email_fallback mode only. **Live re-check** whether sandbox/prod returns a real email or a relay alias once a test order exists.

### FIX-996 — webhook provisioning  ·  branch `996-erli-webhooks` · PR #1081
- **Files:** `erli-webhook-provisioning.adapter.ts`, `erli-webhook.types.ts`, `erli-webhook-event-translator.adapter.ts` (+ specs)
- **Delta:** replace the **manual no-op provisioner** with real automation: **`PUT /hooks/{hookName}` `{ url, accessToken }`**, plus `GET /hooks` / `DELETE /hooks/{hookName}`. hookName enum: `checkBuyability, productsNeedSync, orderCreated, orderStatusChanged, orderSellerStatusChanged`. `accessToken` is the HMAC secret echoed on delivery → use it for the webhook signature check in the translator.

### FIX-997 — order status & fulfillment writeback  ·  branch `997-erli-writeback` · PR #1082  ·  **MAJOR**
- **Files:** `erli-fulfillment.types.ts`, `erli-order-source.adapter.ts` (`notifyDispatched`) (+ specs)
- **Deltas:**
  - Status writeback: `PATCH /orders/{id}/fulfillment {status:'dispatched'}` → **`PATCH /orders/{id}/status { status: 'sent' }`** (enum has no `dispatched`; closest is `sent`).
  - Tracking/shipment: `POST /orders/{id}/shipments` → **`POST /shipping/external { vendor, status, ... }`** (vendor + status enums). Map carrier hint → Erli `vendor` enum.

### FIX-998 — orders vertical-slice int-specs  ·  branch `998-erli-orders-int-specs` · PR #1086
- **Files:** the orders int-spec fixtures/payloads.
- **Delta:** rebuild fixtures to the real shapes (array inbox, `user`, `items`, integer money, `delivery.cod`, address fields, `mark-read` ack, `/orders/{id}/status` + `/shipping/external` writeback). These tests are the regression net for all the above.

---

## 3. True stack order (bottom → top, by commit depth over `main`)

```
981 http(9) → [980-983 skeleton/ADR — already MERGED #1019/#1059]
  → 982 tester(14)            ← FIX-982
  → 984 offer-mgr(18)         offers-half (GOOD — no impl change)
  → 985 category(23)
  → 988 stock-frozen(27)      (988 is BELOW 986 — inversion vs issue #)
  → 986 variant-group(29)
  → 989 offer-status(32)
  → 1066 frozen-stock(35)
  → 1065 variant-populator(37)
  → 991 offers-int-specs(39)
  → 994 order-mapper(41)      ← FIX-994   (994 is BELOW 993 — inversion vs issue #)
  → 993 order-source(43)      ← FIX-993
  → 995 buyer-identity(44)    ← FIX-995
  → 996 webhooks(45)          ← FIX-996
  → 997 writeback(47)         ← FIX-997
  → 998 orders-int-specs(48)  ← FIX-998
```
`990-erli-connection-fe` (4) is a **separate branch off main** (FE only) — not in this stack; handled independently (already cherry-picked onto the local e2e branch).

---

## 4. Rebase strategy

The branches are git-stacked but every PR targets `main`. Two rebase obligations:

**(a) Stack consistency (local, for E2E testing now).** Because FIX-982 sits *below* the whole offers-half, a fix there must be followed by a cascade rebase of every branch above it so the tip (`998`) contains all corrections. The probe fix touches one isolated file the offers-half never edits → the offers-half rebase is **mechanical / conflict-free**. The orders-half fixes (994→998) cascade only among themselves.

**(b) Merge-time (landing to main).** PRs land bottom-up; each branch is **rebased onto `main` after the previous PR merges**, so each fix reaches `main` exactly once and downstream PRs pick it up via the rebase-onto-main. No PR above a fix may merge before the fixed PR, or `main` would capture the old shape (squash-merge carries the cumulative stacked diff).

### Cascade points (where each rebase is required)
- After **FIX-982**: rebase `984 → 985 → 988 → 986 → 989 → 1066 → 1065 → 991 → 994 → 993 → 995 → 996 → 997 → 998`.
- After **FIX-994**: rebase `993 → 995 → 996 → 997 → 998`.
- After **FIX-993**: rebase `995 → 996 → 997 → 998`.
- After **FIX-995**: rebase `996 → 997 → 998`.
- After **FIX-996**: rebase `997 → 998`.
- After **FIX-997**: rebase `998`.

To avoid six separate cascade passes, do **one bottom-up pass** (§5): walk the stack from `982` upward, at each branch first `git rebase` onto the (already-updated) parent, then apply that branch's fix if it has one. One walk, fixes applied in place, stack stays linear.

---

## 5. Execution sequence (single bottom-up pass, worktree per branch)

Use a worktree per branch (matches the existing workflow; keeps the running e2e stack untouched).

1. **FIX-982** on `982-...tester`: edit tester probe → `/me`, update spec. Commit (signed). Push → updates PR #1057.
2. Walk up the offers-half **rebasing only** (no impl change): for each of `984, 985, 988, 986, 989, 1066, 1065, 991` → `git rebase <updated-parent>`; expect zero conflicts (isolated file). Push each (force-with-lease) → refreshes its PR.
3. **FIX-994** on `994-order-mapper` (after rebracing onto updated `991`): apply mapper+types deltas, rewrite spec. Commit, push → PR #1078.
4. **FIX-993** on `993-order-source` (rebase onto updated `994`): apply inbox deltas, rewrite spec. Commit, push → PR #1079.
5. **FIX-995** on `995-buyer-identity` (rebase onto updated `993`): email-keyed identity. Commit, push → PR #1080.
6. **FIX-996** on `996-webhooks` (rebase onto updated `995`): automate `PUT /hooks`. Commit, push → PR #1081.
7. **FIX-997** on `997-writeback` (rebase onto updated `996`): status + `/shipping/external`. Commit, push → PR #1082.
8. **FIX-998** on `998-orders-int-specs` (rebase onto updated `997`): rebuild fixtures to real shapes; run int-specs. Commit, push → PR #1086.

**Signing:** all landed commits use `git commit -s` + GPG (repo requires verified sigs). The local e2e throwaway branch may stay unsigned.

---

## 6. Local E2E refresh after fixes

After the stack is corrected, refresh the local test branch and runtime:
1. Rebuild the combined tip: `git checkout 998-erli-orders-int-specs` (now corrected) and re-cherry-pick the FE commits (or rebase the `998-erli-e2e-fe` branch onto the updated `998`).
2. **Rebuild the integration plugin** (the worker/api watch may not pick up `libs/**` reliably): `pnpm --filter @openlinker/integrations-erli build` (and a clean `pnpm build` if dist drift is suspected).
3. **Restart api + worker** (tool-managed background) so the new adapter code is loaded.
4. Re-trigger: orders poll should parse the inbox array cleanly; create-offer should carry `images`+`dispatchTime` (note: offer-create required-field gap is an **offers-half** item — see §8).
5. Watch `/tmp/ol-logs/{api,worker}.log`.

---

## 7. Verification per layer

- Unit: `pnpm --filter @openlinker/integrations-erli test` (fast, after each fix).
- Lint/type: `pnpm lint && pnpm type-check` before each commit.
- Int-specs: `pnpm test:integration` for the orders slice after FIX-998.
- Live (needs a sandbox test order): confirm inbox `type` literal for a real order event, real `user.email` vs relay alias, and the `/shipping/external` vendor enum mapping. Re-share the sandbox key when a test order exists.

---

## 8. Risks & watch-items

- **Money minor-units (FIX-994)** overturns the PR1078 decimal+rounding work — make sure nothing downstream (order totals, FE display) assumes decimal. Grep consumers of the Erli order totals.
- **Cursor numeric→string (FIX-993)**: the core `OrderIngestionService.isCursorRegression` must stay non-regressing under plain ObjectId string compare (ObjectIds are time-ordered lexicographically — safe). Drop the zero-pad helper and its tests.
- **Webhook automation (FIX-996)** changes #996 from a no-op to a live `PUT /hooks` call — needs the connection's public callback URL; gate behind the existing provisioning flow.
- **`type` vocabulary + real email** remain **live-unverified** (sandbox was empty at spike time) — flagged in FIX-993/FIX-995; confirm against a real order before go-live.
- **Offer-create required fields (offers-half, NOT in this plan):** real `POST /products/{externalId}` requires `images*` + `dispatchTime*`; the create body only sets price/stock/name/description. This is an **#984 offer-manager** gap, separate from the orders-half. Track as its own issue against PR #1058 if create-offer is in the E2E test scope.
- **Merge ordering:** never merge a PR above a fix before the fixed PR lands on `main` (see §4b).
```
