# Implementation Plan — UX/DX Fixes Bundle (#326 + #327 + #329)

Small, independent fixes bundled into one PR:

- **#326** — Products list: render price with currency glyph (Intl.NumberFormat), muted fallback when currency is absent
- **#327** — Failed Orders page: row click-through, full internal order ID w/ tooltip, connection-name resolution, eyebrow "Operations", card subtitle cleanup
- **#329** — Bootstrap admin service: default password to `admin` in non-production, keep random fallback in production

---

## 1. Goals

One-liners per issue:

- **#326**: operators must never see a bare decimal price without currency context.
- **#327**: `/orders/failed` must be usable as a triage surface — click rows to drill in, see full IDs, see connection names, use the right eyebrow.
- **#329**: fresh dev DB + missing `OL_BOOTSTRAP_ADMIN_PASSWORD` should yield a predictable `admin` login; prod must stay secure-by-default.

## 2. Layer classification

- **#326**: FE (page composition + feature types) + BE (DTO contract only — no migration; persistence is a follow-up)
- **#327**: FE only (page composition)
- **#329**: BE only (apps/api auth bootstrap, NODE_ENV-gated)

## 3. Non-goals

- **Not** persisting `currency` on the `products` table. Requires a schema migration + repo mapping + adapter wiring; a separate follow-up issue will be opened. The DTO will expose `currency: string | null` today (always `null` for repo-sourced products) so the FE contract is ready.
- **Not** resolving connection-name in a shared hook across pages. #321 tracks that — here we inline-resolve via `useConnectionsQuery()` matching the pattern already used by `failed-orders-page`.
- **Not** changing any CSS tokens or shared UI primitives.
- **Not** changing the random-password entropy or bcrypt cost.

---

## 4. Research notes (what already exists)

- `libs/core/src/products/domain/entities/product.entity.ts:30` — `Product.currency?: string` is already on the domain entity but marked "Master-derived, not persisted on the products table".
- `libs/core/src/products/infrastructure/persistence/repositories/product.repository.ts:74-85` — `toDomain` does **not** read currency from the ORM entity.
- `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts:33` — currency is hardcoded to `'EUR'` in the adapter but discarded on upsert because the ORM entity has no currency column.
- `apps/api/src/products/http/dto/product-response.dto.ts` — no `currency` field.
- `apps/api/src/products/http/products.controller.ts:171-187` — `toProductDto` does not expose `currency`.
- `apps/web/src/features/orders/components/order-line-items-panel.tsx:20-25` — existing `formatAmount(amount, currency)` precedent: uses `Intl.NumberFormat` when currency present, formatted decimal when absent. We'll diverge slightly for products: when currency is absent, render the amount muted with a `title="Currency unknown"` — explicit, not silent.
- `apps/web/src/pages/orders/orders-list-page.tsx:198` — uses `rowHref={(order) => order.internalOrderId}` (relative). Failed-orders lives at `/orders/failed`, so relative would resolve to `/orders/failed/:id`. Use an absolute `/orders/${order.internalOrderId}` here.
- `apps/web/src/shared/ui/data-table.tsx:161-184` — `rowHref` renders a wrapping `<Link>` on the first cell and makes the row clickable. No change needed.
- `apps/api/src/auth/bootstrap-admin.service.ts:58-60,87-89` — current generator uses `randomBytes(18).toString('base64url')`.

---

## 5. Design

### 5.1 #326 — Products currency formatting

**Backend contract (minimal):**

