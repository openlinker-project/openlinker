# Implementation Plan — PS Publisher v1 Deferrals: Images + Parameters (#1164)

**Issue:** [#1164](https://github.com/openlinker-project/openlinker/issues/1164) — Integration — implement PrestaShop publisher v1 deferrals (images + parameters)
**Status:** Ready for implementation
**Classification:** Integration (PrestaShop) · Layer: Infrastructure (adapter) · no CORE change · no migration

---


## Summary

`PrestashopProductPublisherAdapter.publishProduct` (#1107) shipped with two acknowledged v1 deferrals, each producing a `PublishProductResult.warnings` entry rather than silently dropping the data:

1. **`imageUrls`** — PS WebService images require a binary multipart POST to `/api/images/products/{id}` (per-image raw bytes). Currently warned and skipped.
2. **`parameters`** — PS attributes map to `product_features` + `product_feature_values` resources requiring multi-step resolve-or-create provisioning. Currently warned and skipped.

This plan implements both deferrals in their natural scope (infrastructure adapter layer only — no CORE change needed).

---

## Goals

**Primary:**
- Implement image upload: after product create/upsert, fetch each `cmd.content.imageUrls[]` URL and POST binary bytes to `/api/images/products/{productId}`. Best-effort per image (warn + continue on per-image failure); remove the static v1-deferral warning on the success path.
- Implement parameter provisioning: resolve-or-create PS `product_features` + `product_feature_values` for each `cmd.parameters[]` entry; include the resulting associations in the product body. Propagate provisioning failures (mirrors `provisionCategory`). Remove the static v1-deferral warning once implemented.

**Non-goals:**
- No CORE domain types touched — `PublishProductCommand`, `OfferParameter`, `PublishProductResult` stay as-is.
- No new capability port or sub-capability — the existing `ShopProductManagerPort` already covers this.
- No migration — feature/feature_value rows are PS-side resources, not OL schema.
- No integration test (PrestaShop Testcontainer would be needed; integration test is a separate follow-up).
- Image ordering / cover-image designation is out of scope for v1 (PS assigns a default cover automatically).

---

## Architecture Analysis

### Layer mapping

Both deferrals are entirely inside `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/` — the same file that already owns `publishProduct`. No CORE boundary is crossed.

### Client contract gap (images only)

The `IPrestashopWebserviceClient` interface exposes `createResource / updateResource / listResources / getResource / deleteResource` — all XML-body operations. Binary multipart upload to `/api/images/products/{id}` does **not** fit this shape: it sends raw bytes in a `multipart/form-data` form, not an XML envelope, and the response is a minimal resource record (image id only). A new `uploadImage` method must be added to the interface and its implementation.

### Existing reference patterns

| Pattern | File | Maps to |
|---|---|---|
| `updateStock` best-effort | adapter, line ~243 | Image upload best-effort posture |
| `provisionCategory` resolve-or-create | adapter, line ~140 | Feature/FeatureValue provisioning |
| `langField` helper | adapter, line ~45 | Shared — used for all PS multilingual fields |

### PrestaShop WS API (images)

```
POST {baseUrl}/api/images/products/{productId}
Authorization: Basic {base64(apiKey:)}
Content-Type: multipart/form-data
Body: field named "image" containing the raw image bytes
Response: PS resource envelope — contains `image.id` (string)
```

Fetching the image bytes from an external URL uses Node's global `fetch()` (Node 18+, same as the rest of the codebase) before handing bytes to the PS client.

### PrestaShop WS API (features)

```
# List features
GET /api/product_features?filter[name]={name}&display=full
Response: array of { id, name: PrestashopLangField }

# Create feature
POST /api/product_features
Body XML: { name: langField(name) }
Response: { id, name }

# List values for a feature
GET /api/product_feature_values?filter[id_feature]={featureId}&display=full
Response: array of { id, id_feature, value: PrestashopLangField }

# Create feature value
POST /api/product_feature_values
Body XML: { id_feature: featureId, value: langField(valueName) }
Response: { id, id_feature, value }
```

Feature associations in the product body:
```json
{
  "associations": {
    "product_features": {
      "product_feature": [
        { "id": "featureId", "id_feature_value": "featureValueId" }
      ]
    }
  }
}
```

`parameters` carries an `OfferParameter` array. Each entry's `id` field is the feature name (string); `values[]` contains the value names. For PS, only string `values` are used — `valuesIds` and `rangeValue` are marketplace-specific fields with no PS analogue and are skipped (warned).

---

## Step-by-Step Implementation Plan

### Step 1 — Extend PS WS client interface (`prestashop-webservice.client.interface.ts`)

**File:** `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.interface.ts`

Add `uploadImage` to `IPrestashopWebserviceClient`:

```typescript
/**
 * Upload an image file to a PS resource via multipart/form-data POST.
 *
 * Used for product images (`/api/images/products/{productId}`). The PS WS
 * image API does not use the XML envelope — it is a raw multipart upload.
 * Returns the PS-assigned image id on success.
 *
 * @param resourcePath - PS WS image resource path, e.g. `images/products/42`
 * @param imageBytes   - Raw image bytes
 * @param mimeType     - MIME type of the image (e.g. `image/jpeg`)
 * @param filename     - Optional filename hint (defaults to `image.bin`)
 * @throws PrestashopAuthenticationException on 401
 * @throws PrestashopApiException on other API errors
 */
uploadImage(
  resourcePath: string,
  imageBytes: Uint8Array,
  mimeType: string,
  filename?: string,
): Promise<{ id: string }>;
```

`resourcePath` is used instead of `(resource, id)` because the images endpoint is `images/products/{id}` — a two-segment path not wrappable by the existing `PrestashopQueryBuilder.buildResourcePath(resource, id)` helper.

**Acceptance criteria:**
- `IPrestashopWebserviceClient` gains the `uploadImage` method signature.
- No other interface members changed.

---

### Step 2 — Implement `uploadImage` in `PrestashopWebserviceClient`

**File:** `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts`

Implement the new interface method. Key details:

```typescript
async uploadImage(
  resourcePath: string,
  imageBytes: Uint8Array,
  mimeType: string,
  filename = 'image.bin',
): Promise<{ id: string }> {
  const url = `${this.baseUrl}/api/${resourcePath}`;
  const form = new FormData();
  form.append('image', new Blob([imageBytes], { type: mimeType }), filename);

  const headers = new Headers();
  headers.set('Authorization', `Basic ${this.getBasicAuth()}`);
  // No Content-Type override — fetch sets it with the multipart boundary.
  // Output-Format: XML so the response is parseable the same way as writes.
  headers.set('Output-Format', 'XML');

  const response = await fetch(url, { method: 'POST', headers, body: form });
  if (!response.ok) {
    this.handleError(response.status, await response.text(), url);
  }
  const body = await response.text();
  const contentType = response.headers.get('content-type') ?? undefined;
  const parsed = PrestashopResponseParser.parse(body, contentType, 'xml') as Record<string, unknown>;

  // PS image response: { prestashop: { image: { id: '42', ... } } } or similar
  const imageNode =
    ((parsed?.prestashop as Record<string, unknown>)?.image as Record<string, unknown>) ??
    (parsed?.image as Record<string, unknown>);
  const id = String(imageNode?.id ?? imageNode?.['@_id'] ?? '');
  if (!id) {
    throw new PrestashopApiException(`Unexpected image upload response from ${url}`, undefined, body);
  }
  return { id };
}
```

Notes:
- Reuses `handleError` and `getBasicAuth` already on the class (private, accessible from the same class).
- Does NOT go through `requestWithRetry` — image uploads are idempotent from the PS side (each POST creates a new image), so retrying on 5xx would create duplicate images. Best-effort is handled at the adapter level.
- `PrestashopResponseParser.parse` is the existing static helper; `'xml'` is passed explicitly because image upload response is always XML.

**Acceptance criteria:**
- `PrestashopWebserviceClient` compiles with the new method.
- Integration test of this specific method is deferred (requires PS Testcontainer); unit test coverage comes via the adapter-level spec (client is mocked).

---

### Step 3 — Add new wire types (`prestashop-product-publish.types.ts`)

**File:** `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/prestashop-product-publish.types.ts`

Add to the end of the file:

```typescript
/** Item from GET /api/product_features (list response). */
export interface PrestashopFeatureListItem {
  id: string | number;
  name: string | PrestashopLangField;
}

/** Response from POST /api/product_features. */
export interface PrestashopFeatureResponse {
  id: string | number;
  name: string | PrestashopLangField;
}

/** Item from GET /api/product_feature_values (list response). */
export interface PrestashopFeatureValueListItem {
  id: string | number;
  id_feature: string | number;
  value: string | PrestashopLangField;
}

/** Response from POST /api/product_feature_values. */
export interface PrestashopFeatureValueResponse {
  id: string | number;
  id_feature: string | number;
  value: string | PrestashopLangField;
}

/** A resolved feature association ready to embed in the product body. */
export interface PrestashopFeatureAssociation {
  id: string;           // featureId
  id_feature_value: string;  // featureValueId
}
```

Also extend `PrestashopProductWriteBody.associations` to include the new field:

```typescript
// In PrestashopProductWriteBody.associations
associations?: {
  categories?: { category: Array<{ id: string }> };
  product_features?: { product_feature: PrestashopFeatureAssociation[] };
};
```

**Acceptance criteria:**
- All new types exported.
- `PrestashopProductWriteBody.associations` includes `product_features`.
- No CORE types modified.

---

### Step 4 — Implement both deferrals in `PrestashopProductPublisherAdapter`

**File:** `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/prestashop-product-publisher.adapter.ts`

#### 4a — Remove the static deferral warnings (lines 64–87)

Remove the two `if` blocks that produce "not yet supported" warnings. The upstream v1-deferral guards are replaced by the actual implementation.

#### 4b — Add `private async provisionFeatures()` method

```typescript
/**
 * Resolve-or-create PS product_features + product_feature_values for every
 * `OfferParameter` entry. Mirrors `provisionCategory`: propagates API
 * failures (the product body would be incomplete without its features).
 *
 * Only `values[]` (string values) are supported for PS Features. Entries
 * with `valuesIds`/`rangeValue` only are skipped with a warning (PS has no
 * equivalent concept for dictionary-id or range parameters).
 *
 * @returns Array of { id, id_feature_value } ready for product.associations.
 */
private async provisionFeatures(
  parameters: OfferParameter[],
  languageId: string,
  warnings: string[],
): Promise<PrestashopFeatureAssociation[]> {
  const associations: PrestashopFeatureAssociation[] = [];

  for (const param of parameters) {
    const stringValues = param.values?.filter((v) => v.length > 0) ?? [];
    if (stringValues.length === 0) {
      warnings.push(
        `parameters: parameter "${param.id}" has no string values — ` +
          'only string values are supported for PrestaShop features; skipped.',
      );
      continue;
    }

    // 1. Resolve or create the feature
    const features = await this.client.listResources<PrestashopFeatureListItem>(
      'product_features',
      { custom: { 'filter[name]': param.id } },
    );
    const featureMatch = features.find(
      (f) => this.extractLangText(f.name, languageId) === param.id,
    );

    let featureId: string;
    if (featureMatch) {
      featureId = String(featureMatch.id);
    } else {
      const created = await this.client.createResource<PrestashopFeatureResponse>(
        'product_features',
        { name: langField(param.id, languageId) },
      );
      featureId = String(created.id);
    }

    // 2. For each value, resolve or create a feature_value
    for (const valueName of stringValues) {
      const values = await this.client.listResources<PrestashopFeatureValueListItem>(
        'product_feature_values',
        { custom: { 'filter[id_feature]': featureId } },
      );
      const valueMatch = values.find(
        (v) => this.extractLangText(v.value, languageId) === valueName,
      );

      let featureValueId: string;
      if (valueMatch) {
        featureValueId = String(valueMatch.id);
      } else {
        const created = await this.client.createResource<PrestashopFeatureValueResponse>(
          'product_feature_values',
          { id_feature: featureId, value: langField(valueName, languageId) },
        );
        featureValueId = String(created.id);
      }

      associations.push({ id: featureId, id_feature_value: featureValueId });
    }
  }

  return associations;
}
```

#### 4c — Add `private async uploadImages()` method

```typescript
/**
 * Best-effort image upload: fetches each URL's bytes and POSTs to the PS
 * images resource. Per-image failure adds a warning and continues — mirrors
 * the `updateStock` self-healing posture so a single bad URL or transient
 * error cannot block the publish result.
 */
private async uploadImages(
  productId: string,
  imageUrls: string[],
  warnings: string[],
): Promise<void> {
  for (const url of imageUrls) {
    try {
      const fetchResponse = await fetch(url);
      if (!fetchResponse.ok) {
        warnings.push(
          `imageUrls: failed to fetch image ${url} (HTTP ${fetchResponse.status}) — image skipped.`,
        );
        continue;
      }
      const buffer = await fetchResponse.arrayBuffer();
      const imageBytes = new Uint8Array(buffer);
      const mimeType = fetchResponse.headers.get('content-type') ?? 'application/octet-stream';
      await this.client.uploadImage(`images/products/${productId}`, imageBytes, mimeType);
    } catch (err) {
      warnings.push(
        `imageUrls: failed to upload image ${url} — ${(err as Error).message ?? 'unknown error'}. Image skipped.`,
      );
    }
  }
}
```

#### 4d — Wire both paths into `publishProduct`

Updated flow in `publishProduct`:

```typescript
async publishProduct(cmd: PublishProductCommand): Promise<PublishProductResult> {
  const languageId = ...;
  const warnings: string[] = [];

  // 1. Provision features (hard-fail if API error — mirrors provisionCategory)
  const featureAssociations =
    cmd.parameters != null && cmd.parameters.length > 0
      ? await this.provisionFeatures(cmd.parameters, languageId, warnings)
      : [];

  // 2. Build body (now includes feature associations)
  const body = this.buildProductBody(cmd, languageId, featureAssociations);

  // 3. Create or upsert product (same logic as before)
  // ...

  const productId = String(response.id);

  // 4. Update stock (best-effort — unchanged)
  await this.updateStock(productId, cmd.stock);

  // 5. Upload images (best-effort — new)
  if (cmd.content?.imageUrls != null && cmd.content.imageUrls.length > 0) {
    await this.uploadImages(productId, cmd.content.imageUrls, warnings);
  }

  const status: PublishProductStatus = String(response.active) === '1' ? 'published' : 'draft';
  return {
    externalProductId: productId,
    status,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
```

#### 4e — Update `buildProductBody` signature and body

Add `featureAssociations: PrestashopFeatureAssociation[]` parameter. When non-empty, merge into `body.associations.product_features`:

```typescript
private buildProductBody(
  cmd: PublishProductCommand,
  languageId: string,
  featureAssociations: PrestashopFeatureAssociation[],
): PrestashopProductWriteBody {
  // ... existing logic ...

  if (featureAssociations.length > 0) {
    body.associations = {
      ...body.associations,
      product_features: { product_feature: featureAssociations },
    };
  }

  return body;
}
```

**Acceptance criteria:**
- Static "not yet supported" warnings are gone.
- `publishProduct` with `imageUrls` calls `client.uploadImage` per image; per-image failure produces a warning entry, does not throw.
- `publishProduct` with `parameters` provisions features and includes associations in the product body.
- `publishProduct` with both `imageUrls` and `parameters` runs both paths.
- `publishProduct` without either field behaves identically to before.

---

### Step 5 — Update unit tests

**File:** `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/__tests__/prestashop-product-publisher.adapter.spec.ts`

#### 5a — Extend `makeClient()` helper

Add `uploadImage: jest.fn()` to the mocked client object.

#### 5b — Update existing v1-deferral tests

The two existing tests:
- `'should emit a warning when imageUrls are provided (v1 deferral)'`
- `'should emit a warning when parameters are provided (v1 deferral)'`

These tests currently assert that warnings are emitted. Once implemented, the success path should **not** emit a warning. Update these tests:

- For imageUrls: mock `global.fetch` to return a valid 200 response with bytes, mock `client.uploadImage` to resolve. Assert `result.warnings` is `undefined` or does not contain the old message.
- For parameters: mock `client.listResources` to return empty arrays (create path), mock `client.createResource` to return feature + feature_value stubs. Assert `result.warnings` is `undefined` or does not contain the old message.

#### 5c — New tests for image upload

```
describe('image upload')
  it('should upload each image and return no warnings on success')
  it('should warn and continue when a single image fetch fails (non-200)')
  it('should warn and continue when a single image fetch throws')
  it('should warn and continue when client.uploadImage throws (best-effort)')
  it('should produce one warning per failed image when multiple fail')
  it('should not call uploadImage when imageUrls is absent')
  it('should not call uploadImage when imageUrls is empty array')
```

Global `fetch` is spied on via `jest.spyOn(global, 'fetch')` in the image upload tests to simulate the external URL download. `client.uploadImage` is the mocked PS upload.

#### 5d — New tests for parameter provisioning

```
describe('parameter provisioning')
  it('should provision a new feature and a new value, associating them on the product body')
  it('should reuse an existing feature (matched by name) when already present in PS')
  it('should create a new feature value when feature exists but value is absent')
  it('should emit a warning for parameters with no string values (valuesIds/rangeValue only)')
  it('should propagate API error when feature list call throws')
  it('should produce multiple associations for a parameter with multiple values')
  it('should not call listResources for product_features when parameters is absent')
```

For the "propagate API error" test: mock `client.listResources` for `product_features` to reject. Assert `publishProduct` rejects (the error propagates, not just warned).

**Acceptance criteria:**
- All new tests pass.
- Updated deferral tests pass with the correct (no static warning) behavior.
- `pnpm test` (unit suite) passes with zero failures.

---

## Testing Strategy

| Layer | Coverage |
|---|---|
| `uploadImage` in `PrestashopWebserviceClient` | Not unit-tested directly (client is mocked at adapter level). Integration test deferred — requires PS Testcontainer. |
| Image upload (adapter) | Unit tests in `adapter.spec.ts` — mock both global `fetch` and `client.uploadImage`. |
| Feature provisioning (adapter) | Unit tests in `adapter.spec.ts` — mock `client.listResources` and `client.createResource`. |
| Existing behavior unchanged | All existing spec tests pass without modification to scenarios unrelated to the two deferrals. |

**No integration test in scope for this issue.** A separate issue should track an integration test using a real PS Testcontainer to validate the actual multipart upload and feature association end-to-end.

---

## Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| PS image field name differs from `"image"` | PS WS documentation states the field is `image`. If a custom PS install overrides this, the upload will fail gracefully (best-effort warn). |
| Image URL requires auth or redirects | `fetch(url)` follows redirects by default (Node 18). For auth-protected URLs the fetch will fail → per-image warning, not a hard stop. |
| PS feature resolve-or-create race condition (two concurrent publishes) | Unlikely for this adapter (publishes run serially per job), but if it happens PS will return a duplicate-key error on `createResource`. This propagates as a `PrestashopApiException` (5xx or 4xx), and the job retries. On retry, `listResources` finds the already-created feature. Safe convergence. |
| Large images / timeout | `uploadImage` uses global `fetch` without a timeout guard. For images >10 MB on a slow PS install, uploads may time out at the Node level. Out of scope for v1 — the per-image warning path handles any throw. |
| `product_feature_values` for the same feature name returned by PS in an ambiguous list | The filter is `filter[id_feature]` (exact match by id) — unambiguous for value lookup once feature id is resolved. |
| `parameters` entry with `valuesIds` only (no `values`) | Skipped with warning (PS has no "dictionary id" concept). Documented in `provisionFeatures` implementation. |
| `parameters` entry with multiple `values` | Produces multiple `PrestashopFeatureAssociation` entries for the same `featureId`. PS associates one feature with one value per entry — if multiple values are needed for the same feature, each is its own row in `product_features.product_feature`. This is the correct PS WS model. |
| Build artifact staleness after plan lands | Rebuild before type-check: `pnpm -r --filter "./libs/**" build` (lessons.md). |

---

## Validation Checklist

- [x] Follows hexagonal architecture — changes are entirely within `libs/integrations/prestashop/` (infrastructure adapter layer)
- [x] Respects CORE ↔ Integration boundary — no CORE type touched, no boundary crossed
- [x] Uses existing patterns — `updateStock` best-effort for images, `provisionCategory` resolve-or-create for features
- [x] Idempotency considered — image upload is not idempotent (creates new images on each publish); mitigated by the fact that publishProduct on upsert path updates the product body without re-uploading unless `imageUrls` is present in the command
- [x] Rate limits & retries — `uploadImage` does NOT go through `requestWithRetry` to avoid duplicate image creation on retry
- [x] Error handling comprehensive — hard-fail for feature provisioning, best-effort per image, both propagate auth errors unchanged
- [x] Testing strategy complete — unit tests cover success + failure paths for both deferrals
- [x] Naming conventions followed — `uploadImage`, `provisionFeatures`, `uploadImages` follow camelCase private method conventions
- [x] File structure matches standards — types in `*.types.ts`, no inline type definitions in adapter
- [x] No `any` types — `Uint8Array`, `PrestashopFeatureAssociation[]`, proper generics used throughout
- [x] No architecture boundary violations

---

## Questions & Assumptions

1. **PS image field name is `"image"`** — assumed based on PS WS documentation. If the actual PS install uses a different field name, `uploadImage` fails gracefully (best-effort warn at adapter level).

2. **`OfferParameter.id` is the human-readable feature name** — the issue states "parameters would map to product Features". The `id` field on `OfferParameter` is defined as "destination parameter identifier" — for PS, this is the feature's display name (since PS WS features are identified by multilingual name, not a stable numeric id from the OL perspective). This interpretation is consistent with the open-world pass-through posture described in ADR-024 §Flow.

3. **Parameters provisioning failure propagates (does not warn-and-continue)** — mirrors the `provisionCategory` posture stated in the issue. If best-effort is preferred for parameters too, add a try/catch in `provisionFeatures` and append to `warnings` instead of throwing.

4. **Image upload happens after product create/upsert** — PS images are attached to an existing product id. The product must exist before images can be uploaded.

5. **No cover-image control** — PS automatically designates the first uploaded image as the cover. Explicit cover-image designation is a potential follow-up.

---

## File Touch Summary

| File | Change |
|---|---|
| `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.interface.ts` | Add `uploadImage` signature |
| `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.ts` | Implement `uploadImage` |
| `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/prestashop-product-publish.types.ts` | Add Feature/FeatureValue wire types + `PrestashopFeatureAssociation`; extend `PrestashopProductWriteBody.associations` |
| `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/prestashop-product-publisher.adapter.ts` | Remove deferral warnings; add `provisionFeatures` + `uploadImages`; update `buildProductBody`; wire into `publishProduct` |
| `libs/integrations/prestashop/src/infrastructure/adapters/product-publisher/__tests__/prestashop-product-publisher.adapter.spec.ts` | Extend mock client; update deferral tests; add image + parameter test suites |

**No migration. No CORE change. No new npm dependency.**
