# Lessons

Recurring patterns and mistakes to avoid. **Review at the start of a work session.**

## What belongs here (and what doesn't)

This file is a **regression ledger** — empirical gotchas discovered while doing the work, written forward so the same mistake isn't repeated. It is **not** the place for architectural rules. Those stay canonical in:

- `docs/engineering-standards.md` — coding standards, naming, layering
- `docs/architecture-overview.md` — bounded contexts, ports, data flow
- `docs/architecture/adrs/` — decisions and their rationale
- `.claude/rules/*` — agent-facing rule sheets

When a lesson hardens into a rule, **graduate it** to the canonical doc and leave the lesson pointing at it. Keep entries empirical, dated by the PR/ADR that established them, and scoped with **Applies to** so they're easy to match against the file you're touching.

**Entry format** — one `##` heading per lesson (the heading *is* the rule, imperative), then:

- `**Context**:` the situation it came up in
- `**Problem**:` what went wrong
- `**Rule**:` the preventive measure
- `**Applies to**:` files / modules / scope
- `**Source**:` PR / ADR reference

---

## An id is assigned before its transaction commits, so id order is not visibility order

**Context**: designing the reader contract for ADR-049's durability spine — how a consumer advances
through a table of work rows or events without missing any.

**Problem**: the obvious cursor is a scalar `WHERE id > :cursor ORDER BY id`. It is wrong on any
table written inside a transaction. A sequence (or ULID) hands out the id at **insert** time, but
the row becomes visible at **commit** time, and those orders differ: transaction A can take id 100,
transaction B take id 101 and commit first. A reader that sees 101 and advances its cursor past it
will **never** see 100 — it committed into a position the reader has already passed. The loss is
silent, permanent, and invisible to a lag metric, because the row is not late; it is simply behind
a cursor that already moved.

**Rule**: never advance a durable read cursor on a scalar monotonic id alone. Use a composite cursor
read below a **visibility barrier** set at the oldest still-in-flight transaction (in Postgres,
derived from the active-transaction horizon), so the reader never crosses a position an open
transaction can still fill. If a scalar cursor is genuinely unavoidable, the reader must tolerate
re-reading a bounded window and dedupe on a business-derived identity — never on the id.

**Applies to**: any polling reader over a transactionally-written table — `sync_jobs`, the
`destination_taxonomy_sync` frontier, and any future outbox/event log. Not applicable to Redis
Streams ids, which are assigned by a single-threaded server at write time with no commit phase.