- Add `currency: string | null` to `ProductResponseDto` (ApiPropertyOptional, nullable).
- In `ProductsController.toProductDto`, pass `currency: product.currency ?? null`. Today this is always `null` (repo doesn't persist it); contract is forward-compatible.

**Frontend types:**

- Add `currency: string | null` to `apps/web/src/features/products/api/products.types.ts:Product`.

**Frontend rendering:**

- New helper co-located with the page (private, no shared-module churn): `formatPrice(price: number | null, currency: string | null): ReactNode`.
  - `price === null` → muted em-dash (existing pattern).
  - `price !== null && currency` → `Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price)` wrapped in plain text.
  - `price !== null && !currency` → `<span className="text-muted" title="Currency unknown">{price.toFixed(2)}</span>` — muted colouring + hover-reveal + screen-reader-accessible explanation.
- Replace the price column's `cell` in `COLUMNS`.
- Replace `cardView.meta` with the same helper.

**Tests:**

- Existing test already asserts `29.99` is in the document. Update to expect `'PLN 29.99'` (or whatever `Intl` emits — match via regex or substring since browsers differ slightly in glyph).
- Add a case: product with `price` set and `currency: null` → muted element with `title="Currency unknown"` present.

### 5.2 #327 — Failed Orders UX

Five localized edits to `apps/web/src/pages/orders/failed-orders-page.tsx`:

1. `COLUMNS[0].cell` — render full `order.internalOrderId` inside `<span className="mono-text" title={order.internalOrderId}>`. Remove manual `.slice(0, 16)…`. **Not** using `EntityLabel` here: (a) this cell sits at column index 0, which `DataTable` wraps in its own `<Link>` — nesting `EntityLabel`'s internal link/copy button inside another `<a>` would emit invalid HTML; (b) the full internal ID is already the user-facing identifier for orders (no separate human name) — `EntityLabel`'s name-first design would render "Unknown" beside every ID, which is noise.
2. `COLUMNS[1].cell` — use the existing **`ConnectionEntityLabel`** primitive (`apps/web/src/features/connections/components/ConnectionEntityLabel.tsx`) with `linkToDetail={false}` (the row itself navigates to the order; we don't want a secondary jump to the connection) and `showId={true}`. This is the prescribed pattern per `frontend-ui-style-guide.md` ("used on every list row where an internal UUID would otherwise leak") and handles loading / unknown-name states natively — no manual `connectionNameById` map, no flash of raw UUID while `useConnectionsQuery()` is still resolving. `DataTable.shouldIgnoreRowClick` already skips nested anchors/buttons, so the copy button won't hijack row navigation.
3. `PageLayout.eyebrow` — change `"Orders"` → `"Operations"`.
4. `DataTable.rowHref` — add `rowHref={(order) => \`/orders/${order.internalOrderId}\`}` (absolute path because we're not at `/orders`).
5. `cardView.title` — drop the manual `.slice`, use full internal order id. `cardView.subtitle` — use `ConnectionEntityLabel` followed by the item count, so mobile cards match the table's connection resolution.

**Tests** (`failed-orders-page.test.tsx`):

- Add case: row anchor links to `/orders/<internalOrderId>` (query by `role=link, name: /ol_order_aabbccdd.../` and assert `href`).
- Add case: connection name renders when `connections.list` returns a matching connection; falls back to mono-text ID otherwise.
- Update existing "shows table" expectation so it checks the full order ID text (not the chopped `ol_order_aabbccd` substring).
- Assert `eyebrow="Operations"` is rendered (via `data-eyebrow` or just the literal text if `PageLayout` renders it).

### 5.3 #329 — Bootstrap admin default password

Change `BootstrapAdminService.bootstrap()`:

- After `providedPassword` read, compute:
  ```ts
  const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';
  const fallbackPassword = isProduction ? this.generatePassword() : 'admin';
  const password = providedPassword ?? fallbackPassword;
  const passwordSource: 'provided' | 'default-admin' | 'generated' =
    providedPassword ? 'provided' : isProduction ? 'generated' : 'default-admin';
  ```
  `ConfigService.get(key, defaultValue)` is the idiom already used elsewhere in this file (see line 41 / 46); reuse it for consistency.
- Adjust the log branching:
  - `passwordSource === 'provided'` → current log (unchanged copy).
  - Otherwise → `logBootstrapBanner(username, password, passwordSource)` with a `source` parameter branching the banner copy internally. A single banner method keeps warning wording in lock-step and avoids drift between two near-identical private methods.
  - `generated` copy: current message (random password, store it now).
  - `default-admin` copy: distinct wording calling out the literal `admin` password + reminder that `OL_BOOTSTRAP_ADMIN_PASSWORD` must be set (or `OL_BOOTSTRAP_ADMIN_ENABLED=false`) for non-dev environments.
- Update file-header JSDoc (lines 12-13) to describe the new behaviour.

**Tests** (`bootstrap-admin.service.spec.ts`):

- Update existing "seeds an admin and logs a generated password when none is provided" → split into two:
  - non-prod default (no `NODE_ENV` or any non-`production`): seeds `admin`, logs a distinct default-admin banner.
  - prod default (`NODE_ENV=production`): keeps random behaviour (current assertions).
- Existing "provided password wins" stays unchanged.
- Existing "skips when disabled", "skips when exists", concurrency/rethrow tests all stay unchanged.

---

## 6. Step-by-step implementation

### Step 1 — #326 BE DTO contract

- File: `apps/api/src/products/http/dto/product-response.dto.ts`
  - Add `@ApiPropertyOptional({ nullable: true, description: 'ISO 4217 currency code' })` + `currency!: string | null;`
- File: `apps/api/src/products/http/products.controller.ts`
  - `toProductDto` → add `currency: product.currency ?? null,`
- File: `apps/api/src/products/http/products.controller.spec.ts`
  - If the fixture asserts the full DTO shape, add `currency: null` expectation. Otherwise, no-op.

**Acceptance:** `pnpm lint && pnpm type-check` passes. The DTO JSON now includes `"currency": null` (today).

### Step 2 — #326 FE type

- File: `apps/web/src/features/products/api/products.types.ts`
  - Add `currency: string | null;` to `Product`.

**Acceptance:** type-check passes in `apps/web`.

### Step 3 — #326 FE rendering

- File: `apps/web/src/pages/products/products-list-page.tsx`
  - Add private helper `formatPrice(price, currency)` returning `ReactNode`.
  - Replace `cell` for price column.
  - Replace `cardView.meta`.

**Acceptance:** manually eyeball the page in dev mode; tests updated below.

### Step 4 — #326 FE tests

- File: `apps/web/src/pages/products/products-list-page.test.tsx`
  - Add `currency: 'PLN'` to the first sample product, keep `currency: null` for the second.
  - Update the `29.99` expectation to a regex match on the formatted string.
  - Add an assertion that the second product's price renders with `title="Currency unknown"`.

**Acceptance:** `pnpm --filter @openlinker/web test` passes.

### Step 5 — #327 FE page

- File: `apps/web/src/pages/orders/failed-orders-page.tsx`
  - Move `COLUMNS` construction inside the component (needs `connections` data).
  - Build a `connectionNameById = new Map(connections.map(c => [c.id, c.name]))`.
  - Update 5 edits listed in 5.2.
  - `rowHref={(order) => \`/orders/${order.internalOrderId}\`}`.

**Acceptance:** type-check passes.

### Step 6 — #327 FE tests

- File: `apps/web/src/pages/orders/failed-orders-page.test.tsx`
  - Add test: row renders as a link to `/orders/ol_order_aabbccdd1122334455`.
  - Add test: connection name shown when `connections.list` returns a matching connection.
  - Add test: eyebrow `Operations` present (via `renderWithProviders` + text query).
  - Existing tests stay green (update the substring match for order ID if now rendering full ID).

**Acceptance:** `pnpm --filter @openlinker/web test` passes.

### Step 7 — #329 BE bootstrap

- File: `apps/api/src/auth/bootstrap-admin.service.ts`
  - Update `bootstrap()` per 5.3.
  - Add `logDefaultAdminBanner()` private method (mirrors `logBootstrapBanner` shape but says "literal `admin` password in use").
  - Update header JSDoc (lines 12-13).

**Acceptance:** type-check passes.

### Step 8 — #329 BE tests

- File: `apps/api/src/auth/bootstrap-admin.service.spec.ts`
  - Adjust the "logs a generated password when none is provided" test to set `NODE_ENV=production` in the config.
  - Add a new test "seeds admin/admin in non-production when no password is provided" that verifies:
    - `bcrypt.compare('admin', hash)` is true
    - a distinct warning banner is emitted (not the same as the random-password banner).
  - Confirm existing tests still pass.

**Acceptance:** `pnpm --filter @openlinker/api test` passes.

### Step 9 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

All three green; no new warnings.

### Step 10 — Open follow-up issue

Open `#??? — Persist Product.currency on products table` referencing this PR. Scope:

- Migration adding `currency varchar(3) null` to `products`.
- Update `ProductOrmEntity`, `ProductRepository.toDomain/toOrmEntity`.
- Ensure adapters (PrestaShop product mapper) flow currency through to upsert.
- Update DTO docstring to clarify currency is now sourced from persistence.

---

## 7. Architecture compliance check

- **#326**: FE feature type change + BE DTO field both stay at their respective interface layers. No domain/application changes. ✅
- **#327**: page-composition only. No new shared primitives. ✅
- **#329**: confined to `apps/api/src/auth/bootstrap-admin.service.ts` + its spec. No port/adapter additions. Reads `NODE_ENV` via `ConfigService` like the rest of the file. ✅
- No `any`, no `console.log`, no hardcoded secrets (literal `admin` password is the explicit fix — gated by `NODE_ENV !== 'production'` and documented; called out loudly in logs). ✅

## 8. Risks and open questions

- **Currency `null` for all repo-sourced products** — the FE will always hit the muted fallback until the persistence follow-up lands. That's the correct bug-fix semantics (don't lie about the currency), and it's explicitly allowed by the AC ("A muted fallback is shown when currency is absent").
- **`admin/admin` footgun** — mitigated by `NODE_ENV !== 'production'` gate + loud warn banner + existing `OL_BOOTSTRAP_ADMIN_ENABLED=false` escape hatch. If the security team wants a stricter default (e.g., `staging` also random), we'll need an explicit `OL_ENVIRONMENT` enum rather than leaning on `NODE_ENV`. Out of scope here.
- **`COLUMNS` move inside component** on #327 — marginally re-allocates the column array per render. Page is tiny; no perf concern. Matches the style already used by many other pages that inline column arrays.

## 9. Test strategy summary

- BE unit tests: 1 new (`bootstrap-admin.service.spec.ts`), 1 modified.
- FE unit tests: 3 new (1 in products-list, 2 in failed-orders), 2 modified (assertion updates).
- No integration tests needed — these are all pure display/logic changes at an existing integration-test-covered surface.
