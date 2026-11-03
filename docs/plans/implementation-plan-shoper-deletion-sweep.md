# Implementation Plan: Shoper ProductMaster — deletion detection and sweep enumeration (#3678)

Epic: #3640. Stacked on #3677. Rules: ADR-048, #1599, #1688, #1689.

## What was already true (so this task is small)

- `listExternalIds` shipped in #3675 with the properties this issue asks for: ascending `product_id`, page-aligned offsets only (a non-aligned window is refused), `limit` capped at 50.
- Sweeps are registered core-side by capability (`CORE_CAPABILITY_TASKS`, `capability: 'ProductMaster'`: `master.product.syncAll`, `.reconcile`, `.syncDelta`), so `ProductMaster` in the manifest (#3675) already enrols a connection. No scheduler code to write.
- `ModifiedProductLister` is not implemented, so the delta pass skips Shoper.

## Live findings (trial shop)

| Request | Answer |
|---|---|
| `GET /products/999999999` | `404 {"error":"invalid_request","error_description":"Resource not found"}` |
| `GET /products/abc`, `/products/0` | same 404 envelope |
| `GET /productz/1` (wrong path) | **`400`** `{"error":"invalid_request","error_description":"Missing MODULE 'productz'"}` |
| no token | `401` |
| real non-Shoper host (`example.com`) | bare `404` |

So a 404 **with the envelope** is Shoper saying the resource is absent; a 404 without it is not Shoper's statement.

## Design

- `ShoperApiError.isResourceNotFound()` = `404` AND `errorCode === 'invalid_request'` (keyed on the envelope, not on the description text).
- `getProduct` translates exactly that to `MasterProductNotFoundError(productId, connectionId, cause)`. Everything else (bare 404, 401, 403, 429, 5xx, network, missing mapping) is untouched.
- No translation in `getProductVariants` / categories / tax: a product with no stock rows is an *inferred* absence (#1688 rule) and `getProduct` is the port boundary core stales on.

## Steps

1. `isResourceNotFound` + spec. 2. `getProduct` translation + adapter spec (envelope vs six non-deletions, missing mapping, no-stock-rows). 3. Enumeration specs: no gaps/duplicates across pages for several catalogue sizes, empty page past the end, no `ModifiedProductLister`. 4. README. 5. Live smoke incl. a real non-Shoper host.
