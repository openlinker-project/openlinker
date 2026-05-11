# Implementation Plan: PS 9 seed-script fixes + 6th OL-* fixture

**Date**: 2026-05-11
**Status**: Ready for Review
**Estimated Effort**: ~30 min (done)
**Classification**: DX / dev-stack (no CORE / Integration / Interface / Frontend code touched)

---

## 1. Objective

`pnpm dev:stack:seed-prestashop` aborts on PS 9.0.2 on the first image attach
(introduced by #544). Restore the seeder, and while in there, add a Canon
PowerShot SX740 HS Lite Edition fixture for storefront-locale + MPN coverage.

## 2. Scope

### In scope
1. Rename `_PS_PROD_IMG_DIR_` → `_PS_PRODUCT_IMG_DIR_` (the PS 9.x name in
   `config/defines.inc.php`).
2. Call `$image->createImgFolder()` after `Image::add()` — PS's admin upload
   path does this explicitly; `Image::add()` only writes the DB row and does
   not create `img/p/{nested}/`. Without it, the subsequent `copy()` fails.
3. Add fixture #6:
   - `reference=OL-CANON-SX740LE`, `ean13=4549292246117`,
     `mpn=ACFCANSX740HSLE-S`, price=1499.00, stock=15
   - Polish-language description (sourced from the original Allegro listing)
   - Real Canon product cover image (212 KB JPG, EXIF stripped)
4. Extend `olCreateBaseProduct` helper to forward `$f['mpn']` to
   `$product->mpn` (mirrors how `ean13` is already forwarded). Minimal
   touch; backward-compatible (defaults to `''`).
5. Bump idempotency guard `$existingFixtureCount >= 5` → `>= 6`.
6. Update `seed-images/LICENSES.md` with an honest row for the new image
   marked **Not CC0 — manufacturer photo, dev-fixture use only**, plus a
   dedicated note paragraph explaining the policy deviation. (User
   explicitly chose to commit the manufacturer photo for brand-accurate
   storefront smoke-testing.)

### Out of scope
- No new ports, services, adapters, or migrations.
- No changes to `apps/api`, `apps/web`, `apps/worker`, `libs/core`,
  `libs/integrations`, `libs/shared`.
- No new CC0 substitute sourcing for the Canon image (deferred).

## 3. Architecture Mapping

N/A — these are dev-stack PHP scripts run inside the local PrestaShop
container. They do not participate in the hexagonal architecture. No
boundary is crossed.

## 4. Risks

- **Licensing of Canon image**: User-approved deviation. Documented in
  `LICENSES.md` to keep provenance honest.
- **PS image-folder permissions**: `createImgFolder()` does `@mkdir + @chmod`;
  same code path PS admin uses. If the bind-mount perms are wrong it would
  surface during a re-seed regardless of this PR.

## 5. Validation

- PHP `-l` syntax check passes inside the PS container.
- `pnpm lint`, `pnpm type-check`, `pnpm test` are TS gates — unaffected by
  PHP-only changes, but run for protocol.
- Manual: `pnpm dev:stack:seed-prestashop` ends with
  `* Seed complete — 6 OL-* fixtures inserted` and the PS admin shows all
  6 products with images.

## 6. Acceptance Criteria

- [x] PS 9 constant rename applied in all 5 sites in the seed file.
- [x] `createImgFolder()` called after `Image::add()`; rolls back DB row
      on failure.
- [x] Fixture #6 created with all listed fields; cover image attached.
- [x] Idempotency guard updated.
- [x] LICENSES.md updated with provenance row + deviation note.
- [ ] Quality gate green (`pnpm lint`, `type-check`, `test`).
- [ ] Manual seed re-run produces the expected "6 OL-* fixtures" line.

## 7. Alternatives Considered

- **Source a CC0 generic compact-camera photo from Wikimedia Commons** —
  rejected by user; they want brand-accurate visuals for storefront
  smoke-testing. Documented as a deviation in `LICENSES.md`.
- **Skip extending `olCreateBaseProduct` for `mpn`; set inline after
  `add()`** — rejected. Helper-internal forwarding mirrors `ean13`,
  keeps fixture call sites declarative, and is one line.
