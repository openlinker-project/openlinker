# Implementation Plan — #424: PrestaShop image-variant + Allegro dimension early-reject

## 1. Goal

Allegro's `productSet[0].product.images[]` validator rejects offer creation with `ProductValidationException: TOO_SMALL_IMAGE` when any image's longer side is < 400px. Confirmed by sandbox repro on 2026-04-27 — the offer-side `body.images[]` validator is lenient and accepted the same image, but the inline-product validator (introduced in #420 / commit `100a222`) is stricter.

Two cooperating root causes:

1. **PrestaShop adapter requests the wrong image variant.** `PrestashopProductMapper.buildImageUrl` (line 393-397) hardcodes `home_default` — a thumbnail variant (typically 250×250px on a default PS install). The TODO at line 390-391 explicitly flags this for replacement: *"image type ('home_default') is fixed for v1. Expose via options when detail-page or retina sizes land."* Most PS installs serve `large_default` ≥ 800px on the longer side, which clears the 400px gate.
2. **No early dimension validation in the upload pipeline.** `uploadImagesViaAllegro` validates content-type but not dimensions. When the operator's source image is *genuinely* too small (or PS happens to serve a small `large_default`), we still upload bytes to Allegro's CDN and only learn it's too small at the very end of the offer-creation flow — terrible diagnostics.

The fix is two coordinated changes:

- **Switch PS to `large_default`.** Closes the existing TODO. Solves the common case where PS has a high-res source but our adapter was requesting a thumbnail.
- **Add dimension validation to the Allegro upload util.** When source image's longer side < 400px, reject with `IMAGE_TOO_SMALL_FOR_PRODUCT` *before* bytes ever leave OL — operator sees an actionable error in the Job-detail view with a clear reason.

## 2. Layer classification

| Layer | Change |
|---|---|
| **CORE** | None — image dimensioning is an Allegro-specific platform constraint. |
| **Integration (PrestaShop)** | Change `home_default` → `large_default` in `PrestashopProductMapper.buildImageUrl`. Optionally expose as a per-connection mapper option with `large_default` as default (closes the inline TODO). |
| **Integration (Allegro)** | Add dimension validation to `uploadImagesViaAllegro`. New error code `IMAGE_TOO_SMALL_FOR_PRODUCT`. Threshold constant `ALLEGRO_PRODUCT_IMAGE_MIN_LONGER_SIDE_PX = 400` (named per the validator path it gates). New runtime dependency: `image-size` (~3KB, zero deps, MIT, 56M weekly downloads — battle-tested for header-only dimension extraction). |
| **Interface (API)** | None. |
| **Frontend** | None — error surfaces via the existing `mutation.error` Alert in `CreateOfferWizard`, same path as today's `IMAGE_DOWNLOAD_FAILED` etc. |
| **DX** | `package.json` adds `image-size` to the Allegro package's runtime deps. |

## 3. Non-goals

- **No client-side upscaling.** Generating 400px from a 200px source produces blurry results that won't sell on a marketplace. If the PS image is genuinely small, surface the failure clearly.
- **No backend image-CDN integration** (e.g., Sharp resize on the worker). Out of MVP scope.
- **No per-PS-instance image-variant probing.** The PS `/api/images/products/{id}/{imageId}` metadata endpoint returns the list of available types, but iterating it adds a per-request HTTP round-trip we don't need today. `large_default` is the standard variant on every PS install we've encountered; the Allegro early-reject is the safety net for outliers.
- **No fallback chain** (`large_default` → `medium_default` → `home_default`). Same reason — over-engineering for the MVP. If a future PS install genuinely doesn't have `large_default`, the adapter throws at download time with a clear `IMAGE_DOWNLOAD_FAILED` (404) and we extend then.
- **No dimension validation for `body.images[]`** (offer-section, not inline-product). Allegro's offer-side validator is more lenient; today we have no evidence of a 400px requirement there. If an Allegro update tightens that path, we extend the gate.

## 4. Design

### 4.1 PrestaShop image-variant bump

**Current** (`prestashop-product.mapper.ts:393-397`):

```typescript
private buildImageUrl(imageId: string): string {
  const base = this.options.storefrontBaseUrl.replace(/\/+$/, '');
  const split = this.splitImageId(imageId);
  return `${base}/img/p/${split}/${imageId}-home_default.jpg`;
}
```

**After** — variant becomes a per-connection option with a sane default:

```typescript
// prestashop-product.mapper.types.ts
export interface PrestashopProductMapperOptions {
  storefrontBaseUrl: string;
  currency?: string;
  /**
   * PrestaShop image-variant suffix used in the public storefront URL
   * (`/img/p/{split}/{imageId}-{imageVariant}.jpg`). Defaults to
   * `'large_default'` (~800px on standard PS installs) so images pass
   * Allegro's product-side `productSet[0].product.images` 400px-longer-side
   * rule (#424). Override per connection if the PS instance uses a
   * non-standard variant name or different sizing.
   */
  imageVariant?: string;
}

// prestashop-product.mapper.ts (constants section)
const DEFAULT_IMAGE_VARIANT = 'large_default';

// prestashop-product.mapper.ts (buildImageUrl)
private buildImageUrl(imageId: string): string {
  const base = this.options.storefrontBaseUrl.replace(/\/+$/, '');
  const split = this.splitImageId(imageId);
  const variant = this.options.imageVariant ?? DEFAULT_IMAGE_VARIANT;
  return `${base}/img/p/${split}/${imageId}-${variant}.jpg`;
}
```

The `imageVariant` option is **optional** and the existing factory wiring need not change — undefined falls through to `large_default`. The TODO comment in the original is removed (closed by this change).

### 4.2 Allegro dimension early-reject

**New constant** (in `upload-images-via-allegro.ts`, alongside `ACCEPTED_IMAGE_CONTENT_TYPES`):

```typescript
/**
 * Allegro's `productSet[0].product.images[]` validator rejects images
 * whose longer side is below this threshold with
 * `ProductValidationException: TOO_SMALL_IMAGE`. Confirmed by sandbox
 * repro 2026-04-27 (#424). Apply at download-time so we fail fast with
 * actionable diagnostics instead of incurring an upload + a 422 at the
 * end of the offer-creation flow.
 *
 * The offer-side `body.images[]` validator is lenient — same threshold
 * may eventually apply there too, in which case extend this gate; for
 * now we apply it on the assumption that any image used at offer-creation
 * is also used for the inline product (we mirror them today, #420).
 */
const ALLEGRO_PRODUCT_IMAGE_MIN_LONGER_SIDE_PX = 400;
```

**New error code** (`IMAGE_TOO_SMALL_FOR_PRODUCT`) added to the existing union:

```typescript
function downloadFailure(
  code: 'IMAGE_DOWNLOAD_FAILED' | 'IMAGE_DOWNLOAD_INVALID_TYPE' | 'IMAGE_TOO_SMALL_FOR_PRODUCT',
  message: string,
): DownloadErr { … }
```

**Validation step** — inserted into `downloadImage` after content-type validation, before returning:

```typescript
import imageSize from 'image-size';

// inside downloadImage, after `bytes = new Uint8Array(...)`:
let dimensions: { width?: number; height?: number };
try {
  dimensions = imageSize(bytes);
} catch (error) {
  // Header decode failure — treat as type validation failure rather than
  // a hard reject, because the content-type validator already ran. This
  // path is unlikely (the bytes claimed to be image/jpeg etc. but couldn't
  // be parsed); if hit, it points at corrupt source data.
  const message = error instanceof Error ? error.message : String(error);
  return downloadFailure(
    'IMAGE_DOWNLOAD_INVALID_TYPE',
    `Image URL '${url}': bytes claimed content-type '${contentType}' but could not be decoded — ${message}`,
  );
}

const longerSide = Math.max(dimensions.width ?? 0, dimensions.height ?? 0);
if (longerSide < ALLEGRO_PRODUCT_IMAGE_MIN_LONGER_SIDE_PX) {
  return downloadFailure(
    'IMAGE_TOO_SMALL_FOR_PRODUCT',
    `Image URL '${url}' is ${dimensions.width ?? '?'}×${dimensions.height ?? '?'}px; ` +
      `Allegro requires a longer side ≥ ${ALLEGRO_PRODUCT_IMAGE_MIN_LONGER_SIDE_PX}px ` +
      `for product images. Use a larger source image.`,
  );
}

return { ok: true, contentType, bytes };
```

Failures still flow through the existing `OfferCreateRejectedException` path in `AllegroOfferManagerAdapter.createOffer` — no adapter-level changes needed beyond importing the new error code in tests.

### 4.3 Why the `image-size` package over hand-rolled parsing

Three options enumerated:

1. **DIY header parser** (~50-80 LOC for JPEG/PNG/GIF/WebP). No new dep but real maintenance risk — WebP alone has VP8 / VP8L / VP8X variants with different header formats; getting this wrong means false rejections.
2. **`image-size` (npm: ~3KB compressed, zero deps, MIT)**. 56M weekly downloads, battle-tested by Next.js, Vercel, and most major Node tooling. Reads JPEG / PNG / GIF / WebP / HEIF / TIFF / BMP / ICO / SVG dimensions from the buffer header without a full decode.
3. **`probe-image-size`** (similar but streams from URLs). Heavier, less applicable here since we already have the bytes buffered.

Picking (2). The trade-off is one new runtime dep against ~80 LOC of WebP-spec-encoding maintenance. The package is a textbook MVP-appropriate solution.

### 4.4 Threshold constant naming

The constant is `ALLEGRO_PRODUCT_IMAGE_MIN_LONGER_SIDE_PX = 400` (not `ALLEGRO_IMAGE_MIN_*` or `ALLEGRO_MIN_*`) because:
- It gates the `productSet[0].product.images` validator path specifically.
- The offer-side `body.images` validator is more lenient and may not require 400px.
- Naming the field path keeps the scope-of-applicability obvious to future readers.

If Allegro tightens the offer-side validator later, we either rename to drop the `_PRODUCT_` qualifier or add a peer constant.

## 5. Step-by-step plan

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.types.ts` | Add optional `imageVariant?: string` field to `PrestashopProductMapperOptions` with a JSDoc block referencing #424 and explaining the `large_default` default. | Type compiles; option is optional and consumers without it default to current behaviour (sans the variant change in step 2). |
| 2 | `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts` | (a) Add `const DEFAULT_IMAGE_VARIANT = 'large_default';` (top-of-file constant). (b) `buildImageUrl` reads `this.options.imageVariant ?? DEFAULT_IMAGE_VARIANT`. (c) Remove the existing `home_default` TODO comment (now closed). | Image URLs change from `…-home_default.jpg` to `…-large_default.jpg` for the default path; per-connection override works. |
| 3 | `libs/integrations/prestashop/src/infrastructure/mappers/__tests__/prestashop-product.mapper.spec.ts` | Update existing image-URL assertions (search for `home_default`) to expect `large_default`. Add one new test that exercises the option override (e.g., `imageVariant: 'medium_default'` produces `…-medium_default.jpg`). | All affected assertions updated; one new branch covers the override. |
| 4 | `libs/integrations/allegro/package.json` | Add `"image-size": "^1.0.0"` to `dependencies` (caret-pin the v1 major; v2 broke the default-export API per §8). Run `pnpm install` to record the lockfile entry. | `pnpm install` resolves and lockfile updates; resolved version is `1.x.y`. |
| 5 | `libs/integrations/allegro/src/infrastructure/util/upload-images-via-allegro.ts` | (a) Import `imageSize` from `image-size`. (b) Add `ALLEGRO_PRODUCT_IMAGE_MIN_LONGER_SIDE_PX = 400` constant alongside `ACCEPTED_IMAGE_CONTENT_TYPES`. (c) Extend `downloadFailure` code-union with `'IMAGE_TOO_SMALL_FOR_PRODUCT'`. (d) Add the dimension-check block at the end of `downloadImage` per §4.2. (e) Update the file header to enumerate the new error code alongside the existing three. | Validation runs after content-type check, before the upload step; failures surface through the existing `UploadImagesResult.failures` path. |
| 6 | `libs/integrations/allegro/src/infrastructure/util/__tests__/upload-images-via-allegro.spec.ts` | Add three test branches: (a) returns `IMAGE_TOO_SMALL_FOR_PRODUCT` when source is 200×200px; (b) accepts a 400×400px image (boundary — equal-to-min is fine); (c) returns `IMAGE_DOWNLOAD_INVALID_TYPE` when the bytes claim to be PNG but `image-size` cannot parse them (corrupt buffer). **Fixture strategy: inline base64 PNG constants** (`Buffer.from('…', 'base64')`) for each dimension — most explicit, zero binary in repo, and PNG headers are tiny (~70 bytes for a 1×1 then padded to declared dims via IHDR width/height fields, since `image-size` reads only the IHDR chunk and not the IDAT pixel data). Two constants needed: `PNG_200x200_BASE64` and `PNG_400x400_BASE64`; the corrupt-buffer test uses `Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00])` (PNG signature + truncated). | Three new branches covering the dimension gate; existing branches stay green; no binary files added to the repo. |
| 7 | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` | Add one end-to-end branch: `createOffer` rejects with `OfferCreateRejectedException` containing `IMAGE_TOO_SMALL_FOR_PRODUCT` when the operator's image is < 400px, and **does not** call `POST /sale/product-offers`. Mirrors the existing `IMAGE_DOWNLOAD_FAILED` branch structure. | Adapter-level integration confirms the new code surfaces through the existing rejection path. |
| 8 | All — quality gate | `pnpm lint`, `pnpm type-check`, `pnpm test`. | Clean. |
| 9 | Manual sandbox repro — **hard merge gate** | After deploying, retry the same flow that surfaced this on 2026-04-27 (cat 257933 / Canon variant). Two outcomes are both acceptable evidence #424 is structurally fixed: (a) **offer reaches `active`/`validating`** because PS's `large_default` for that image is ≥ 400px (most likely); (b) **offer rejects with `IMAGE_TOO_SMALL_FOR_PRODUCT`** *before* hitting Allegro because the source image really is small — operator gets actionable diagnostics in the Job detail view. The only failure mode is the original `ProductValidationException: TOO_SMALL_IMAGE` reaching us from Allegro again — that means neither fix landed correctly. | Sandbox round-trip either succeeds or fails-fast with clean diagnostics. |

