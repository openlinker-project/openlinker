# Readiness Gate: attention-reason copy module + `check-attention-reason-mirror.mjs`

**Plan**: `docs/plans/implementation-plan-attention-reason-copy-module.md`
**Issue**: #2357 (`W2-20`)
**Date**: 2026-08-26
**Verdict**: **READY** — with five plan corrections listed below, none of which is a contract break.

---

## 1. Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `apps/web/src/features/fulfillment-authority/` | **NEW** — directory absent | `ls` returns ENOENT |
| `scripts/check-attention-reason-mirror.mjs` | **NEW** — absent | ten sibling mirror scripts exist; none covers this vocabulary |
| Any FE `AttentionReason` / `AuthorityAttention` symbol | **NEW** — zero hits in `apps/web/src` | all matches are in `libs/core` |
| A `{ref}`-style copy-template substitution helper | **NEW** — none in `apps/web/src` | the only interpolation idiom is a template literal over an injected vocabulary record |
| A reusable generic "reason → copy" factory | **DOES NOT EXIST** — both precedents are hand-rolled per feature | see below |
| Per-reason copy table | **PARTIAL → follow precedent** | `apps/web/src/features/invoicing/lib/sales-document-block-copy.ts` (a `resolve*` if-chain) and `apps/web/src/features/orders/lib/order-row.ts`'s `BADGE_BY_REASON … satisfies Record<…>` |
| `*.copy.ts` module convention | **EXISTS → follow** | `features/returns/lib/returns-list.copy.ts`, `return-detail.copy.ts` — the repo's only two, and the closest structural match |
| Badge tone vocabulary | **EXISTS → must reuse, not invent** | `shared/ui/status-badge.tsx` |
| Table-driven "every union value yields copy" test | **EXISTS → replicate** | `features/orders/lib/order-row.test.ts` |
| Backend union + descriptors | **EXISTS → mirror, never re-derive** | `libs/core/src/fulfillment-authority/domain/types/authority-attention-reason.types.ts` |

**No reuse collision.** The plan invents nothing that already exists, and the two things it might have
duplicated (a badge-tone union, an exhaustive-copy-map idiom) have precedents it must adopt rather than
restate.

---

## 2. Plan corrections required before implementation

### C-1 — `attentionBadgeTone` must return `StatusBadgeTone` (was: an invented three-value union)

`apps/web/src/shared/ui/status-badge.tsx` declares
`StatusBadgeTone = 'conflict' | 'error' | 'info' | 'neutral' | 'review' | 'success' | 'warning'`.
The plan's `'danger' | 'warning' | 'neutral'` names a `danger` tone the primitive does not have — the badge
would render untoned. `invoicingBlockedBadge` already returns a *subset* of `StatusBadgeTone`; this must do
the same. Spec §4.3's "badged `danger`/`warning`" is design vocabulary, not a token name.

### C-2 — the `fix` field is implementer instruction, not operator copy

Spec §4.2's Fix column reads *"Name both connections; link to each"* — an instruction to whoever builds the
renderer. Shipping that string to an operator is nonsense. The field is renamed **`action`** and carries real
operator-facing copy (e.g. *"Open each connection and leave one system in charge of stock."*). The spec's Fix
column stays what it is: a note to #2356 about what the row must *link to*, which is a component concern.

This is the single most likely way this issue would have shipped a wrong string, and it would have passed
every gate — `check-ui-vocabulary` proves nine words are absent, not that a sentence makes sense.

### C-3 — placeholder substitution must be statically typed

The audit is right that no token-substitution helper exists and that the repo's idiom is a template literal
over a typed record. But a template literal per reason means a *function* per reason, and the mirror script
must read the copy table **textually as data**. Resolution: keep the data table, and make each entry declare
its own `placeholders` tuple so `attentionTitle(reason, params)` demands exactly those keys at compile time.
That buys the type-checking the precedent provides without turning copy into control flow.

`titleFallback` is retained: a template whose params are typed can still be called from a row that genuinely
has no order reference, and rendering a literal `{ref}` is the failure being designed out.

### C-4 — no `t(key, fallback)` injection

