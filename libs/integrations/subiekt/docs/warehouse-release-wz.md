# Warehouse release (WZ) on invoice issuance — build status (#3431 / #3436)

Companion to `Invoicing.cs.ready` / `Program.cs.ready` in this same folder. Unlike
`fiscalization-not-live-verified.md`, this records what **is** live-verified — the
bug, the fix, the double-release finding, and (added for piotrswierzy's #3436
review) direct evidence for the explicit-create branch that the original
investigation could not exercise on its own.

## The bug, confirmed live

No WZ (Wydanie Zewnętrzne, warehouse release) document was ever created for an
order OpenLinker processed through Subiekt — `dok_Rozliczony` was the only
stock-adjacent flag touched by `IssueInvoice`. `tw_Stan` for the live E2E test
product (`tw_Id 47`, `SUBIEKT-E2E-001`) stayed at 50 despite 2+ confirmed real
sales through the full pipeline (Allegro purchase → ingestion → ZK created →
FS/PA issued). Should have read 48.

## The fix

`EnsureWarehouseRelease` (in `Invoicing.cs`) resolves the order's ZK via
`dok_NrPelnyOryg` (`FindZkIdByOrderRef`) and issues a WZ linked via
`NaPodstawie(zkId)` — the same link+autoload primitive `DodajKFS` already uses
for corrections, applied to a ZK instead of an FS/PA. Idempotent via the WZ's
own `%`-prefixed `NumerOryginalny` lookup (`FindExistingWz`), and called from
BOTH the fresh-issuance path and the found-existing-invoice (retry-after-
partial-failure) path in `IssueInvoice`, so a crash between "invoice
committed" and "WZ committed" self-heals on the next retry instead of leaving
stock permanently unreleased.

## The double-release finding

Live investigation during the original fix's own verification surfaced a
second, more subtle finding: on the current state of this Subiekt install,
issuing an FS via `DodajFS().Zapisz()` **already auto-generates a linked WZ as
a side effect** — confirmed via `dok_Pozycja.ob_DokMagId` on the invoice's own
position row being `NULL` on a pre-fix invoice and populated on a fresh one,
with no code change on the read side. Almost certainly an operator-toggled
Subiekt document-type setting ("rozchoduj automatycznie"), not something this
bridge controls.

The naive fix (calling `NaPodstawie(zkId)` unconditionally) created a
**redundant second WZ** against the same ZK, double-releasing stock by 2 units
for a 1-unit order (caught live: `tw_Stan` dropped 49→47 instead of 49→48).

`FindAutoReleasedWzForInvoice` detects this by checking whether the invoice's
own `dok_Pozycja` rows already carry a non-null `ob_DokMagId` before attempting
an explicit WZ.

## Original live verification (2026-09-22, auto-releasing install)

- Fresh order (ZK 139, order ref `b73ba010-...`), 1 unit: FS 23/2026 issued,
  response carries `warehouseReleaseNumber: "WZ 39/2026"`. `tw_Stan` 47 → 46
  (exactly 1 unit, not 2).
- Idempotent retry with the same idempotency key: returns the SAME invoice
  (152, FS 23/2026) and SAME WZ (39/2026); `tw_Stan` stays 46 — no
  double-release on retry.
- Bridge log confirms the auto-release-detection branch fired correctly:
  `"Subiekt already auto-released via WZ 39/2026 for invoice 152 - not
  creating a second WZ."`

Every one of those data points is from the **skip** branch (auto-release
detected, no second WZ created) — this install auto-releases, so the
explicit-create branch (`NaPodstawie(zkId)` actually firing) never ran
through the real `IssueInvoice` flow.

## Explicit-create branch: forced verification (#3436 review, 2026-09-22)

piotrswierzy's review correctly flagged that the claim "correct regardless of
which Subiekt configuration an install runs" had only ever been tested on the
skip branch. The create branch (`EnsureWarehouseRelease`'s `NaPodstawie(zkId)`
call, for an install where Subiekt does *not* auto-release) had never fired
through the real integrated flow on this install, since it always auto-releases
first.

To get real evidence instead of a narrowed claim, `FindAutoReleasedWzForInvoice`'s
result was **temporarily** forced to `null` inside `EnsureWarehouseRelease`
(clearly commented `TEMPORARY #3436 ... — REVERT AFTER THIS TEST`, bridge
rebuilt, exercised, then the change was reverted and the bridge rebuilt again —
the reverted file is byte-identical to `Invoicing.cs.ready` as committed).

**Setup**: a fresh order created via `POST /wp-json/wc/v3/orders`
(`customer_id: 80`, product 47 × 1, `_ol_order_id: wz-forced-create-3436-fresh`)
→ ZK 27/2026 (`dok_Id 161`). Stock before: `tw_Stan = 43` (warehouse 1).

**Invoice issued** with the auto-release check forced off:

