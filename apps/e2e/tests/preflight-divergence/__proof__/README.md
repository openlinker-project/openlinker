# Proof screenshots - preflight divergence

Embeddable evidence for the findings pinned by `../fNN-*.spec.ts`. Each image is captured by the
characterization spec itself, through `captureProof` (`./capture.ts`), while the spec runs against a live
stack.

**These are `before` shots: they are taken while the divergence still exists.** The `before` segment in every
filename is deliberate - once a finding is fixed, the same specs are re-run to produce the `-after-`
counterpart, and the two sit side by side in the issue / PR.

Each finding gets a pair:

| Frame | What it must show |
|---|---|
| `fNN-before-review-ready.png` | The Review step **presenting the row(s) as ready**: the `N ready · M need attention · K excluded` summary and the `Create offers (N)` CTA - the promise. |
| `fNN-before-result.png` | What actually happened: the 400 banner in the confirm modal, or the batch-progress row `failed` with its error code, or (F6) the batch stuck on `Queued`. |

Capture is documentation, never an assertion: `captureProof` swallows every error and returns `null`, so a
missing image can never turn a spec red. The flip side is that **a green run does not imply an image** - a
spec that `test.skip`s never reaches its capture call. Always `ls` this directory after a run.

---

## Status of this directory

> ⚠️ **No `before` images have been produced yet.** They could not be captured on 2026-07-30: the
> `ol-demo-fresh` stack (web `http://localhost:8090`, API `http://localhost:3000`) was re-deployed that
> morning from `/home/nor/projekty/blocky/ol-1689` onto a **new, empty Postgres volume**
> (`ol-demo-fresh_postgres-data`; the previous data is still in `ol-demo-fresh_postgres_data`). The fresh
> database holds exactly **one** connection - the PrestaShop master - so the **Allegro and Erli destinations
> every one of these specs needs are gone**, and all eleven self-skip in ~2 s with
> `no Allegro connection on this stack` / `No active OfferCreator connection …`.
>
> The capture path itself is verified end-to-end (region shot, viewport fallback when the region never
> appears, and a deliberately-throwing `prepare` returning `null` with a `[proof] could not capture …`
> warning). Only the fixtures are missing.
>
> **To produce the images:** restore a stack that carries an active Allegro connection *and* an active Erli
> connection with Allegro category credentials (that is what arms F6 / F10), then run the commands below.
> The suite reads `OL_WEB_URL`, `OL_API_URL`, `OL_ADMIN_USER`, `OL_ADMIN_PASS`, so it can be pointed at any
> stack without editing a file.

---

## Index

Fill the Status column in as images land. "Pending" = not yet captured on any stack.

| Image | Finding | What it shows | Captured by | Status |
|---|---|---|---|---|
| `f01-before-review-ready.png` | F1 | A card-linked row counted ready, `0 need attention`, submit enabled - though its category has a required **offer-section** parameter the wizard never checks. | `f01-offer-section-params.spec.ts`, test 1 | Pending |
| `f01-before-result.png` | F1 | The batch it produced: every child `failed`, failure-details panel open on `PARAMETER_REQUIRED` / `parameters.Stan`. | same test, after the batch terminates | Pending |
| `f02-before-review-ready.png` | F2 | Already-listed variants counted **ready** with the "already on {destination}" chip, submit enabled. | `f02-already-listed-dropped.spec.ts`, test 2 | Pending |
| `f02-before-result.png` | F2 | The confirm modal's red alert: 400 `at least one productId` - the backend dropped every variant it had just called ready. | same test | Pending |
| `f03-before-review-ready.png` | F3 | Flat price `0` accepted with no field error, rows ready, submit enabled. | `f03-zero-price.spec.ts`, test 1 | Pending |
| `f03-before-result.png` | F3 | The confirm modal's red alert: whole-batch 400 with the opaque `price: invalid value`. | same test | Pending |
| `f04-before-review-ready.png` | F4 | 100 % green Review while the destination has **no** `masterCatalogConnectionId` (temporarily cleared by the spec, restored after). | `f04-master-catalog-missing.spec.ts` | Pending |
| `f04-before-result.png` | F4 | The batch: every record `failed` / `MASTER_CATALOG_NOT_CONFIGURED` on `connection.config.masterCatalogConnectionId`. | same test | Pending |
| `f05-before-result.png` | F5 | Batch progress after an accepted submit: per-record failure + expanded `SELLER_DEFAULTS_NOT_CONFIGURED` detail. | `f05-seller-defaults.spec.ts`, test 2 | Pending |
| `f06-before-review-ready.png` | F6 | An Erli row whose entire image set is a single `http://` URL, counted ready, submit enabled. | `f06-erli-image-stuck-pending.spec.ts`, test (a) | Pending |
| `f06-before-result.png` | F6 | The batch that can never terminate: the row still reads **Queued**, no failure-details affordance, no inline reason. | same file, test (b) | Pending |
| `f07-before-review-ready.png` | F7 | Two included rows carrying the **same** barcode, neither flagged - the duplicate check is never batch-wide. | `f07-duplicate-ean.spec.ts`, test 2 | Pending (fixture) |
| `f09-before-review-ready.png` | F9 | Review showing the operator's flat stock (`777`) per sibling of a multi-variant product - the value the backend discards. | `f09-multivariant-stock-policy.spec.ts`, test 2 | Pending |
| `f10-before-review-ready.png` | F10 | Every Erli row ready, `0 need attention`, submit enabled - no category blocker anywhere. | `f10-erli-category-gate.spec.ts`, test 1 | Pending |
| `f10-before-result.png` | F10 | The batch: every child `failed` / `overrides.categoryId` `REQUIRED`. | same test | Pending |
| `f13-before-review-ready.png` | F13 | The blocked sibling flagged **and still switched on**, beside a ready sibling; the CTA's `disabled` attribute is the only barrier. | `f13-blocked-not-excluded.spec.ts`, test 1 | Pending |
| `f13-before-result.png` | F13 | The batch minted from that body - a record exists for the blocked sibling the wizard refused to approve. | same file, test 2 | Pending |
| `f15-before-review-ready.png` | F15 | A multi-variant row still `ready` after a Price-policy edit, submit enabled. | `f15-pricing-policy-rejected.spec.ts`, test 2 | Pending |
| `f15-before-result.png` | F15 | The confirm modal's red alert: whole-request 400, `perProductOverrides[…].pricingPolicy: property pricingPolicy should not exist`. | same test | Pending |