## 6. Tests-of-record

- **PS mapper spec** — image-URL assertions move to `large_default`; new branch for the option override.
- **Upload util spec** — three new branches: too-small reject, boundary acceptance, undecodable buffer.
- **Adapter spec** — one new end-to-end branch confirming the new error code surfaces correctly.
- **No integration test** — bug is FE/adapter-pure; existing E2E coverage continues to exercise the happy path.

## 7. Validation

- **Hexagonal compliance** — change is purely inside the two integration packages' infrastructure layers. CORE / FE / API DTO untouched. ✅
- **Naming** — `DEFAULT_IMAGE_VARIANT` is UPPER_SNAKE_CASE per engineering-standards.md. `ALLEGRO_PRODUCT_IMAGE_MIN_LONGER_SIDE_PX` similarly. The new error code `IMAGE_TOO_SMALL_FOR_PRODUCT` follows the existing `IMAGE_*_FAILED` convention. ✅
- **Headers** — both modified files already have JSDoc headers; updates note #424. New file (none — strictly additive code in existing files). ✅
- **Tests** — co-located in `__tests__/` per package conventions. ✅
- **Type contract** — extending the error-code union is a strict superset; no consumer breaks. ✅
- **Dependency hygiene** — new package is well-known, zero-dep, MIT, sub-5KB. Justified by single-use case (header-only dimension extraction); the alternative (DIY parser) is real maintenance risk for marginal benefit. ✅
- **Migrations** — none. ✅
- **Public API** — new constant exported from upload-util module so tests can import it; otherwise additive. ✅