```json
POST /api/invoices
{"documentType":"FS","currency":"PLN","orderId":"wz-forced-create-3436-fresh",
 "idempotencyKey":"wz-forced-create-3436-fresh","kontrahentId":80,
 "lines":[{"towarSymbol":"SUBIEKT-E2E-001","ilosc":1,"cenaBrutto":20.00,"stawkaVAT":"23"}]}
```

Response: `providerInvoiceId: 162`, `providerInvoiceNumber: "FS 27/2026"`,
`warehouseReleaseNumber: "WZ 44/2026"`.

Bridge log: `"Invoicing.EnsureWarehouseRelease: released stock via WZ 44/2026
for ZK 161."` — the create branch fired, not the skip branch.

**What actually happened, per SQL, is exactly the double-release failure mode
the guard exists to prevent** — reported honestly rather than as a clean pass:

- `tw_Stan` dropped from 43 to **41** — 2 units, for a 1-unit order.
- Two WZ documents exist for this window: `dok_Id 163` ("WZ 43/2026",
  `dok_NrPelnyOryg` blank — Subiekt's own auto-generated release, confirmed by
  invoice 162's own `dok_Pozycja` row carrying `ob_DokMagId = 163`) and
  `dok_Id 164` ("WZ 44/2026", `dok_NrPelnyOryg = wz-forced-create-3436-fresh`
  — the one this bridge's `NaPodstawie(zkId)` call created).
- WZ 164's own position row (`ob_DokMagId = 164`) carries `ob_TowId = 47`,
  `ob_Ilosc = 1.0000` — **exactly** the ZK's own line. `NaPodstawie(zkId)`
  correctly auto-loaded the right product and quantity from the order; the
  mechanism itself is not the problem.

So this session's forced test proves two things at once, and they point in
different directions:

1. **The `NaPodstawie(zkId)` mechanism is mechanically correct** — it resolves
   the right ZK, creates a WZ against it, and auto-loads the exact right line
   (verified by SQL against the WZ's own `dok_Pozycja` row, not inferred).
2. **Running the create branch on an install that ALSO auto-releases
   double-releases stock**, because nothing here suppresses Subiekt's own
   side-effect WZ. This is the shipped guard's entire reason to exist, and
   forcing it off reproduced the exact bug it was written to close.

What this test does **not** prove: behaviour on a genuinely non-auto-releasing
install. Every install this bridge has ever run against, including this
forced test, auto-releases — the forced test only proves the create branch's
own SQL/`NaPodstawie` mechanics are sound, not that a real
non-auto-releasing install's `DodajWZ()` behaves identically end to end (a
different Subiekt configuration could plausibly surface a different edge case
this test never touched, e.g. around VAT registers or stock-location
defaults). Nobody has a non-auto-releasing Subiekt install to test against
right now.

**Revert and revert-confirmation smoke test**: the temporary bypass was
removed, the file diffed byte-identical against `Invoicing.cs.ready`, the
bridge rebuilt (0 errors) and relaunched. A second fresh order (ZK 28/2026,
`dok_Id 165`, order ref `wz-revert-smoke-3436-final`) was invoiced the same
way, with the guard restored:

- Response: `providerInvoiceId: 166`, `"FS 28/2026"`,
  `warehouseReleaseNumber: "WZ 45/2026"`.
- Bridge log: `"Invoicing.EnsureWarehouseRelease: Subiekt already
  auto-released via WZ 45/2026 for invoice 166 - not creating a second
  WZ."` — skip branch, as shipped.
- `tw_Stan` dropped from 41 to **40** — exactly 1 unit, not 2.
- Exactly one new WZ document exists (`dok_Id 167`, "WZ 45/2026") — no second
  one from this bridge.

The guarded (shipped) behaviour is intact after the revert.

## Narrowed claim (superseding the PR body's stronger wording)

- **Verified, twice, on a real auto-releasing install, through the real
  `IssueInvoice` flow**: the skip branch (auto-release detected → no second
  WZ, correct `warehouseReleaseNumber` returned, idempotent retry, single
  stock decrement).
- **Verified once, forced, on the same auto-releasing install**: the create
  branch's `NaPodstawie(zkId)` mechanism resolves the correct ZK and creates
  a WZ with the correct line (product + quantity) when it fires.
- **Not verified**: the create branch firing *naturally* (unforced) on an
  install where Subiekt does not auto-release, end to end, as the original
  bug report's install shape requires. No such install has been available to
  test against.
- **Not a live defect on this install**: the shipped, unmodified code is
  guard-then-skip on this install and does not double-release — the
  double-release only reproduces when the guard is deliberately forced off,
  which the shipped code never does.

## What to do next (whoever has access to a non-auto-releasing install)

1. Point this bridge at a Subiekt install with "rozchoduj automatycznie" (or
   whatever the underlying setting is called) turned off.
2. Issue one invoice through the real, unmodified `IssueInvoice` flow and
   confirm the create branch fires (`"released stock via ..." ` log line, not
   `"already auto-released"`), the resulting WZ's own `dok_Pozycja` row
   matches the ZK's line, and `tw_Stan` drops by exactly the ordered
   quantity — no forced bypass required, because the guard should naturally
   answer `null` there.