`sales-document-block-copy.ts` takes a `t`; `returns/*.copy.ts` does not. The latter is the closer precedent
(a static `as const` table of strings), it is what `check-ui-vocabulary` scans most precisely, and it is what
the mirror script can parse. Static wins; i18n migration is per-feature follow-up work by design
(frontend-architecture § i18n, v1 explicitly migrates no strings).

### C-5 — the mirror lives in `lib/`, not `api/`

The sales-document FE mirror sits in `features/orders/api/orders.types.ts` because it is a **wire** type. This
vocabulary has no FE api module yet (#2356 builds it) and its consumers are copy and badges, so `lib/` — as
the issue itself specifies — is correct. Recorded so the divergence reads as deliberate.

---

## 3. Backward-compatibility findings

| Surface | Assessment |
|---|---|
| Core barrels (`@openlinker/core/fulfillment-authority`) | **No change.** The plan reads `authority-attention-reason.types.ts`; it edits nothing in `libs/core`. |
| Port signatures / DTOs / Symbol tokens | **No change.** No port, no DTO, no token. |
| ORM schema / migrations | **None.** No entity touched. Confirms the plan's "no migration" claim. |
| `package.json` `check:invariants` | **Additive** — two chained commands appended. Warning only: the chain is `&&`-joined, so a failure here fails `pnpm lint` for everyone. Mitigated by the `--self-check` step running first. |
| `.eslintrc.js` | **Additive** — five globs in each of two pattern groups, inserted alphabetically between `customers` and `inventory` (lines ~247 and ~475). Adds a restriction that did not exist; nothing imports this feature yet, so nothing can break. |

### The one live interaction worth flagging (Warning, handled)

**Creating `features/fulfillment-authority/` activates `check-ui-vocabulary.mjs`'s first SCAN_ROOT.** That
root is declared `pending: true`, but Z2 keys on `isDirectory()`, so the folder's existence — not the flag —
turns scanning on. Its Z3 rule then **fails** a root that exists but contains no `.tsx` or `*.copy.ts`.

Consequence, and it is not cosmetic: the issue body's filename `attention-reason-copy.ts` (hyphen) would
create the folder, contribute zero scannable files, and turn `pnpm lint` red. `isScannable` matches
`path.endsWith('.copy.ts')`. The plan's `attention-reason.copy.ts` is therefore **mandatory**, not a
preference — and it happens to match the `returns` convention anyway.

`scripts/check-authority-kind-mirror.mjs`'s PENDING entry targets `features/orders/lib/authority-kind.ts`,
whose parent directory exists, so its typo guard stays satisfied. **Unaffected — do not touch it.**

---

## 4. Design questions the audit resolved

**Is mirroring `badge` redundant now that the API sends it?**
No, and the reason is precise. `apps/api/src/fulfillment-authority/dto/authority-status-response.dto.ts`
carries `badge` per `AuthorityAttentionItemDto` — but that is the *status page* payload only. The
cross-surface row badges (#2356) read `omsAttention`, whose element type is `AuthorityAttentionEntry`
(`producer`, `reason`, `detail?`, `subjectRef?`, `since`) — **no badge, no counted**. An order/product/return
row must therefore resolve reason → badge → tone locally. The mirror is load-bearing for exactly the surfaces
the issue names, and this belongs in the module's docblock so nobody later deletes it as duplication.

**Is mirroring `counted` redundant?**
Same answer. The status DTO pre-splits into `counted` / `routine` arrays; a row payload does not.

---

## 5. Open questions (non-blocking)

- **RB-L wording ownership.** Spec §4.2 assigns it to the returns spec §5.4, which has shipped no such
  string. The plan declares it provisionally and gates it with a PENDING cross-feature pair naming #2364 —
  the right failure direction, but #2364 will have to converge rather than choose freely.
- **A literal import from the returns barrel was rejected** in favour of a check. Worth re-confirming at diff
  review that the cycle argument holds: `features/returns` is one of #2356's badge surfaces and will import
  this module, so a static barrel↔barrel edge would close a loop.

---

## Verdict

**READY.** No Critical findings: nothing published is removed, renamed, or retyped, and no migration is
implied. Five corrections (C-1…C-5) are refinements to the plan's own choices, three of which
(`StatusBadgeTone`, the `fix`→`action` rename, the `.copy.ts` filename) would each have shipped a real defect.
Apply them during implementation; no re-plan is warranted.