## 8. Risks & open questions

- **`large_default` may not be ≥ 400px on every PS instance.** Default theme on PS 1.7+ ships with `large_default` at 800px, but operators can resize it via "Image Settings" in the back-office. If we land in production and an operator has a custom-sized `large_default` < 400px, the early-reject (§4.2) catches it cleanly. Acceptable — no action needed unless we see real-world hits.
- **`image-size` mis-detects on edge-case images.** The package is well-tested but not infallible (e.g., progressive JPEGs without standard SOI markers). We pass the buffer through it after the content-type validator has already accepted it as `image/jpeg|png|gif|webp`, so the input is well-formed in the typical case. Pathological inputs surface as `IMAGE_DOWNLOAD_INVALID_TYPE` per §4.2's error mapping.
- **The `image-size` package's API changed at v2.** v1.x exports a default function `imageSize(bytes)`; v2.x exports a named `imageSize`. Caret-pin to `^1.0.0` (semver allows 1.x.y patches/minors but blocks the v2 break); revisit during the next-major upgrade with a code update.
- **No frontend warning before submit.** Operator only learns the image is too small when they submit. A future enhancement could probe dimensions client-side via the wizard's image-preview step, but that's outside #424's scope. Tracked as a potential follow-up if friction shows up.

## 9. Out of scope (explicitly deferred)

- Client-side image-preview dimension hint in the wizard.
- PS `/api/images/products/{id}/{imageId}` metadata-driven variant probing.
- Backend image resizing pipeline (Sharp / Lambda / etc.).
- Multi-variant fallback chain (`large_default` → `medium_default` → `home_default`).
- Per-marketplace dimension gates (e.g., separate `body.images[]` threshold if Allegro adds one).