**Source**: [ADR-049](./architecture/adrs/049-durability-spine-and-domain-event-contract.md)
decision 3 (#2165, epic #2162)

## Never write a control character as a raw byte in source - escape it, or the file stops being reviewable

**Context**: `libs/integrations/eparagony/src/domain/policies/document-token.policy.ts` joined the parts of a vendor idempotency key with `0x00`, written as three literal NUL bytes inside a template literal (and inside the comment describing them) rather than as `\0` escapes.

**Problem**: git classifies a file containing a NUL byte as **binary**. The file rendered as `Bin 0 -> 2999 bytes` on GitHub - no diff, no reviewable lines, and no way to resolve a merge conflict in it. It happened to be the one file deriving the key that stands between a retried fiscal-registration POST and a second real registration, i.e. exactly the file a reviewer must be able to read. Local tooling gave no signal at all: it compiles, lints, and passes tests, so the defect only surfaced in review.

**Rule**: write control characters as escapes (`\0`, `\u0000`, `\x1b`) - the emitted bytes are identical, so there is never a runtime reason to prefer the raw byte. `scripts/check-nul-bytes.mjs` (in the `check:invariants` chain) now fails `pnpm lint` on a literal NUL in any text file in the tree, so this cannot reach review again. If you need a genuinely binary fixture, give it a binary extension so it falls outside the guard's extension list rather than allowlisting a `.ts` file.

**Applies to**: every tracked text source file; especially any policy/derivation file whose reviewability is the point.

**Source**: PR #2137 (finding B1), guard added in the same PR.

## DOMPurify is LOSSY under happy-dom, not absent - so a rendered-HTML assertion there proves nothing

**Context**: `apps/web` runs `vitest` on `happy-dom` (`apps/web/vite.config.ts`). ADR-046 introduced `shared/ui/rich-text-view.tsx`, which sanitizes stored description HTML with DOMPurify before rendering it.
**Problem**: under happy-dom DOMPurify reports `isSupported: true` and `document.implementation.createHTMLDocument` exists, so nothing looks wrong - but `sanitize('<p>a</p>')` returns `'a'`. Block tags are silently stripped, a `<ul>` renders as bare text, and in an earlier probe a `<script>` element was left standing while an `<a href>` lost its href. DOMPurify's own README says happy-dom "is not considered safe at this point"; this is what that means in practice. The trap is the direction of the failure: a page test asserting "the description renders" can PASS on the surviving text while proving nothing about the sanitizer, and a test asserting real markup fails for a reason that has nothing to do with the component.
**Rule**: assert markup fidelity and sanitizer behaviour ONLY in a suite carrying `/** @vitest-environment jsdom */` - today `shared/ui/rich-text-view.test.tsx`. In a page test on happy-dom, assert that the value went through the primitive (`.rich-text-view` present, the text content visible, and no literal `<p>` reaching the operator) and say in a comment where the real assertion lives. Do NOT switch a whole page suite to jsdom to get one assertion: `product-detail-page.test.tsx` was tried that way and six unrelated tests began timing out at ~1000 ms, because the suite was written against happy-dom's timing. And never "fix" a failing sanitizer assertion by loosening the sanitizer - it fails lossy, not open, so production in a real browser is unaffected.
**Applies to**: `apps/web/src/**/*.test.tsx` that render `RichTextView` (or any DOMPurify consumer), and `apps/web/src/shared/ui/rich-text-*.test.*`.
**Source**: #2199 / #2200 under [ADR-046](./architecture/adrs/046-adapter-declared-description-format.md).

## A marketplace's accepted HTML is a grammar, not a tag list - and Allegro publishes neither

**Context**: `sanitizeAllegroDescription` (`libs/integrations/allegro/src/infrastructure/util/`) filtered PrestaShop TinyMCE descriptions down to what its author believed Allegro's `description.sections[].items[].content` accepts, using a flat `ALLOWED_TAGS` set.
**Problem**: the set was wrong in both directions and had been shipping 422s. Allegro accepts exactly `h1 h2 p ul ol li b`; the allowlist additionally admitted `br strong i em u`, and a special case actively normalised every self-closing variant to `<br>` before passing it through, so we deliberately emitted a tag Allegro rejects. Worse, even the correct seven tags are not enough: the validator is **context-sensitive**, so a flat list still passes `<h1><b>x</b></h1>` - which TinyMCE really produces and Allegro really rejects. None of this is documented by Allegro; the grammar is reconstructible only from validator rejection messages in the `allegro/allegro-api` tracker, where one payload can produce two opposite allowed sets (`Błędny tag "strong", dozwolone są: {b}` and `Błędny tag "b", dozwolone są: {h1, h2, p, ul, ol}`, both in #9714).
**Rule**: never model a destination's accepted markup as a flat allowlist, and never as a regex private to one adapter - a flat list cannot express a rule like "a heading takes no formatting", so it passes markup the platform rejects while looking correct in review. Before widening an allowlist, ask what evidence backs the new tag: where the platform publishes no list, the only evidence is a rejection message, so pin the exact set in a spec and make any widening a deliberate test change. Prefer *converting* a rejected tag over stripping it, so the operator's formatting survives in some form. The canonical per-destination grammars and the contract that expresses them live in [ADR-046](./architecture/adrs/046-adapter-declared-description-format.md) - do not copy them back here.
**Applies to**: any destination that accepts a markup subset - `DescriptionFormat` declarations in `libs/integrations/*/src/infrastructure/adapters/`, and `applyDescriptionFormat` in `libs/core/src/listings/application/services/`.
**Source**: [ADR-046](./architecture/adrs/046-adapter-declared-description-format.md), #2193 epic (#2194 / #2196 / #2197). Evidence: `allegro/allegro-api` #11708 (2025-06-24), #9714 (2024-08-22), #10656 (2025-01-13), #3856.

## A destination that never returns an error can still be silently discarding your formatting

**Context**: the Erli adapter sends `description` as a flat string (`erli-product.types.ts`, `flattenDescription`) with no allowlist, no attribute stripping and no length cap - the only destination in the repo with zero description hygiene. The initial read of that gap was "this risks 4xx".
**Problem**: that read was wrong, and the truth is harder to notice. Erli's API doc describes two paths: a structured `description.sections` tree restricted to nine tags (`h1 h2 h3 p b br/ ol ul li`, attributes forbidden, `<br/>` self-closing only), **and** a plain-text HTML field with no tag restriction whose content is *silently converted* into that structure - *"opis przesłany jako tekst po konwersji będzie wyglądał inaczej"*, with images relocated to their own paragraphs. We are on the second path, so the operator never sees an error and never learns their formatting changed. Absence of failures had been read as evidence of correctness.
**Rule**: before concluding a destination tolerates your payload, find out whether it *rejects* malformed markup or *rewrites* it. A rewriting destination needs the same declared format as a rejecting one; the difference is only which of availability or fidelity you lose. And when a platform ships real documentation, read it before reconstructing behaviour from observation - Erli's list is published, unlike Allegro's. Probing endpoints is the fallback, not the first move: `erli.dev` and `docs.erli.dev` do not resolve and `developers.erli.pl` redirects to the storefront, but the doc is served from `erli.pl/svc/shop-api/doc/`.
**Applies to**: `libs/integrations/erli/**`, and any new destination whose write path lacks an allowlist.
**Source**: [ADR-046](./architecture/adrs/046-adapter-declared-description-format.md), #2193 epic (#2196).
## A top-level value import between two barrels that reference each other's `*Module` class can crash NestJS boot even when the DI graph is acyclic

**Context**: #2157 (write-path guard) and #2156 (cross-capability gate) each added a top-level value import from `@openlinker/core/fiscalization` into a file exported from `@openlinker/core/invoicing`'s own barrel (`FISCAL_REGISTRATION_SERVICE_TOKEN` in `invoice.service.ts`; `toRegisterTransactionCommand` in `auto-issue-trigger.service.ts`). `fiscalization.module.ts` separately has a real, one-way `import { InvoicingModule } from '@openlinker/core/invoicing'` for its `@Module({ imports: [...] })` array — a documented, deliberate edge, with the reverse direction resolved lazily via `ModuleRef.get(..., { strict: false })` specifically so no NestJS DI cycle exists.
**Problem**: `type-check`, `lint`, every unit `.spec.ts`, and `check-cross-context-imports.mjs` all passed clean — none of them execute Node's module system, so none could see this. Only an actual `NestFactory.create(AppModule)` boot crashed, with "Nest cannot create the FiscalizationModule instance. The module at index [n] of the imports array is undefined." Root cause: `app.module.ts` requires `@openlinker/core/invoicing` first; loading it hits the offending file mid-barrel (before the barrel's own, later-exported `InvoicingModule`), which requires `@openlinker/core/fiscalization`; *that* barrel's `fiscalization.module.ts` requires `@openlinker/core/invoicing` back — landing on invoicing's own **still-partially-populated** `module.exports`, where `InvoicingModule` isn't assigned yet. `@Module({ imports: [...] })` decorator arguments evaluate once, synchronously, at class-definition time — not live bindings — so the `undefined` is captured permanently. The existing `ModuleRef` lazy-DI pattern (added specifically to avoid a cycle) broke the **NestJS dependency-graph** cycle only; the plain top-level imports left a genuinely different **CommonJS require-graph** cycle wide open one layer down, and nothing in the repo's invariant suite checks for that shape.
**Rule**: When context A's `*.module.ts` value-imports context B's `*Module` class for its `imports: [...]` array (a documented, allowed one-way edge per `docs/architecture-overview.md § Cross-context dependencies`), audit **every other file B exports** for a top-level value import back into A — even a single Symbol token or a plain function counts, and `import type` does not help if the *value* is genuinely needed at runtime (a lazy `require()` inside the consuming method does; type it via a **named**, never wildcard, `import type { X as XType } from '@openlinker/core/B'` + `typeof XType` cast, so `check-cross-context-imports.mjs`'s wildcard ban and `consistent-type-imports`'s inline-`import()` ban both stay satisfied). Prove the fix with an actual boot, not just `type-check`/`lint`/unit specs — none of those execute the module graph. A throwaway script works when Testcontainers integration tests aren't available: `NestFactory.create(AppModule, { abortOnError: false })` against a deliberately-unreachable DB/Redis host still reaches (and, before the fix, crashes on) module construction, well before any real connection is attempted.
**Applies to**: any pair of core contexts where one's `*.module.ts` imports the other's `*Module` class — check both directions' *other* files, not just the module files themselves, whenever adding a new cross-context symbol.
**Source**: #2154 epic Phase 4 live e2e (found the app couldn't boot at all on the demo stack); fixed by commit `cf55c4d4e`.

## A column written by a narrow out-of-band UPDATE must be excluded from the full-row upsert's write set

**Context**: `order_records` carries denormalized columns that no ingestion payload supplies and that a different context pushes in with a narrow `UPDATE` - `fulfillmentState` (a rollup over the order's shipments, written by `updateFulfillmentState`) and `cancelledAt` (written by `markCancelled`). `OrderRecordRepository.upsert` is a full-object TypeORM `save()`.
**Problem**: `toOrm` mapped `fulfillmentState` unconditionally while `persistOrder` never populated it (it is the 12th constructor argument and only 11 were passed), so every re-ingestion - a poll re-read, a webhook-triggered sync, a manual re-sync - wrote `null` over a committed `'dispatched'`. A dispatched order silently reappeared as not-shipped in the ship-by SLA buckets and the not-shipped list filter. The same class of defect had already been fixed for `cancelledAt` in the same method (#1984) and the exclusion comment sat three lines below the offending assignment.
**Rule**: When a column has a dedicated out-of-band writer, that writer must be its **only** writer: leave the ORM entity property unset in `toOrm` so TypeORM omits the column from the generated statement, and say so in a comment next to the columns that *are* mapped. Do not "fix" it by reading the row first and carrying the value onto the new instance - an unlocked upsert racing the out-of-band UPDATE still loses a value that commits between the read and the save. Pin it with a unit test asserting the property is `undefined` on the entity handed to `save()` **and** an integration test proving the committed value survives a second persist (a mocked spec cannot prove TypeORM really omits the column). Note the consequence: the record returned by the upsert reports such a column as `null` whatever the row holds, so a caller needing its live value must re-read. Sweep the **whole method**, not just the column you came for: #2101 excluded `fulfillmentState` and left its exclusion comment sitting directly *below* two more assignments with the identical defect (`syncStatus`, `syncAttempts`), which then needed #2140 - so re-read every remaining assignment and ask which out-of-band writer owns it, and keep the exclusions in one consolidated block rather than interleaved with the assignments, or the next author drops a fresh one into the gap. Two follow-on traps #2140 surfaced: (1) an excluded **array** column needs a `?? []` guard where `toDomain` reads it, because the update path has no `RETURNING` clause and hands the property straight back `undefined` - `null`able scalars were already guarded, so #2101 never hit it; (2) for a `NOT NULL` column, omitting it makes the insert depend on the DB `DEFAULT` (TypeORM emits `DEFAULT` for an `undefined` column on Postgres), so verify that default is actually guaranteed rather than reading it off the creating migration - `1770000000000` wraps its `CREATE TABLE` in `if (!table)`, so a schema first built by `synchronize` skipped it entirely and took the column from the ORM decorator instead. Declare the `default` on the decorator (it is what a synchronize-built schema, including the int-spec harness, uses) *and* assert it on the migration-built schema with an idempotent `ALTER COLUMN ... SET DEFAULT`.
**Two mechanisms, and which to reach for** (#2071): the exclusion above is *omission* - leave the property unset in `toOrm` and let TypeORM drop the column from a full-object `save()`. The second is *allowlisting* - replace the existing-row `save()` with an explicit `createQueryBuilder().update().set({ ...owned })`, naming only the columns this writer owns. Omission is the cheaper edit and the right default when the full-row `save()` is otherwise correct and only a column or two must be withheld. Allowlisting is worth its extra weight when the excluded set is large or load-bearing enough that "did anyone add an assignment?" needs a machine to answer: it pairs with a spec that reads `getMetadataArgsStorage().columns` for the entity and asserts every declared column falls into exactly one of an identity / owned / DB-managed group, so a newly-added column **fails the build** until someone decides who owns it - a guarantee omission cannot give, since omission is the absence of a line and nothing fails when the next author adds one. Do not "DRY" the allowlist's `.set({...})` literal into an object built from the constant: the literal is what gives TypeORM's key type-checking something to check, and the spec already asserts the two agree. Note also that allowlisting reintroduces trap (1) on the *insert* branch - an INSERT still writes every column, so a DB-stamped column omitted from the insert mapping comes back only if the driver returns the row; guard where the branch reads it rather than assuming, exactly as the update branch guards `RETURNING`.
**Applies to**: any repository whose `upsert`/`save` coexists with a narrow `UPDATE` writer on the same table - today `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` (`syncStatus`, `syncAttempts`, `fulfillmentState`, `cancelledAt`, and the six FX columns of #2135, by omission) and `libs/core/src/inventory/infrastructure/persistence/repositories/inventory.repository.ts` (`updatedAt` plus the row's identity columns, by allowlisting).
**Source**: #2101 (surfaced reviewing #2050 / ADR-040, which adopts the narrow-conditional-UPDATE shape for its own columns); the `cancelledAt` precedent is #1984; #2140 closed the same defect for `syncStatus` / `syncAttempts` in the same method; #2071 is the first use of the allowlisting mechanism, on `inventory_items`, where the excluded `updatedAt` feeds the propagation dedupe key.

## CSS truncation clips pixels, not the accessibility tree — an unbounded identifier inside a linkified first cell becomes the row link's spelled-out accessible name

**Context**: #2093 fell the Customers list back to `emailHash` when a projection carries no name. `DataTable` linkifies the FIRST cell whenever `rowHref` is set (`linkifyFirstCell = Boolean(href) && !expandable`), so that cell's text content *is* the row link's accessible name.
**Problem**: `emailHash` is a 64-character SHA-256 hex. `.data-table td .mono-text { max-width: 20ch; text-overflow: ellipsis }` made it *look* handled, so it read fine in review and in every DOM assertion — but a screen reader spells all 64 characters out, and the mobile card (`.data-table__card-title`, 13.5px/600, `word-break: break-word`, no cap) printed it as a multi-line bold hex blob. The test fixtures used 10-character stubs, so the whole class of defect was invisible to a green suite. The same file already applied the opposite rule two columns to the right, where the Copy button deliberately says the generic "customer ID".
**Rule**: When a raw identifier (hash, UUID, token) lands inside a linkified first cell or a card title, put `aria-hidden="true"` on the identifier and let a short human phrase carry the accessible name — and keep the full value reachable to a sighted operator with `title` (a `CopyableId` renders a `<button>`, which must not nest inside the row anchor; see the `cardView.title` entry below). Fixture the value at its **real** length: a shortened stub hides the truncation, the accessible name, and the card headline all at once.
**Applies to**: `apps/web/src/pages/**/*-page.tsx` first-column cells under `rowHref`, and their `*.test.tsx` fixtures.
**Source**: #2093 (found in review).

## A row-level UI label must state what is true of the row, never infer a deployment setting the row cannot observe

**Context**: #2093 labelled the nameless Customers row "Name not stored", reading it as evidence of `OL_STORE_PII=false`.
**Problem**: `CustomerIdentityResolverService` creates **every** projection with `firstName`/`lastName` null, and `OrderCustomerProjectionUpdaterService` backfills them only if an order later carries a shipping or billing name. So a nameless row is routine on a fully PII-**enabled** deployment. On the one page a compliance reviewer would open to confirm hash-only mode, the label was a false positive; to a support agent it read as "OL dropped the buyer's name".
**Rule**: Before writing a label that explains *why* a value is absent, trace who writes that column. If absence has more than one cause — and "not populated yet" almost always is one — state the observable row fact ("No name recorded") and leave the cause to the settings page that actually knows it.
**Applies to**: any operator-facing empty/fallback label in `apps/web/src/**`.
**Source**: #2093 (found in review).

## Interactive content in a `DataTable` `cardView.title` / `subtitle` is legal only while the table sets no `rowHref` — and assert `title.closest('a')` is null, because a rendered-and-present assertion passes on the broken shape

**Context**: Epic #2086 moved a shared, interactive identity cell (a name `<Link>` plus a Copy `<button>`) into the mobile card of three lists. `DataTableCard` wraps `title` + `subtitle` in the row's own `<Link>` **only when `rowHref` is set** (`apps/web/src/shared/ui/data-table.tsx`), so the same renderer is safe on one page and broken on the next.
**Problem**: #2090 (Invoices, which sets `rowHref`) shipped the desktop renderers straight onto the card. That nested an `<a>` and two `<button>`s inside an anchor — invalid HTML, and worse, the clicks bubbled to the card link: the PDF number navigated to the invoice instead of opening the PDF, and both Copy buttons copied **and** navigated away. Every test still passed, because the assertions were all "the link/button renders" — which is true inside a wrapping anchor. #2091 (Orders) then justified hosting the cell verbatim on the premise that the page passes no `rowHref`, with nothing pinning that premise: adding one later would reproduce the bug with a green suite. `rowHref` churned inside this very epic (#1826 dropped it from Shipments in favour of `expandable`).
**Rule**: Before putting a link, button, or any click handler in `cardView.title` / `subtitle`, check the same `DataTable` call for `rowHref`. If it is set, the card gets text-only renderers (share the label/format helpers so the two cannot drift). If it is not, pin the premise: assert `title.closest('a')` is null in the card test, and make the affordance a **works** assertion — click Copy and assert `writeText` received the value — never merely `toBeInTheDocument()`. See also *An "authenticates" assertion is not a "works" assertion* below.
**Applies to**: `apps/web/src/pages/**/*-page.tsx` passing `cardView` to `DataTable`, and their `*.test.tsx`.
**Source**: #2090 (bug shipped), corrected and pinned in #2091 review.

## Claim an ADR number from the "Reserved numbers" note, not from the last row of the index table

**Context**: #2066 authored three ADRs and numbered them 039/040/041 by reading the index table in `docs/architecture/adrs/README.md` and taking "last merged row + 1".
**Problem**: The index lists only **merged** ADRs; several are normally in flight. All three numbers were taken — 041 was already merged, 039 was claimed by #2014 **and already referenced by name six times from `docs/plans/implementation-plan-order-cancellation-record-state.md` on `main`**, and 040 was claimed by #2050. Merging would have silently repointed a live link on `main` to the wrong ADR. Compounding it, the branch had also deleted `main`'s ADR-041 row *and* the "Reserved numbers" note itself — removing the warning against the exact mistake, then making it. That was the third numbering collision in two days.
**Rule**: Before authoring an ADR, read `git show origin/main:docs/architecture/adrs/README.md | tail -12` — the last rows **and** the reserved-numbers note beneath them — and claim your number by adding it to that note in your PR. Never edit the README from a stale local copy; `git fetch origin main` first, because a stale copy silently drops other people's rows. When renumbering afterwards, **never blanket find-replace `ADR-0NN` across `docs/`** — other plans legitimately reference the real ADR at that number. Scope the replace to an explicit list of files your PR authored, then verify the untouched ones are byte-identical to `main`.
**Applies to**: `docs/architecture/adrs/**`, and any doc that references an ADR by number.
**Source**: #2066 (found in review). Mechanical enforcement tracked as #2082.

## A new authenticated principal must never land on `req.user` — `RolesGuard` default-allows every route without `@Roles()`

**Context**: #1032's planned pack station proposed a warehouse "device principal" placed on `req.user`, with an endpoint allowlist described in the design as "the security boundary".
**Problem**: `RolesGuard.canActivate` returns **`true`** when a route carries no `@Roles()` decorator (`apps/api/src/auth/guards/roles.guard.ts`), and it is a global `APP_GUARD`. So any principal that satisfies `JwtAuthGuard` and reaches `req.user` is authorized on **every undecorated route** — including the customers controller (buyer PII), products, inventory, webhooks and cursors. The allowlist would have been decorative. This is currently latent, not exploitable, only because every principal in the system today is an OL user with a role.
**Rule**: A non-user principal (device, station, WMS service identity, agent token) gets `@Public()` plus its own dedicated verifier, in its own controller — never `req.user`. This is the split MCP already uses (`mcp-transport.controller.ts` vs `mcp-tokens.controller.ts`, which documents it). Copying only the *storage* half of the `mcp_tokens` pattern (opaque prefix + SHA-256 + revoke) is not enough; the auth-model separation is the load-bearing half. Where a service identity genuinely suits an OL user, prefer a service-account user under the existing role ladder over a new principal type.
**Applies to**: `apps/api/src/**/http/*.controller.ts`, `apps/api/src/auth/**`, any PR introducing a new authentication path.
**Source**: #1032 planning (found in stress test); guard hardening tracked as #2079.

## A supplementary write added inside an existing per-item sync loop must degrade, never abort

**Context**: #2024 extends the existing #816 `marketplace.offer.statusSync` per-offer loop to also persist a commercial (price/quantity) observation, reusing the same fetched object rather than a second marketplace call.
**Problem**: The first cut called the new write unguarded inside the loop. A single throw (an unvalidated marketplace-supplied string hitting a `numeric` column, a unique-constraint race with a concurrent `refreshOne`) aborted every remaining offer's **status** update for that page too, and skipped the `nextOffset` cursor advance — so the next tick re-read the same page, hit the same poison offer, and wedged that connection's status sync permanently. The repo already had this exact precedent (the Smart-classification readback, "must not fail the offer-creation job") and repeated the mistake anyway.
**Rule**: When bolting a second, non-essential write onto an existing per-item loop, wrap it in its own try/catch that warn-logs and continues — never let it propagate into the loop's control flow. Verify with a test that asserts the *primary* write still happened and the cursor still advanced when the secondary write throws, not just that the secondary write's own effect is absent.
**Applies to**: any application service that adds work inside `libs/core/src/**/application/services/*-sync.service.ts`'s per-item loop.
**Source**: #2024 (found reviewing PR #2035).

## Guard a numeric field from untyped wire JSON with `typeof` + `Number.isFinite`, never a bare `=== undefined` check

**Context**: #2024's Erli adapter projected a marketplace price with `if (product.price === undefined) return null`.
**Problem**: A JSON `null` (not `undefined`) slips past that guard, and `null / 100` evaluates to `0` — persisting a fabricated `"0.00"` price for an offer that is not actually free. There is no finite check either: a non-numeric value produces `NaN`, and Postgres `numeric` accepts the string `'NaN'` silently, so it stores rather than erroring. Separately, `typeof x === 'number'` alone still admits `Infinity` — reachable from `JSON.parse('{"a":1e999}')` — so an `Infinity` quantity would pass too.
**Rule**: For a numeric value read off untyped wire JSON, guard with `typeof x === 'number' && Number.isFinite(x)`, and treat `null`/`undefined`/non-numeric/`NaN`/`Infinity` uniformly as "absent" rather than coercing to `0`. A sparse marketplace response must persist as "not reported," never as a fabricated zero — an operator cannot tell a real `0` apart from a missing read.
**Applies to**: any adapter mapping a numeric field from a raw marketplace/shop API response, especially one persisted downstream.
**Source**: #2024 (found reviewing PR #2035); the Allegro side of the same adapter pair needed the identical fix.

## Never copy another platform's `defaultRateLimit` figure — an uncalibrated manifest default is a silent throughput regression

**Context**: Each #1810 Phase 5 adopter wires its HTTP client to `HostServices.http`, and may declare an `AdapterMetadata.defaultRateLimit` as the fallback when a connection has no explicit `config.rateLimit`.
**Problem**: PrestaShop's `{ requestsPerMinute: 60, maxConcurrent: 4 }` is the only such default in the repo and it is calibrated for an operator's OWN shop webserver (#1815) — simultaneously the throughput bottleneck and busy serving customers. Copying that figure onto a *carrier/marketplace* platform reads as "conservative" but is a guess about someone else's quota, and it is not a soft ceiling: `requestsPerMinute` is minimum-interval spacing (capacity ~1, no burst) — and, since the registry became Redis-shared across every process/replica (#2015), that figure is now the true aggregate cap with nothing dividing it further. On InPost it would have capped a previously-unlimited path at 1 req/s — bulk shipment dispatch (N≤25, sequential, on the *interactive* request path) going from seconds to a ≥25 s floor, invisible until an operator noticed slow dispatch. WooCommerce declines a default too, for the adjacent reason (an unenforced default fabricates a "Default: 60" readout in the FE `RateLimitSection`).
**Rule**: Declare `defaultRateLimit` only with a **documented quota for that platform** to calibrate against. Absent one, ship none: the transport already respects a real limit reactively via `Retry-After` (`limiter.noteRetryAfter`), and an operator who hits one sets `config.rateLimit` per connection. State the omission and its reason in the manifest — the absence is a decision, and the next adopter will otherwise read it as an oversight and "fix" it.
**Applies to**: every `AdapterMetadata` in `libs/integrations/*/src/*-plugin.ts` as it adopts `host.http`.
**Source**: #1971 (found reviewing PR #1981, which had added the copied 60/4 to InPost).

## Assert `host.http.forConnection` in a spec when a client stops calling bare `fetch`

**Context**: #1810 Phase 5 replaces each plugin client's `fetch()` with an injected `fetchImpl`, guarded by an ESLint `no-restricted-globals` rule plus `scripts/check-outbound-http.mjs`.
**Problem**: Both guards only detect a *bare `fetch(`* in the scanned package. Once the client's own call site is `this.fetchImpl(...)` with a `?? globalThis.fetch` default, a regression that simply stops threading the transport (a dropped constructor argument, a new call site built without it) reintroduces the un-rate-limited bypass while lint stays green — the fallback is the bypass.
**Rule**: Every adopting package needs a spec asserting `host.http.forConnection` is called for each construction path (the capability-adapter factory *and* the connection tester), with exactly the arguments intended — a single-argument `toHaveBeenCalledWith(connection)` also pins that no manifest default is being passed. Prefer closing the gap at the type level over the spec alone where the client's own signature allows it: make the client constructor's `fetchImpl` parameter **required** (no `?? globalThis.fetch` default) rather than optional-with-fallback. A required parameter turns "a dropped constructor argument" into a compile error at every construction site instead of a silent runtime fallback the spec has to remember to keep pinning — InPost (#1981) adopted this after PrestaShop/WooCommerce had already shipped the optional-with-fallback shape; the same tightening is worth carrying to those two.
**Applies to**: `libs/integrations/*/src/__tests__/*-plugin.spec.ts`, `.../adapters/__tests__/*-connection-tester.adapter.spec.ts`, and each package's `*-http-client.ts` constructor.
**Source**: #1971 (gap found reviewing PR #1981); PrestaShop's `prestashop-plugin.spec.ts` is the reference shape.

## A destructive sweep keyed on an internal id alone needs an explicit sole-claimant check, because internal ids are only per-connection by convention

**Context**: The master-sync staleness prunes (`MasterProductSyncService.markVariantsStaleExcept`, `MasterInventorySyncService.pruneStaleVariants`) mark every row of an internal product id stale, keyed on that id and nothing else.
**Problem**: `getOrCreateInternalId` namespaces per `(entityType, externalId, connectionId)`, so two connections *normally* never converge on one internal id - which made the missing connection scoping look safe and go unnoticed through two features (#1599 products, #1688 inventory). Nothing in the schema or the code enforces it: `product_variants` / `inventory_items` carry no provenance column, so a single converged mapping turns one connection's 404 into a sweep over a sibling connection's live rows, silently and unattributably.
**Rule**: When a sweep/delete/prune keys on an internal id that is only *conventionally* single-owner, add an explicit sole-claimant check at the call site and **withhold the destructive half** when it fails (log loudly, report it on the result) - do not rely on the id-generation convention alone. Reuse `IEntityClaimService.findRivalClaimants` (`@openlinker/core/integrations`): it reads the claimants via `getExternalIds` and narrows them to connections that actually have the writing capability enabled, short-circuiting before the connection listing in the common single-claimant case.
**Applies to**: any connection-blind sweep over `identifier_mappings`-derived internal ids - today `libs/core/src/products/application/services/master-product-sync.service.ts`, `libs/core/src/inventory/application/services/master-inventory-sync.service.ts`.
**Source**: #1904 (found reviewing PR #1903 / #1688); guard shipped with `EntityClaimService`.

## Re-prefix every generated migration timestamp to the synthetic sequence before committing

**Context**: `migration:generate` names files with a real `Date.now()` millisecond prefix; the repo's migrations use synthetic sequential prefixes (`17XX000000000` + small offsets).
**Problem**: A real epoch prefix can sort into the *middle* of merged history (PR #881's `1779985594755-AddShipmentCarrier.ts` sorted before the migration creating the `shipments` table), so fresh-database `migration:run` fails with `relation … does not exist` while incremental dev DBs keep working — the break stays invisible until someone installs from scratch.
**Rule**: After generating a migration, bump its filename prefix to the next free synthetic timestamp greater than every migration on `main` (current tail + 1 step) and update the class suffix to match. `scripts/check-migration-timestamps.mjs` now fails lint on any new file that sorts at or below `origin/main`'s max.
**Applies to**: `apps/api/src/migrations/`, plugin migration dirs in `scripts/plugin-migration-dirs.json`.
**Source**: #1013 (escaped via PR #881); fix migration `1802000000000-add-shipment-carrier.ts`.

## A `check:invariants` guard that shells out to `git` must tolerate the self-hosted runner having NO git binary, and distinguish git-absent from ref-missing

**Context**: `scripts/check-migration-timestamps.mjs`'s ordering invariant (#1013) derives its baseline from `git ls-tree origin/main`, degrading to a skip when the command fails.
**Problem**: Two layered gotchas. (1) `actions/checkout@v4` shallow-fetches only the triggering ref, so `refs/remotes/origin/main` is absent on `pull_request` builds. (2) **The self-hosted runner has no `git` binary on the `run`-step PATH at all** — `actions/checkout` silently uses its tarball/API fallback, so even `git ls-tree` (and a naive `git fetch` step) fail with `git: command not found` (exit 127). A first fix that added a bare `git fetch origin/main` step + a `CI=true` hard-fail-on-missing-ref turned a green-but-skipping CI **red** on every PR (the fetch 127'd; the hard-fail would have blocked all PRs once git was absent).
**Rule**: For any CI step / invariant that shells out to git on a self-hosted runner: (a) **guard `git` invocations on `command -v git`** so a missing binary degrades gracefully instead of exit-127-failing the job; (b) in the guard, **distinguish git-absent (exit 127 / `ENOENT`) → skip even in CI** (the runner can't support the check — an environment limitation, not a per-PR failure) **from git-present-but-ref-missing (exit 128) → hard-fail in CI** (a fixable workflow misconfig); (c) pair the git-capable path with an explicit `git fetch --no-tags --depth=1 origin +refs/heads/main:refs/remotes/origin/main` (forced refspec, tolerates reused workspaces). Full CI enforcement of git-history-dependent guards is gated on a git-capable runner (#662/#557).
**Applies to**: `scripts/check-*.mjs` guards that shell out to git; the `lint` job in `.github/workflows/ci.yml`.
**Source**: #1020 (reviewer-caught on PR #1015; git-absence surfaced on the live CI run).

## Create destination PrestaShop orders via `validateOrder`, never the raw webservice `POST /orders`

**Context**: Creating marketplace orders on a destination PrestaShop shop.
**Problem**: `POST /orders` over the PrestaShop webservice bypasses `PaymentModule::validateOrder` — it drops the posted carrier and re-resolves shipping to the cheapest *available* option (a free click-&-collect can win), corrupting the order's carrier and totals.
**Rule**: Create destination orders through PrestaShop's canonical `PaymentModule::validateOrder`, invoked via the OpenLinker module's HMAC-authed `importorder` endpoint. This requires the OL PrestaShop module to be installed on the destination shop. Do not "fix up" the carrier with a post-create `PUT` — it is rejected.
**Applies to**: PrestaShop order-processor adapter; destination order creation in `libs/integrations/prestashop`.
**Source**: ADR-016 (`docs/architecture/adrs/016-prestashop-order-create-via-validateorder.md`), PR #916.

## Rebuild `libs` dist after pulling/merging main, before type-check or commit

**Context**: Cross-package TypeScript resolves `@openlinker/*` against each library's built `dist`, not its source.
**Problem**: After pulling or merging `main`, stale `dist` output makes `pnpm type-check` (and the pre-commit hook) fail in ways that look like a merge defect but are just stale artifacts.
**Rule**: After pulling/merging `main`, rebuild the libraries before type-checking or committing: `pnpm -r --filter "./libs/**" build` (this is exactly what the root `type-check` and `test:ci` scripts do first).
**Applies to**: any session that pulls main mid-work; pre-commit hook failures referencing `@openlinker/*` types.
**Source**: root `package.json` `type-check` / `test:ci` scripts.

## FE Zod schemas over OL snapshots must use `.nullish()`, not `.optional()`

**Context**: OpenLinker serialises absent optional fields in persisted snapshots as JSON `null` (not omitted).
**Problem**: A frontend Zod schema using `.optional()` rejects an explicit `null`, so one null sub-field fails validation for the whole section and the cell/section renders blank.
**Rule**: When a FE Zod schema models an OL snapshot, use `.nullish()` (accepts `null` and `undefined`) for every optional field, not `.optional()`.
**Applies to**: `apps/web/src` Zod schemas that parse backend snapshot payloads.
**Source**: PR #941.

## Worker integration specs are not covered by the lint / type-check gate

**Context**: `apps/worker/tsconfig.build.json` excludes `test` (and `**/*.spec.ts` / `**/*.test.ts`); the root `type-check` and `lint` don't compile `apps/worker/test`.
**Problem**: Worker `*.int-spec.ts` files are only compile-checked by ts-jest at integration-test runtime, so a broken worker int-spec slips past `pnpm lint` + `pnpm type-check` and isn't caught until the integration suite runs (and may not run in CI).
**Rule**: After changing worker integration specs, run them explicitly with the integration suite — do not assume the standard quality gate covers them.
**Applies to**: `apps/worker/test/**/*.int-spec.ts`.
**Source**: `apps/worker/tsconfig.build.json`.

## Allegro shipping label PDF is `POST /shipment-management/label` — not the protocol/handover endpoint

**Context**: Generating Allegro shipping artifacts.
**Problem**: A label is not the same as a handover protocol / manifest; using the protocol endpoint returns the wrong document, and the shipping HTTP clients lacked a binary-response path.
**Rule**: Download the label PDF via `POST /shipment-management/label`; keep label and protocol/handover-manifest endpoints distinct, and ensure the HTTP client supports binary responses.
**Applies to**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-delivery-shipping.adapter.ts` and the Allegro HTTP client interface.
**Source**: Allegro shipping adapter implementation.

## PS module PHP fatal errors surface as opaque `testPingTriggered=false` — debug via Apache logs, not OL logs

**Context**: Configuring webhooks on a PrestaShop connection via "Re-configure webhooks" in the OL UI.
**Problem**: `ping.php` called `EventIdGenerator::generate()`, a method that does not exist — only `EventIdGenerator::generateEventId(provider, connectionId, eventType, objectType, externalId, occurredAt)` exists. PHP threw a fatal `Error` (not `Exception`), bypassed all `catch (Exception $e)` blocks, and Apache returned HTTP 500. OL's `firePing()` saw `res.ok = false` and set `testPingTriggered: false`. There is no OL-side log of the failing request — the error is entirely inside the PS module PHP process.
**Rule**: When debugging `testPingTriggered=false` after webhook install, **first check Apache error logs** inside the PS container (`docker compose exec prestashop tail -50 /var/log/apache2/error.log`) before investigating the OL side. A PHP `Fatal error: Call to undefined method` (or any other fatal) shows up there, not in NestJS logs. When writing PS module front controllers, prefer `catch (\Throwable $e)` over `catch (Exception $e)` to also catch PHP `Error` subclasses and return a structured 5xx rather than letting Apache serve a blank 500.
**Applies to**: `apps/prestashop-module/openlinker/controllers/front/`, `apps/prestashop-module/openlinker/classes/EventIdGenerator.php`.
**Source**: Discovered during local webhook setup; fixed in `apps/prestashop-module/openlinker/controllers/front/ping.php`.

## Allegro buyer-placed time is `lineItems[].boughtAt`, not a top-level checkout-form field

**Context**: Capturing the buyer-placed timestamp from an Allegro order.
**Problem**: There is no top-level checkout-form `placed`/`created` timestamp; an `AllegroCheckoutForm.createdAt` field would be fictional.
**Rule**: Read the buyer-placed time from `lineItems[].boughtAt`. The PrestaShop equivalent is `date_add`.
**Applies to**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts`; `libs/core/src/orders/domain/types/incoming-order.types.ts`.
**Source**: Allegro order-source adapter.

## A credentials/config payload shape shared by FE, shape validator, and adapter factory needs one cross-layer test — per-layer green suites can all pass against divergent assumed shapes

**Context**: KSeF connection create: the FE wizard sent `credentials: { authType, secret }` while the BE shape validator and adapter factory expected `{ authType, secretRef }` plus a second nested credentials lookup — every wizard-created KSeF connection failed at create with a 400.
**Problem**: Each layer had green unit tests against its *own assumed* payload shape, so the contract drift between FE payload, credentials-shape validator, and adapter factory went unnoticed until a live end-to-end attempt. Nothing type-checks across the FE/BE wire boundary, and the validator + factory each hand-roll their expected shape independently.
**Rule**: When a wire payload shape (credentials, connection config) is consumed by more than one layer, add at least one test that drives the real FE-produced payload through the BE validator and adapter factory together (or assert all layers against a single shared fixture) — do not rely on per-layer specs that each construct their own payload.
**Applies to**: connection credentials/config shape validators (`plugin.register` validators), adapter factories in `libs/integrations/**`, FE connection-wizard schemas in `apps/web/src/features/connections/`.
**Source**: #1318 / PR #1319.

## `@modelcontextprotocol/sdk` is the **v1** line — SDK v2 ships as a scoped package family

**Context**: Checking whether the MCP TypeScript SDK v2 had shipped, as #1486's acceptance criteria required.
**Problem**: `npm view @modelcontextprotocol/sdk` reports `latest: 1.30.0` with no `2.x` version and no v2 prerelease, which reads as "v2 has not been released". It has — v2 shipped 2026-07-27 as a **scoped package family** under new names (`@modelcontextprotocol/core`, `/server`, `/client`, `/express`, `/node`, `/hono`, `/fastify`, `/server-legacy`, `/codemod`, all `2.0.0`). The old package name was left on the v1 line. Concluding "not released" from the v1 name would have wrongly parked the whole issue.
**Rule**: When a dependency's major version appears missing, check the **GitHub releases page and the org's other package names**, not just `npm view <old-name>`. A monorepo SDK that splits packages at a major bump will leave the original name frozen on the previous line.
**Applies to**: any `@modelcontextprotocol/*` dependency decision; dependency-availability checks generally.
**Source**: #1486.

## Verify a new SDK's API against its installed `.d.ts`, never a fetched doc summary

**Context**: Planning the MCP transport wiring against a two-day-old SDK.
**Problem**: A web-fetched summary of the SDK docs produced `createExpressHandler(server)` — a function that **does not exist** in `@modelcontextprotocol/express@2.0.0`. A plan and a set of design decisions were built on it before the package was installed and its `index.d.cts` read. The real surface is `createMcpExpressApp` / `requireBearerAuth` / `toNodeHandler`. The SDK's own prose also referred to `ctx.http.authInfo` while its types declare `McpRequestContext.authInfo` — so even first-party documentation disagreed with the shipped types.
**Rule**: For any newly-adopted or recently-majored dependency, `npm install` it into a scratch directory and read the shipped `.d.ts`/`.d.cts` **before** committing to an API in a plan or a diff. Treat doc prose (including the vendor's own) as a hint, and the type declarations as the contract.
**Applies to**: adopting or major-upgrading any external SDK; `libs/integrations/**`, `apps/api/src/mcp/`.
**Source**: #1486.

## A service in `apps/**` may not inject a core `*RepositoryPort` — put the service in the owning context instead

**Context**: Placing the MCP-token mint/verify service, following the `RefreshTokenService` precedent (`apps/api/src/auth/` over a `libs/core/src/users/` repository port).
**Problem**: That precedent passes `check-cross-context-imports` **only because it is grandfathered** in the script's `ALLOW_LIST` (tracked tech debt, #718/#722). Copying it for greenfield code fails `pnpm lint` on the first commit, and "fixing" it by adding new ALLOW_LIST entries grows a list that exists to shrink.
**Rule**: Cross-context callers go through an `I*Service` + Symbol token, never a `*RepositoryPort`. If a new service needs a core context's repository, put the **service** in that context (`libs/core/src/<ctx>/application/services/`) and export its interface. Bonus: `check-service-interfaces` only scans `libs/core`, so the `I*Service` rule becomes machine-enforced rather than merely conventional.
**Applies to**: any new service in `apps/{api,worker}` that needs core persistence; `scripts/check-cross-context-imports.mjs`.
**Source**: #1486 (`/pre-implement` gate caught it pre-code).

## Integration-test schema is built by `synchronize`, not migrations — migration-only FKs don't exist there

**Context**: Asserting that deleting a user cascade-deletes their MCP tokens.
**Problem**: The assertion failed: the row survived. The FK is declared in the migration (`REFERENCES users(id) ON DELETE CASCADE`) but the ORM entity carries only a plain `user_id` column, and `apps/api/test/integration/setup.ts` builds its schema with `synchronize` — so migration-only constraints are absent from the test database. `setup.ts` already documents this for `connection_carrier_mappings` and `fulfillment_routing_rules`.
**Rule**: Don't assert migration-only DDL (FKs, cascades, check constraints) in an int-spec — it can't be there. Assert the **behaviour** the constraint backs instead (e.g. an orphaned credential still fails authentication), and add the table to `setup.ts`'s truncate list explicitly, since there is no FK for `users` to cascade from and rows will otherwise leak between cases.
**Applies to**: `apps/api/test/integration/**`, any table whose FKs live only in a migration.
**Source**: #1486.
## Default a response DTO's redaction flag to REDACTED, never to "show it"

**Context**: `ShipmentResponseDto.fromDomain(shipment, customerId, canWrite)` gates the raw carrier `errorMessage` (which can embed a rejected address fragment) on the requester holding `shipments:write` (#1826).
**Problem**: `canWrite` was declared `canWrite = true` so the command endpoints could omit it. That makes the *failure mode of forgetting the argument* a silent data disclosure: a new read endpoint that doesn't thread `@CurrentUser()` through compiles clean and serves the unredacted field to every role. The same trap applies to the error path - the carrier-rejection 502 body carried the same provider text with no gate at all, so a route without `@Roles` (label download, deliberately open to viewers) leaked what the persisted field withheld.
**Rule**: Make a security-relevant redaction parameter **required and un-defaulted** so a new call site cannot compile without deciding, and pass it explicitly (`true` with a one-line "this route is `@Roles`-gated" comment) at the sites that don't need redaction. If a default is unavoidable, default to redacted. Then sweep every *other* surface that carries the same text - error bodies included - not just the persisted field.
**Applies to**: `apps/api/src/shipping/http/dto/shipment-response.dto.ts`, `apps/api/src/shipping/http/shipment.controller.ts` (`toHttpException`); any response DTO with a role-gated field.
**Source**: #1826 review round (PR #1905).

## A hand-copied FE/BE literal union needs a `check:invariants` guard, not a "keep in sync" comment

**Context**: `PermissionValues` exists twice - authoritative in `libs/core/src/users/domain/types/role.types.ts`, hand-mirrored in `apps/web/src/shared/auth/session.types.ts` (the browser bundle can't import `@openlinker/core`).
**Problem**: The mirror carried only a prose "keep the two in sync" comment. Drift is silent in both directions: a permission added only to core never reaches `usePermission`, and one added only to the FE type-checks against a `permissions[]` array the API will never populate. A prior analysis had already recorded the risk and nothing enforced it.
**Rule**: When a union of string literals must be duplicated across the FE/BE boundary, add a textual-parse invariant script (`scripts/check-*-mirror.mjs`, no TS import, `--self-check` for the pure differ) and chain it into `check:invariants` - the same shape as `check-service-interfaces.mjs`. A comment is not enforcement.
**Applies to**: `scripts/check-permission-mirror.mjs`; any future FE/BE mirrored `as const` vocabulary.
**Source**: #1826 review round (PR #1905).

## A hand-copied FE/BE *number* is the same mirror class as a literal union - guard it, and guard the differently-named twin too

**Context**: The streamed resolve route (#2209/#2211) duplicated three things across the boundary, each with only a prose "mirrors X" comment: `RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS` (API stream DTO ↔ `listings.api.ts`), the items cap (`RESOLVE_CATEGORY_ITEMS_MAX`, the route's `@ArrayMaxSize`, ↔ the FE's `RESOLVE_CATEGORY_STREAM_CHUNK_SIZE`), and the FE mirror of `EanCategoryMatchStreamEvent`.
**Problem**: The lesson above was written about *string unions*, so a duplicated **number** read as out of its scope - yet it fails harder and more quietly. The client derives its idle ceiling as `interval * 6` from its own copy, so raising only the server's interval past that ceiling aborts every healthy long run with "the resolver stopped sending data", and both sides stay green because each is unit-tested against its own copy. The cap is worse to spot because the two constants are deliberately named differently (a limit vs a chunk size), so no grep for a shared name finds the pair: reduce the server cap without touching the FE and every large batch 400s at the validation pipe.
**Rule**: Treat *any* value duplicated across the FE/BE boundary as needing a `check:invariants` guard - numbers included, and especially a pair whose two names differ (state the pairing in the guard, since nothing else records it). For a duplicated *shape*, compare it structurally rather than as a text diff: derive the `kind` discriminants from each side's union members, compare property NAME sets (keeping `?`), and skip types the two sides declare independently. Blank comments before parsing (preserving offsets, so line numbers stay reportable) or a `{@link}` in a JSDoc block breaks the brace matching. Also check the authoritative side against *itself*: an `as const` kinds array sitting beside the union it describes can rot on its own, and only the BE has one to rot.
**Applies to**: `scripts/check-resolve-stream-mirror.mjs` (keep-alive interval, items cap, stream-event vocabulary); any FE/BE mirrored constant or interface. NOT covered by that guard and still comment-only: `EanMatchResult` itself, the `* 6` idle-ceiling factor, and the Swagger schema in the stream DTO.
**Source**: PR #2214 review (finding I9), guard added in the same PR.

## An upsert overlay must not assign a lifecycle-state column unconditionally when two decoupled writers share the row

**Context**: `webhook_deliveries` is stamped by the ingress API (`received`, then `published` after the stream publish) and, independently, by the stream consumer that reads that publish (`job_enqueued` / `deadlettered`). Both go through the same `INSERT ... ON CONFLICT DO UPDATE`, whose set-list is built from the caller-supplied overlay columns.
**Problem**: `"status" = EXCLUDED."status"` makes the *last* write win, and the consumer routinely wins the stream read before the API's follow-up write lands. So `published` overwrote `job_enqueued`, producing rows that claim `published` while carrying a `downstreamJobId` - and a `main` pipeline that went red on the #1511 drain assertion whenever the coin landed that way. Note the shape of the trap: the write that got lost was *not* the racy-looking one, and both callers were individually correct.
**Rule**: When a column encodes lifecycle progression and more than one process upserts the row, resolve the conflict by an explicit precedence ladder in SQL (`CASE WHEN rank(EXCLUDED) >= rank(current) THEN EXCLUDED ELSE current END`) rather than by arrival order, and keep the rank map beside the status union so the two cannot drift. Do not "fix" it by reordering the callers - they are deliberately decoupled, and neither can reason about the other's timing. Prove it with an integration test: the guard lives in SQL, so a mocked repository cannot exercise it.
**Applies to**: repository upserts over a status/lifecycle column with more than one writer - today `webhook_deliveries` (`libs/core/src/webhooks/infrastructure/persistence/repositories/webhook-delivery.repository.ts`); the same shape would apply to any future `*_snapshots` or delivery-audit table written from both an ingress and a consumer path.
**Source**: #1916 (CI run 30435342214).

## Profile the test harness before optimising a "slow suite" - the cost is usually per-test or per-teardown plumbing, not the test

**Context**: The `Integration Tests` job took ~18.5 min. Four hypotheses looked obvious: a slow spec (`order-reingestion-echo-guard`, 37 s), TypeORM `synchronize` running on every app boot, `TRUNCATE ... CASCADE` fan-out, and Postgres durability settings.
**Problem**: All four were wrong, and each would have cost a day. Measured instead: `synchronize` on an already-synced schema is **73 ms**; the 37 s "slow spec" runs in **6.4 s** warm and **76.3 s** cold, i.e. it was the run's first file absorbing the one-time ts-jest transform; `CASCADE` is irrelevant (the schema has **4** foreign keys); `fsync=off` + friends changed nothing and passing them via `withCommand` made a sample run *worse*. The real costs were a hardcoded `setTimeout(2000)` in a consumer's `onModuleDestroy` (paid on all 77 int-spec teardowns) and `TRUNCATE` costing ~10 ms per table **even when the table is empty**, times 18 tables, times 485 tests.
**Rule**: Before optimising an integration suite, instrument the harness phases (boot, per-test reset, teardown) and the suite ordering, and measure each candidate in isolation with a revert in between. Numbers first: a plausible mechanism that is real (`quit()` does queue behind an in-flight blocking read) can still be the wrong explanation for where the time goes. Watch specifically for (a) fixed sleeps in shutdown hooks, (b) per-test cleanup that scales with the schema rather than with what the test touched, (c) the first suite of a run absorbing cold-compile cost and looking like a slow test.
**Applies to**: `libs/test-kit/src/harness.ts`, `apps/{api,worker}/test/jest-integration.cjs`, any `onModuleDestroy` on a long-lived consumer loop.
**Source**: #1920 (four refuted hypotheses recorded in that issue's Verification log).

## An "authenticates" assertion is not a "works" assertion — assert a successful call, not just the absence of 401

**Context**: Phase 0 (#1486) shipped one MCP tool, `whoami`, reading the principal from `ctx.authInfo`. Its int-spec asserted the minted token was accepted by `/mcp` via `.expect(res => { if (res.status === 401 || res.status === 403) throw ... })`.
**Problem**: That assertion passes on a 400. `whoami` was in fact broken end-to-end: the principal lives on the **request-scoped** `McpRequestContext` handed to the server *factory*, and NOT on the context the SDK passes a tool callback at dispatch time — so every real `whoami` call would have returned "No OpenLinker principal on this request." Nothing caught it for a full phase, because the only test of the path asserted a negative (not-401) rather than the positive (a parseable result). #1487's first genuine `tools/call` surfaced it immediately.
**Rule**: When a slice's whole purpose is "X now works end-to-end", assert the SUCCESS shape — parse the response body and check a field. A not-an-error assertion is a placeholder, and it will keep passing while the feature rots. Corollary for the MCP SDK specifically: thread the factory's `ctx` into anything a tool handler needs; treat the dispatch-time context as carrying no auth.
**Applies to**: `apps/api/src/mcp/transport/mcp-server.factory.ts`, `apps/api/src/mcp/tools/tool-registry.service.ts`, any int-spec whose only assertion is a status-code exclusion.
**Source**: #1487.

## MCP protocol revision 2026-07-28 requires a per-request envelope + agreeing headers — a missing one looks like an auth/routing 400

**Context**: Hand-rolling JSON-RPC calls against `/mcp` in an int-spec (supertest, no MCP client library).
**Problem**: Every call 400'd. The revision named in `MCP-Protocol-Version` carries the handshake **on every request** (which is what makes OL's stateless, session-free serving legal per ADR-033), and enforces header/body agreement. Three separate omissions each produced a bare HTTP 400 that read like a bad token or a dead route: (1) `params._meta` absent; (2) `_meta` present but missing `io.modelcontextprotocol/protocolVersion` + `io.modelcontextprotocol/clientCapabilities`; (3) the `Mcp-Method` header absent, and for `tools/call` also `Mcp-Name` — both must match the body so an intermediary can route without parsing the payload. The SDK's error *bodies* name the missing key precisely; the status code alone tells you nothing.
**Rule**: When an MCP request 400s, read the JSON-RPC `error.message` in the response body before suspecting auth or routing — the SDK says exactly which envelope key or header is missing. Build the request helper once, with `_meta` + `Mcp-Method` (+ `Mcp-Name`) derived from the call, rather than per test.
**Applies to**: `apps/api/test/integration/mcp-tools.int-spec.ts`; any hand-rolled MCP JSON-RPC caller.
**Source**: #1487.

## `--testPathPattern` is silently ignored when a Jest config sets `testRegex` — use `--testRegex` to run one int-spec

**Context**: Iterating on a single `*.int-spec.ts` in `apps/api`, where `test/jest-integration.cjs` sets `testRegex: 'test/integration/.*\\.int-spec\\.ts$'`.
**Problem**: `--testPathPattern=mcp` and a positional `"mcp-"` both ran the ENTIRE integration suite — including the PrestaShop/MySQL container specs, so each "targeted" iteration cost ~15 minutes and booted containers that exhaust Docker. `--listTests` confirms it: the filter is dropped, not narrowed. This is the mechanism behind the older note that `test:integration -- <pattern>` doesn't filter.
**Rule**: To run one int-spec in this repo, override the config's own key: `pnpm --filter @openlinker/api exec jest --config test/jest-integration.cjs --testRegex="<file>\\.int-spec\\.ts$"`. Verify with `--listTests` before the real run — it is instant and proves the filter took.
**Applies to**: `apps/api/test/jest-integration.cjs`, `apps/worker/test/jest-integration.cjs`.
**Source**: #1487.

## A new feature's premise about an existing code path must be verified against that path's *entry point*, not against the layer it names

**Context**: #1837 added a pre-flight "already listed" confirm whose marketplace copy promised "creates a duplicate offer / Publish anyway", justified by `OfferCreationExecutionService` calling `createOffer` unconditionally. #1741 had, five days earlier, added `BulkListingSubmitService.filterAlreadyListed` - an intake guard that silently drops already-listed variants before any job is enqueued.
**Problem**: Both statements were true of the layer each named, and the premise was still false end-to-end: on the wizard path (the only FE entry point since #1754) the intake guard runs first, so confirming "Publish anyway (creates duplicate)" produced no duplicate. When *every* selected variant was already listed the empty post-filter list surfaced as the generic `EmptyBulkSubmissionException` ("requires at least one productId"), telling an operator who had just confirmed a real selection that they had submitted nothing. `docs/architecture-overview.md` meanwhile asserted the confirm was "a warning only - never a hard block" while the backend hard-excluded, and nothing reconciled the two.
**Rule**: When a feature's justification is a claim about existing behaviour ("X always happens, so warn about it"), trace the claim from the **caller the feature actually sits in front of** down to the layer that performs it, and check for guards added in between - especially for sibling features shipping in parallel under one epic. Then make the tree consistent in one pass: code, FE copy, and the `architecture-overview.md` bullet that states the guarantee. A doc bullet describing operator-visible semantics is part of the contract, not commentary.
**Applies to**: `libs/core/src/listings/application/services/bulk-listing-submit.service.ts`, `apps/web/src/features/listings/components/duplicate-guard-modal.tsx`, `docs/architecture-overview.md` §Listings; any pre-flight warning UI fronting a guarded pipeline.
**Source**: #1933 (PR #1935); premise introduced by #1837 (PR #1857) against #1741 (PR #1757).

## An exact dependency pin whose reason lives only in a source comment will be lifted by the next upgrade PR

**Symptom.** `libs/shared` pins `sanitize-html` to `2.17.5` exactly - no caret - on the library that IS the XSS boundary. A dependency-bump PR (or Dependabot) touches `package.json`, not `libs/shared/src/html/sanitize-stored-html.ts`, so the person best placed to break it never sees why it is pinned.

**Cause.** From `2.17.6` it depends on `htmlparser2@^12`, which is ESM-only; Jest 29 loads the repo's CJS build, so the bump turns every `libs/shared` spec red with a module-resolution error rather than a test failure - a symptom that reads like a broken test, not a deliberate constraint.

**Rule.** A pin that exists for a reason belongs in this file as well as in a header comment, and the header should cite the entry. The pin is not a preference: it is a liability, so lift it immediately if an advisory lands on `2.17.5` - re-check `pnpm audit` first, and expect to have to solve the ESM/CJS question in the same change rather than deferring it.

**Applies to**: `libs/shared/package.json`, `libs/shared/src/html/sanitize-stored-html.ts`, and any future exact pin on a security-relevant transitive.
**Tracked**: [#2233](https://github.com/openlinker-project/openlinker/issues/2233) - the periodic `pnpm audit` re-check against `2.17.5`, so the pin is somebody's assigned item and not only a rule in this file.

## A gating primitive built for write affordances does not gate content — check which policy demo mode needs before reusing it

**Context**: `useWriteAccess` + `ReadOnlyLock` (#1615) were the only access primitives in `apps/web`, used at ~113 sites. `ConnectionCapabilitiesPanel` rendered an operator-facing hint ("MCP tools follow these capabilities — an already-connected agent must reconnect to see a change") with no identity check at all.
**Problem**: The existing primitive deliberately *shows* a disabled control to a demo viewer, to advertise that the capability exists. Applied to informational content that policy is backwards, so nobody applied it — and the content shipped ungated instead. A public-demo viewer holding `connections:read` alone was told to reconnect an agent it cannot have, over a toggle it cannot operate. A wider sweep then found the same omission across the app: 40 sites where a read-only session can trigger a real write, plus 26 identity-driven content decisions, reachable from only 22 helper-hook calls and 13 inline `role === 'admin'` comparisons. The primitive existing was not the same as the primitive fitting.
**Rule**: Before reusing an access primitive, ask what it should do in **demo mode** for the thing you are gating: a write affordance renders disabled (advertise), content does not render (avoid misleading). Content uses `AccessGate` (`shared/ui/access-gate.tsx`), affordances use `useWriteAccess` + `ReadOnlyLock`, and non-subtree decisions use `usePermission`. Never compare `session.user?.role` inline — it is typed `string`, so a typo compiles and returns false. Keep the session-hydration guard (`isReady` ⇒ render neither branch) inside the primitive; spelled per call site it was present at 2 of 13 sites.
**Applies to**: `apps/web/src/shared/ui/access-gate.tsx`, `apps/web/src/shared/ui/read-only-lock.tsx`, `apps/web/src/shared/auth/use-permission.ts`; any new identity-driven visibility decision in `apps/web`. Rule sheet: `.claude/rules/frontend.md` § Access control; rationale: `docs/frontend-architecture.md` § Access Control And UI Visibility.
**Source**: #1993; the write-affordance policy it contrasts with is #1615.

## `renderWithProviders` defaults to an ANONYMOUS session — a test that asserts permission-gated UI must pass its own session adapter

**Context**: #1993 moved an informational alert behind `AccessGate require="connections:write"`. Three pre-existing tests in `ConnectionCapabilitiesPanel.test.tsx` asserted that alert with plain `renderWithProviders(<Panel …/>)`.
**Problem**: `renderWithProviders` defaults `sessionAdapter` to `createNoopSessionAdapter()` (`apps/web/src/test/test-utils.tsx`), which returns `ANONYMOUS_SESSION` — `user: null`, so `usePermission` is false for **every** permission. `DEFAULT_TEST_USER` (which does carry all of `PermissionValues`) applies only when a test explicitly calls `createAuthenticatedSessionAdapter()`. The gated alert therefore never rendered, and the failure read as a *timing* problem — the gate also defers until `useSession().isReady`, so a first, wrong fix swapped `getByText` for `await findByText` and CI failed identically. Worse in the other direction: the suite's **negative** assertion ("hint absent when no capability backs an MCP tool") kept passing under the anonymous default while proving nothing, since the hint was absent for a reason unrelated to what it claimed to test.
**Rule**: When gating existing UI on a permission, pass an explicit `sessionAdapter: createAuthenticatedSessionAdapter({ …, permissions: [...] })` to every test that asserts the gated element is **present** — and to every test that asserts it is **absent**, so the absence is attributable to the condition under test rather than to a missing permission. Add one deliberate anonymous-session case so the others cannot silently revert to the default and keep passing. When a permission-gated assertion fails, check the session the test actually renders with **before** reaching for `await`/`waitFor`; `findByText` on something that will never appear looks exactly like a race.
**Applies to**: `apps/web/src/test/test-utils.tsx` (`renderWithProviders`, `createAuthenticatedSessionAdapter`); any `*.test.tsx` asserting UI behind `AccessGate`, `usePermission`, or `useWriteAccess`.
**Source**: #1993 (cost two red CI runs before the cause was read correctly).

## A boot-time singleton must resolve `globalThis.fetch` per call, or it silently escapes an integration test's `global.fetch` stub to the real network

**Context**: #1810 routed every plugin's outbound HTTP through the `@Global()` `HttpTransportFactory`; #1972 migrated the DPD plugin onto it. `HttpTransportFactory`'s constructor captured its default transport as `globalThis.fetch.bind(globalThis)`.
**Problem**: `dpd-tracking.int-spec.ts` stubs `global.fetch`, then resolves the adapter through real DI — the pre-#1972 clients read `globalThis.fetch` at *client construction*, which happens after the stub is installed, so the stub took. Routing through the factory moved that read to *app boot*, before the stub existed: the SOAP call left the CI runner and hit the real `dpdinfoservicesdemo.dpd.com.pl`, which answered with a genuine `Access denied to secured webservice method` fault. The test failed with a plausible-looking auth error rather than anything pointing at the stub being bypassed.
**Rule**: A process-wide singleton that defaults to a global (`fetch`, `Date`, `crypto`) must read it inside the call, not in the constructor — `(input, init) => globalThis.fetch(input, init)`, which also keeps the receiver an explicit `bind` was there for. When migrating a plugin client onto a shared transport, re-run the int-specs that stub `global.fetch`: an escaped call surfaces as a *remote* error, not as a missing-mock error.
**Applies to**: `libs/shared/src/http/http-transport-factory.ts`; any plugin client migrating onto `HttpTransportFactoryPort.forConnection`.
**Source**: #1972 (CI run 31015159797).
## Read attempt 1 before concluding a CI failure was spurious

**Context**: the `Build` job failed on PR #2007 (run `31081388177`), was re-run with zero code change, and passed.
**Problem**: the GitHub API returns only the **latest** attempt, so `/actions/runs/{id}/jobs` showed the green attempt 2 and the failure vanished from every default view — the PR page, `gh run view`, `gh pr checks`. Two independent investigations of that run therefore concluded "nothing was broken". The failure was a real, reproducible race in the build graph (`libs/core` and `libs/shared` in the same `pnpm -r` chunk, two `tsc -b` processes emitting into one `dist/`), which #2011 then fixed. Attempt 2 had run the *identical* four-package chunk — it just won the interleaving. The rate was 1 in 40 runs, which is the worst case: rare enough to read as "CI is moody, hit re-run", frequent enough to keep costing time.
**Rule**: when a re-run turns a job green, fetch the earlier attempt explicitly — `gh api "repos/{owner}/{repo}/actions/runs/{id}/attempts/1/jobs"` — and read the failing job's log by its own job id (`gh api repos/{owner}/{repo}/actions/jobs/{jobId}/logs`). A green re-run is evidence about scheduling, not about correctness. Before re-running a red job a second time, check whether the same job also runs a `pnpm -r <script>` whose chunk composition could differ between attempts.
**Applies to**: any investigation of a "flaky" CI failure; `gh api /actions/runs/**`; `pnpm -r` build ordering.
**Source**: #2011 (CI run `31081388177`, attempt-1 job `92550857312`).

## Redis `PX`/`PEXPIRE` take milliseconds — a TTL floor typed in seconds and passed through unconverted silently truncates

**Context**: `RedisRateLimiterAdapter`'s pace-key Lua scripts CAS-advance a "next-available-at" timestamp and set its TTL to `max(a seconds-typed floor, time-until-the-stored-timestamp)`.
**Problem**: An earlier draft passed the seconds-typed floor straight into `SET key val PX <floor>` — `PX` expects milliseconds, so the key expired ~1000x sooner than intended (a few seconds instead of the intended one-hour floor) regardless of how far in the future the stored timestamp was. This silently discarded almost every `noteRetryAfter` backoff (and any real pacing interval) almost immediately after it was set, with no error anywhere — the key just quietly vanished early.
**Rule**: When a TTL constant is expressed in one unit (seconds, for readability/config) but the Redis command it feeds expects another (`PX` = ms, `EXPIRE` = seconds), convert at the call site and compute the actual TTL from the value it must outlive (`max(floorMs, timestamp - now)`), never from the fixed floor alone. A fixed floor by itself silently truncates any stored value larger than the floor.
**Applies to**: `libs/shared/src/rate-limit/redis-rate-limiter.adapter.ts` (`PACE_ADMIT_SCRIPT` / `PACE_ADVANCE_SCRIPT` / `CONCURRENCY_CLAIM_SCRIPT`); any future Lua script setting a Redis TTL from a config-shaped duration.
**Source**: #2015 (found while drafting the pace-key TTL logic, pinned by a regression test before merge).

## A test's happy path must not depend on a self-heal/eviction window at or above the test framework's own default timeout

**Context**: `rate-limit-redis-cross-process.int-spec.ts`'s original `maxConcurrent` cross-process test awaited four `acquire()` calls via one `Promise.all` with no `release()` in between — the 3rd/4th call could only ever admit via the inflight ZSET's orphan self-heal (`MAX_CALL_LIFETIME_MS`, then 120s).
**Problem**: `MAX_CALL_LIFETIME_MS` sat at exactly Jest's default 120000ms per-test timeout — the test's only path to success (the self-heal) and its own failure clock (Jest's timeout) were racing each other with no margin, so it failed CI reliably (CI run 31472849426). The fix was two-fold: rewrite the test to drive the state transition explicitly via a real `release()` rather than waiting out an eviction window, AND decouple the two constants (`MAX_CALL_LIFETIME_MS` moved to 300s) so they can never coincide again by construction.
**Rule**: Never let a test's happy path depend on a background self-heal/eviction/orphan-timeout window — drive the state transition explicitly (call the release/complete/cancel path yourself) instead of waiting for time to pass. Separately, audit any two "looks unrelated" duration constants that happen to share a numeric value (here `MAX_CALL_LIFETIME_MS` and `MAX_TOTAL_WAIT_MS`, both 120000) — an accidental equality between two constants that bound different things is exactly the kind of coincidence that turns into exactly this bug the next time either one is tuned.
**Applies to**: `apps/api/test/integration/rate-limit-redis-cross-process.int-spec.ts`; any int-spec whose assertion path relies on a TTL/eviction window rather than an explicit state change.
**Source**: #2015 (CI run 31472849426).

## Splicing a raw-SQL `OR` boolean constant into a larger `AND`-joined FILTER clause needs explicit parens — SQL's `AND` binds tighter than `OR`

**Context**: `OrderLineItemRepository.getProductChannelBreakdown`/`getTopProductRanking` compute `unconverted_currency` via `COUNT(*) FILTER (WHERE ${unconvertedOrZeroTotal} AND rec."currency" IS NULL) = 0` as a "no unlabeled currency in this bucket" guard, where `unconvertedOrZeroTotal` was defined as a bare `'X IS DISTINCT FROM :p OR Y = 0'` string with no wrapping parens.
**Problem**: string interpolation has no operator-precedence awareness — `${unconvertedOrZeroTotal} AND rec."currency" IS NULL` textually becomes `X IS DISTINCT FROM :p OR Y = 0 AND rec."currency" IS NULL`, and SQL parses `AND` before `OR`, so this is `X IS DISTINCT FROM :p OR (Y = 0 AND rec."currency" IS NULL)` — not the intended `(X IS DISTINCT FROM :p OR Y = 0) AND rec."currency" IS NULL`. Since `X IS DISTINCT FROM :p` was true for nearly every unstamped row in the group, the guard's left branch was almost always true regardless of the right branch, making `COUNT(*) FILTER (...)` count the row unconditionally — the `= 0` check then failed even for a clean, single-currency group, and the whole `CASE` fell to `ELSE NULL`. `unconverted_currency` was `NULL` far more often than the data warranted, silently, with no error anywhere — only caught by an int-spec asserting the exact value against real Postgres (a mocked-repository unit spec can't catch a SQL-precedence bug at all).
**Rule**: a `const` string holding a raw SQL boolean expression that will ever be concatenated into a larger expression via `${...}` must be wrapped in its own parens **at the point it's defined**, not only at call sites that happen to need it today — a sibling call site added later, or an existing one edited, inherits the same trap silently. Prefer pinning the exact value with a real int-spec against Postgres; a unit spec with a mocked repository cannot observe operator precedence.
**Applies to**: `libs/core/src/orders/infrastructure/persistence/repositories/order-line-item.repository.ts` (`unconvertedOrZeroTotal`); any raw-SQL-builder helper anywhere that stores a boolean sub-expression as a string constant for reuse across `FILTER (WHERE ...)`/`CASE WHEN ...` clauses.
**Source**: #2172/#2191 (`top-products-ranking.int-spec.ts`, "labels a channel's own unconvertedCurrency...").

## TypeORM `ORDER BY` must use property paths, not raw quoted SQL — `take`/`skip` plus any join resolves every term back to column metadata

**Context**: `ReturnRepository.listReturns` had ordered by the raw string `'r."createdAt"'` since #2334 and worked in production for three slices. #2377 added a `stage` filter that `leftJoin`s a counters subquery, and every paged returns read began throwing `TypeError: Cannot read properties of undefined (reading 'databaseName')`.

**Problem**: `.take()`/`.skip()` with **no** join emits a plain `LIMIT`/`OFFSET` and never inspects the `ORDER BY` terms, so a raw quoted string passes through untouched. Add *any* join and TypeORM switches to its **distinct-pagination** path — a two-query plan that first selects the distinct primary keys, which requires promoting every `ORDER BY` term into that inner select, which requires resolving each term back to its `ColumnMetadata`. `'r."createdAt"'` is a string TypeORM cannot map to a property, so the lookup returns `undefined` and the `.databaseName` read throws.

The shape is the reason this is here rather than in a style guide: **the defect was latent and armed by a change somewhere else.** Nothing about the failing line changed — the ordering had been written that way for months, and the commit that broke it added a `leftJoin` fifty lines away for an unrelated feature. The stack trace points into TypeORM internals and names neither the join nor the `ORDER BY`, so the trigger is not guessable from the failure.

**Rule**: write `ORDER BY` terms as **property paths** — `orderBy('r.createdAt', 'DESC')`, never `orderBy('r."createdAt"', 'DESC')`. The property form works on both pagination paths; the raw-string form works only until someone adds a join. When reviewing a change that adds a join to a query builder, check whether that builder also calls `take`/`skip`, and if so read its `ORDER BY` terms — the join is the trigger, but the ordering is the defect. An int-spec catches this and a unit spec with a mocked builder cannot, because the failure lives in TypeORM's SQL generation.

**Applies to**: every `createQueryBuilder(...).take()/.skip()` call in the tree; especially any shared `buildListQuery`-style helper where a filter arm can conditionally add a join that the paged read then inherits.

**Source**: #2377 (found by `returns-stage-projection.int-spec.ts` + `returns-read-api.int-spec.ts`; `libs/core/src/returns/infrastructure/persistence/repositories/return.repository.ts`).

## A guard ordered behind a broader one is dead — and a unit test can keep it looking alive by constructing a state the real path never produces

**Context**: `markReturnCustodyNotReturned` (#2367) carried two refusals: `illegal-transition` for a line not in `advised`/`in_transit`, and the more specific `partially-received` for a line that had already received units. The state check ran first. But receiving units is exactly what moves a line to `received` — so by the time `quantityReceived > 0`, the state check has already thrown, and `partially-received` was unreachable through every real path.

**Problem**: the reason was not merely dead, it was replaced by a **wrong** one. An operator whose parcel arrived half-empty was told the line was *"already finished"* — false, and it points at the wrong remedy (the line is mid-flight and its shortfall is exactly what they were trying to record). The closed reason union, the exception filter's 409 mapping and the frontend copy map all carried an arm nothing could ever emit.

The unit test covering it passed, and that is the part worth remembering: it constructed `line({ custodyState: 'in_transit', quantityReceived: 2 })` directly — a combination the receipt transition **cannot** produce, since a receipt sets both fields together. Hand-built fixtures let a test assert against a state the state machine forbids, so the test proved the branch worked *if reached* while saying nothing about whether anything reaches it. It was an integration test driving the real `POST /receive` then `POST /mark-not-returned` that produced `illegal-transition` where the code claimed `partially-received`.

**Rule**: when a function has several refusal branches, check the **order** against the transitions that actually produce each state — a specific guard placed behind a broader one that subsumes it is dead code that type-checks and tests green. In a domain-rule test, build the "before" state by running the transition that produces it (`applyReturnCustodyReceipt(...)`) rather than by hand-constructing the fields; a fixture that assigns `custodyState` and its counters independently can describe a state the machine never enters. Where a closed reason union exists, treat each member as a claim that something can emit it, and pin the reachable ones through the real path.

**Applies to**: `libs/core/src/returns/domain/domain-services/return-custody-transitions.domain-service.ts`; any pure rule engine with an ordered guard chain over a closed reason/refusal union — `checkRequiredToSell`, `checkParameterRestrictions`, `resolveSalesDocumentRouting` and the custody/lifecycle transitions all have this shape.

**Source**: #2380 (found by `returns-write-api.int-spec.ts`, "should refuse a partially received line with an actionable 409 code").

## A tsconfig with `"files": []` and only project references type-checks NOTHING — `tsc -p` on it exits 0 having compiled zero files

**Context**: while gating #2380's frontend work, `npx tsc -p apps/web/tsconfig.json --noEmit` reported `EXIT=0` on code that did not compile — it passed `messages` to a `FormErrorSummary` whose prop is `errors`, which the component test then caught at runtime with `Cannot read properties of undefined (reading 'length')`.

**Problem**: `apps/web/tsconfig.json` is a **solution-style** config — `"files": []` plus `"references"` to `tsconfig.app.json` and `tsconfig.node.json`. `tsc -p` on such a file has no inputs, so it succeeds instantly and reports success about nothing. Pointing at the referenced config directly is no better: `tsconfig.app.json` is written to be built through the reference graph, and invoking it standalone produced ~40 pre-existing errors across unrelated features (`downlevelIteration`, `AbortSignal.any`), i.e. a false RED to match the false GREEN. Compounding it, `tsc -b` **is** correct but incremental — a first run passed against stale `.tsbuildinfo` and only `tsc -b --force` surfaced the real errors.

**Rule**: never invent a type-check invocation — run the command the package itself declares (`pnpm --filter <pkg> type-check`, here `tsc -b`). Before trusting any green type-check on a package you have just edited, confirm it actually compiled your files: a zero-input config and a clean build are indistinguishable from the exit code alone. When a build is incremental, pass `--force` for a gate you intend to rely on.

**Applies to**: `apps/web/tsconfig.json` (and any other solution-style config in the tree); every ad-hoc `npx tsc -p <path>` used as a pre-commit gate.

**Source**: #2380.

## `pgrep -f <pattern>` from a shell whose own command line contains that pattern matches ITSELF — a watcher keyed that way reports on the watcher, never on the work

**Context**: waiting for a long `pnpm test` gate to finish, I backgrounded `until ! pgrep -f "pnpm test" >/dev/null; do sleep 10; done`. The loop never exited. A second, identical watcher started later did not exit either.

**Problem**: `pgrep -f` matches against the **full command line**, and the watcher's own command line contains the literal string `pnpm test` — as does every other watcher spawned the same way. So each loop matched itself and its sibling, the condition stayed true after the real `pnpm test` had long since exited, and `pgrep -f "pnpm test"` from any *other* shell then reported `RUNNING` about two sleep loops and nothing else. The failure has **no symptom other than a wrong answer delivered confidently**: no error, no hang in the thing being watched, just a monitor that says "still going" forever and a monitor-of-the-monitor that agrees. It also produced a second-order mistake — a detached PID doing real work was read as "nothing in flight", because the only evidence being consulted was the poisoned `pgrep`.

**The mirror failure — a pattern that matches TOO LITTLE.** The same session then missed a *running* jest twice with `pgrep -f "jest --config ./test/jest-integration"`, because the real command line is `node /path/to/jest.js …` — the binary name never appears. That reported "not running" about a process consuming 13 containers. So the trap has two directions and both yield a confident wrong answer about whether work is in flight: a pattern matching too much (the self-matching watcher above) and one matching too little (the cmdline is not what you assume). The second was hit twice with the first already written down, which is the argument for consulting the ledger over trusting recollection.

**Rule**: never key a wait loop on a pattern that appears in the loop's own command line. Wait on the **PID** (`while kill -0 "$PID" 2>/dev/null; do sleep 15; done`), or on a **marker the watcher cannot produce** — a sentinel line the watched command appends on exit, or its exit-code file. If a pattern really is the only handle available, exclude self and siblings (`pgrep -f "pattern" | grep -v $$`), and treat a non-empty result as evidence only after confirming what those PIDs actually are (`pgrep -fl`). More generally: **a check that can satisfy itself proves nothing** — the same shape as a mock easier to satisfy than the thing it replaces, or a `tsconfig` with no inputs exiting 0.

**Applies to**: any backgrounded `until`/`while` poll used to serialise against a long build, test or migration run; `pgrep`/`pkill -f` used anywhere near a process whose name is a substring of the polling command.

**Source**: #2380 (two stale watchers kept each other alive across several turns while the real gate ran undetected).

## `getMany()` materialises entities and silently DROPS raw `addSelect` columns — a raw column needs `getRawMany` or its own aggregate query

**Context**: planning a `restockBlocked` boolean for the returns list row (#2381), the obvious step was to `addSelect` the existing `RESTOCK_BLOCKED_EXISTS` SQL onto `ReturnRepository.listReturns`' paged query. That query ends in `.getMany()`.

**Problem**: `getMany()` returns hydrated **entities**, built only from columns TypeORM knows as entity metadata. A raw expression added with `addSelect('<sql>', 'alias')` has no metadata, so it is computed by Postgres, returned on the wire, and then **thrown away** during hydration — no error, no warning, no log. The field is simply `undefined` forever.

What makes it worth an entry is the shape of the resulting failure. It type-checks (the DTO field exists and is typed). It passes a unit test with a stubbed repository (the stub returns whatever the test author wrote). It reaches production as **a badge that never renders — for the one state whose entire purpose is to be impossible to miss**, on a surface whose whole job is to stop an operator believing stock came back when it did not. A silent no-op is the worst available outcome for a warning surface, and this is a silent no-op that every cheap gate reports as green.

**Rule**: `getMany()` / `getOne()` return entities; **any raw or computed column needs `getRawMany()` / `getRawAndEntities()`**, or belongs in a separate aggregate query whose results are merged by id in application code. Before adding an `addSelect` of an expression, read how the query terminates. Prefer the separate-aggregate form when one already exists (in `ReturnRepository`, `aggregateCounters` is that query): it keeps the paged query free of joins, which also avoids the distinct-pagination trap in the entry above, and it correlates on the GROUP BY key so no `COUNT(*)` is fanned out — a `LEFT JOIN` to the child table would silently multiply every other counter instead. Pin the value with an int-spec against real Postgres; a mocked-repository unit spec cannot observe hydration at all.

**Corollary — sharing a predicate across two scopes.** If the constant you want to reuse correlates on a different alias than the query you are adding it to (`r.id` vs `l."returnId"`), do **not** copy the SQL. Make it a function of the correlating expression and call it from both sites: two copies that agree today are two rules, which is the same defect `orphans` cost a round in #2378.

**Applies to**: every `createQueryBuilder(...).addSelect('<raw sql>', 'alias')` in the tree; especially list reads that end in `.getMany()` and feed a DTO field a UI branches on.

**Source**: #2381 (found by the `/pre-implement` readiness gate before any code was written; `libs/core/src/returns/infrastructure/persistence/repositories/return.repository.ts`).

## Audit a plan's ONE-LINERS, not its paragraphs — and for each, ask what supplies it

**Context**: `/tech-review` on the #2381 plan returned four findings. Every one of them was a step the plan stated in a **single line** and never traced to a data source. Every part the plan had reasoned hardest about — the `getMany()` correction, the parameterised correlating predicate, the event-vs-state split between a mutation response and a read — was sound.

The four, and what each was missing:

| One-liner | What was missing |
|---|---|
| *"Post-attestation row"* | No read supplies it. Attesting flips the act out of the outstanding set, so the read the plan added returns `[]` exactly when the row must render. |
| *"the `ReturnRecord`/counters projection"* | Ambiguous placement. A boolean fact would have landed inside a published `ReturnCounters` type whose whole contract is that a derived stage is computed from it. |
| *"an unreadable value degrades to the safe direction"* | Stated for one surface, unspecified for the other — and the other's answer is harder, because `false` asserts the operator's stock is fine while `true` cries wolf page-wide. |
| *"Stock added manually by `{user}`"* | No name is obtainable. `actorUserId` is written everywhere and resolved nowhere; there is no `IUsersService`. |

**Problem**: a one-line step reads as settled precisely because it is short. Prose invites scrutiny; a bullet that names a UI element sounds like a rendering detail, so a reviewer's eye skips it and the author never asked the question either. The failure surfaces mid-implementation, when the tempting fix is whatever is nearest to hand — the mutation's own response for the row, the raw UUID for the name — and that is how a placeholder ships.

**The harder variant — a parenthetical that NAMES an additional source is not a design for reading it, and is more dangerous than saying nothing.** #2383's plan described its read as *"an order-scoped read of return events (acts — receive, dispose, attestation — plus record-level facts)"*, then designed a single query over `return_line_events`. That ledger has four kinds and supplies only the acts: `opened` and `declined` are header COLUMNS on `returns`, `refund confirmed` is a money state, and `credit note issued` lives in another bounded context entirely. The hedge is what let it through review — it reads as already thought through, so it **satisfies the audit it should have failed**. **Naming a thing is not sourcing it.** When a step names more than one source, the audit is per SOURCE, not per step.

**Rule**: when reviewing a plan (your own especially), **list every step stated in one line and ask of each: what supplies this?** A field needs a read, a control needs a write, a badge needs a flag on the wire, and **a copy string is a contract too** — `{user}` in a spec is a promise that a name is obtainable, exactly as a button is a promise that a write exists. If the answer is "the response of the action that caused it", check what happens on reload. It is a cheap pass and it would have caught all four here before a review round.

**Applies to**: every `docs/plans/implementation-plan-*.md`; the `/pre-implement` and `/tech-review` gates when the target is a plan rather than a diff.

**Source**: #2381 (four findings, four one-liners, zero from the reasoned paragraphs).

## "Would pass the demo / would pass the harness" is a reliable marker for a whole family of defects — ask what the state is when nobody is looking on purpose

**Context**: #2380/#2381 produced four defects with one shape, found at four different stages:

| Defect | Why it looked fine |
|---|---|
| A persistent inline error rendered inside a **collapsed** `DataTable` expansion | A demo expands the row. |
| The same notice fed from a mutation **response** rather than a read | Nobody reloads mid-demo. |
| A row badge from a raw `addSelect` on a `getMany()` query | Type-checks; passes a stubbed unit test. |
| `earliest-order-date.int-spec` asserting the host timezone | Passes in UTC CI. |

**Problem**: each is a surface whose entire purpose is to be **noticed**, failing in exactly the state where nobody is deliberately looking at it — collapsed, reloaded, unmocked, in another timezone. That state is never the one a demo, a review, or a hand-written test exercises, because all three involve someone attending to the thing on purpose. So the defect survives every cheap check and reaches an operator who was not attending, which is the only audience the surface was built for.

The inline-error case is the sharpest: a persistent error behind a disclosure is **not a weaker version of the requirement** — it is precisely the silent no-op the requirement exists to prevent, shipped under the requirement's own name.

**Rule**: for any surface whose job is to be noticed — an alarm, a badge, a warning, a blocked state — ask **"what is this in the state where nobody is looking at it on purpose?"** Collapsed. Reloaded. Filtered out. On a page that was already open. In a locale that is not yours. If the answer is "absent", it does not meet the requirement however good it looks when attended to. This is the same check as the one-liner audit above, applied from the other end: that one asks *what supplies this*; this one asks *who sees it when nobody is trying to*.

**The sharpest instance — "is this MOUNTED?"** #2382 built a credit-note proposal panel with nine passing component tests, exported from nothing and rendered by nothing. Every gate went green: it type-checked, it linted, its tests passed. A component test **renders the component itself**, so it can only prove the panel *would* render if something rendered it — a true statement about a counterfactual that says nothing about the product. The check and the subject were the same object, exactly as with the mock easier to satisfy than the thing it replaced, and with `pgrep` matching its own watcher.

So **mounting needs an assertion one level up** — a page test that finds the surface on the page, not a component test that renders it directly. And expect the repair to be bigger than a re-export: in #2382 the panel read a *separate* `GET`, so nothing was fetching it and the fix was a query, a query key, a parse module, a barrel export and a mount. A missing export looks like a one-line oversight; a missing seam does not. The better of the two closing tests was not the one asserting it renders — it was the one asserting the proposal is **not requested for an orphan**, because that pins a decision (the route answers 409, and asking anyway renders an error for a state the page already explains) rather than pinning wiring.

**A scoped lint run does not stand in for `pnpm lint`.** #2382 fixed two ESLint errors, verified with `npx eslint src/features/returns src/features/orders`, got a clean result — and the full gate stayed red. The remaining failure was `check-ui-vocabulary`, which runs from `pnpm check:invariants` and **is not ESLint at all**, so no folder-scoped ESLint invocation can ever surface it. The narrower check answered truthfully; it just answered a different question than the one being asked. Verify a gate with the gate's own command, and remember that `pnpm lint` chains the invariant scripts — a targeted run is a debugging aid, never a substitute.

**A long gate needs its RESULT to outlive the process — and use the harness's own background mechanism to get that, not a hand-rolled one.** #2382's integration run was cut short three times, each time leaving no exit code and only a fragment of output; a fragment is not a result, and reporting one as a result is how a partial red gets remembered as a real one. Writing the exit code to a file is right on its own merits. But a hand-rolled `nohup setsid bash -c '…' &` from inside a tool call produced **no log file at all**, while the harness's own background flag carried complete 126-suite runs in the same session — so the property that matters is the result outliving the process, not the detachment trick. Prune orphaned containers before relaunching: a killed run leaves its Testcontainers behind (9 and 13 of them here), and a long session degrading the Docker daemon is a far likelier cause of a cut-short run than any lifecycle limit.

**Corollary — a promised test that was never written is indistinguishable from a passing one.** #2381's plan specified a toast/notice overlap test; the implementation did not write it, and nothing failed, because nothing compares a plan's test list against a diff's. When a plan names a test, check it exists by name before calling the work done.

**Corollary, same shape — a cited SAFEGUARD that does not exist.** #2382's plan justified an editable-currency decision by pointing at an "existing refund-currency-mismatch guard". There is none; the only `currency-mismatch` in the tree belongs to `sales-documents`' threshold evaluator, an unrelated rule. A claim about a protection nothing verifies is load-bearing until somebody greps for it — and it is worse than a missing test, because it makes a reviewer *relax*. When a plan or a docblock leans on a guard, check the guard exists by name.

**Applies to**: any operator-facing alarm/badge/notice; any plan whose acceptance criteria name specific tests, or whose reasoning rests on a named guard.

**Source**: #2380 / #2381.

### An int-spec that cannot reach the route proves nothing — and it will say so as a business failure

**#2383.** A new `GET /returns/events` route was added, correctly declared before
`@Get(':returnId')`, and its integration spec failed **every** assertion with
`404 Not Found`. Read at face value that is a routing-order defect, and the
obvious "fix" is to move a decorator that was already in the right place.

The route was fine. The **spec** was requesting `/returns/events` while the
harness enables URI versioning, so every path needs `/v1`. Two details made this
worth an entry rather than a shrug:

1. **The 404 was indistinguishable from the real defect the test exists to
   catch.** A literal segment swallowed by a parameter route ALSO returns 404 —
   via `ReturnNotFoundError` → the global filter — so the symptom pointed
   straight at the hypothesis that was wrong. Debugging by hypothesis would have
   churned the controller indefinitely.
2. **The cheap discriminator is to probe a route you did not write.** One
   throwaway spec hitting `/returns` and `/returns/ingestion-availability` — both
   long-shipped, both passing in their own spec — returned 404 too. That
   collapses the search instantly: *nothing* on the controller is reachable, so
   the fault is in the request, not the routing. `Cannot GET /returns/events` in
   the body (Nest's own 404) versus a domain-shaped body is the same tell, one
   layer cheaper.

**When a new test fails in a way that indicts your new code, first check whether
it also indicts code you did not touch.** If it does, the test is wrong.

### A test expectation written before the seed path was read is a guess

**#2383, same spec.** Two assertions expected `['dispose', 'receive']` and got
`['opened', 'opened', 'dispose', 'receive']`. The extra entries were **correct** —
`upsertFromObservation` stamps `openedAt` from the observation, so a seeded
return really does contribute an `opened` fact. The expectations had been written
from the plan's source table rather than from what the seed helper actually
writes.

Harmless here because the surplus was visible. The dangerous direction is the
same mistake with a *narrower* expectation that happens to pass — `toContain`
where `toEqual` was meant, or a filter that quietly drops the rows a defect would
have produced. **Write the assertion against what the seed path writes, not
against what the design says it should.** And when a test's actual output is
richer than expected, establish whether the surplus is a defect or a fact before
editing either side — here it was the feature working.

### A barrel import and a module edge are different facts — "the edge already exists" must name which

**#2383.** A plan justified a new cross-context read with *"`orders` is an edge
`returns` **already has** — this is a new method on it, not a new edge."* That
was **true of the TypeScript barrel** (`libs/core/src/returns/**` really does
import `@openlinker/core/orders`) and **false of the NestJS module graph**, which
is the level dependency injection actually runs on: `ReturnsModule` deliberately
excludes `OrdersModule` and says so in three separate docblocks (*"NOT
`OrdersModule`, which imports seven siblings this context has no business
pulling in"*), reaching `orders` only through the leaf `OrderChangesModule` and a
report-don't-persist seam.

Injecting the service into `ReturnsService` would therefore have added exactly
the edge that module was designed to avoid — and the claim would have survived
review, because a reviewer checking "does returns import orders?" gets `yes`.

**The claim survives review precisely because it is true in one sense.** That is
the tell: a dependency assertion that does not name its LEVEL is not yet a fact.
There are at least three, and they disagree routinely:

1. **Barrel/type import** — `import type { X } from '@openlinker/core/orders'`.
   Costs nothing at runtime, so a context can carry dozens.
2. **NestJS module edge** — `imports: [OrdersModule]`. Pulls that module's whole
   transitive provider graph into this one, which is what the exclusion above is
   protecting against.
3. **Constructor DI on an injected token** — needs (2) to be satisfied
   *somewhere*, which is why "the interface layer already holds it" can be a
   complete answer while "the context already imports it" is not.

**Check the module file, not the import list.** And when the answer is that the
edge exists one layer up, that is usually the better place for the code: here it
moved the refund read to a controller whose module already imported
`OrdersModule`, which produced **strictly less coupling than the plan
described** — the rare direction for a mid-implementation correction.