### Findings with only one frame (by construction, not by omission)

| Finding | Missing frame | Why |
|---|---|---|
| **F5** | `review-ready` | The spec submits through the raw API on purpose. The wizard has **no** seller-defaults preflight to photograph - that absence is the finding, and a screenshot of an unrelated Review step would misrepresent it. |
| **F7** | `result` | F7's confirmed half is a wire-level 400 (`DuplicateBatchEanException`) raised before anything is persisted; there is no screen. The scope half (test 2) never submits. |
| **F9** | `result` | The discard is only visible in the persisted offer-creation request snapshot (`request.stock`); no screen renders it - the batch-progress table has no stock column. |

F8, F11, F12 and F14 are out of scope for proof: they are skipped, fixed on this build, or blocked on a
fixture, so there is nothing to photograph.

---

## Regenerating

Run **one spec at a time** - `f04`, `f05` and `f10` mutate shared connection config and restore it, and a
parallel run would collide on the same connections. `pnpm --filter @openlinker/e2e test:e2e -- <args>`
does **not** forward the filter; use `npx` directly from `apps/e2e`:

```bash
cd apps/e2e
npx playwright test --project=preflight-divergence tests/preflight-divergence/f01-offer-section-params.spec.ts
npx playwright test --project=preflight-divergence tests/preflight-divergence/f02-already-listed-dropped.spec.ts
npx playwright test --project=preflight-divergence tests/preflight-divergence/f03-zero-price.spec.ts
npx playwright test --project=preflight-divergence tests/preflight-divergence/f04-master-catalog-missing.spec.ts
npx playwright test --project=preflight-divergence tests/preflight-divergence/f05-seller-defaults.spec.ts
npx playwright test --project=preflight-divergence tests/preflight-divergence/f06-erli-image-stuck-pending.spec.ts
npx playwright test --project=preflight-divergence tests/preflight-divergence/f07-duplicate-ean.spec.ts
npx playwright test --project=preflight-divergence tests/preflight-divergence/f09-multivariant-stock-policy.spec.ts
npx playwright test --project=preflight-divergence tests/preflight-divergence/f10-erli-category-gate.spec.ts
npx playwright test --project=preflight-divergence tests/preflight-divergence/f13-blocked-not-excluded.spec.ts
npx playwright test --project=preflight-divergence tests/preflight-divergence/f15-pricing-policy-rejected.spec.ts

ls -la tests/preflight-divergence/__proof__/   # a green run does NOT imply an image
```

Each command overwrites its own images in place, so a re-run refreshes them without stale leftovers. After a
fix lands, change the `before` literal in that spec's `captureProof(...)` calls to `after` and re-run the
same command to produce the counterpart frames.
