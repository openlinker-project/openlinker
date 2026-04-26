# Implementation Plan — #397 Allegro `createOffer` image-binary upload (Solution B, no-cache)

## 1. Goal

Make `marketplace.offer.create` actually work end-to-end against Allegro for
operators whose PrestaShop image URLs are not publicly reachable from
Allegro's servers (localhost, private IPs, basic-auth, hardened `.htaccess`,
expired tunnels, etc.) — by **downloading bytes from PrestaShop OL-side and
re-uploading them to Allegro's image CDN**, then passing the Allegro CDN URLs
to `POST /sale/product-offers`.

This is Solution B from the issue, in the simplest viable form: **no
caching**. Each `createOffer` call re-downloads from PrestaShop and re-uploads
to Allegro. The "Allegro GCs unattached images" concern that motivates a
cache only arises *if* you cache; without one, every uploaded image is used
in the same call, so GC never opens a window we'd hit.

This subsumes Solution A's operator-clarity win for free: when the OL→PS
download fails (the same conditions that cause the original 422), we surface
a clear `IMAGE_DOWNLOAD_FAILED` error instead of an opaque Allegro 422.

Solution A (HEAD pre-flight) is **discarded**: redundant with the GET we now
have to do anyway.

## 2. Classification

- **Layer:** Integration (Allegro adapter + HTTP client). No CORE, no FE, no
  DB changes, no migration.
- **Files (5 new / 6 edited):**
  - **NEW** `libs/integrations/allegro/src/infrastructure/http/allegro-connection-token-state.ts`
  - **NEW** `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-connection-token-state.spec.ts`
  - **NEW** `libs/integrations/allegro/src/infrastructure/util/upload-images-via-allegro.ts`
  - **NEW** `libs/integrations/allegro/src/infrastructure/util/__tests__/upload-images-via-allegro.spec.ts`
  - **EDIT** `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.interface.ts` — add `postBinary`
  - **EDIT** `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts` — refactor to use `AllegroConnectionTokenState`, add `postBinary`
  - **EDIT** `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-http-client.spec.ts` — update existing constructor calls, add `postBinary` specs
  - **EDIT** `libs/integrations/allegro/src/domain/types/allegro-config.types.ts` — add `uploadBaseUrl?: string`
  - **EDIT** `libs/integrations/allegro/src/application/allegro-adapter.factory.ts` — build shared token state + 2 HTTP clients
  - **EDIT** `libs/integrations/allegro/src/infrastructure/adapters/allegro-connection-tester.adapter.ts` — update `AllegroHttpClient` construction
  - **EDIT** `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` — accept `uploadHttpClient`, wire upload step in `createOffer`
  - **EDIT** `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` — two HTTP-client mocks, fetch spy, update 2 image specs, add 5 new specs

## 3. Design decisions reached during /grill-me

| # | Decision |
|---|---|
| 1 | Two `AllegroHttpClient` instances per connection — one for `api.*`, one for `upload.*`. Both reference a shared `AllegroConnectionTokenState` so a refresh by one is visible to the other. |
| 2 | Partial upload failure → throw `OfferCreateRejectedException`. No skip-and-continue. Allegro GCs the leaked uploads. |
| 3 | Token state: shared mutable state holder (option (a) from Q3). `AllegroHttpClient` no longer owns `accessToken`. |
| 4 | Upload step lives **between** `buildCreateOfferRequest` and the POST. `buildCreateOfferRequest` stays sync + pure. `createOffer` mutates `body.images` after the orchestrator returns. |
| 5 | Strict Content-Type whitelist on PS download: `image/jpeg \| image/png \| image/gif \| image/webp` after stripping params. `image/jpg → image/jpeg` is the only normalization. No magic-byte sniffing, no URL extension fallback. |
| 6 | `AllegroConnectionConfig.uploadBaseUrl?: string` symmetric to existing `apiBaseUrl?`. Default from `environment` (`production → upload.allegro.pl`, `sandbox → upload.allegro.pl.allegrosandbox.pl`). |
| 7 | Buffer (`Uint8Array`), not stream. Parallel `Promise.all` over images. No early-abort via `AbortController` — failures of in-flight peers are discarded silently after the first throw. |
| 8 | Tests: two `jest.Mocked<IAllegroHttpClient>` instances + `jest.spyOn(globalThis, 'fetch')`. Single `IAllegroHttpClient` interface; `postBinary` lives on it. |
| 9 | Three error codes, all `field: 'images'`: `IMAGE_DOWNLOAD_FAILED`, `IMAGE_DOWNLOAD_INVALID_TYPE`, `IMAGE_UPLOAD_FAILED`. No sub-codes for download failure modes (HTTP/timeout/network) — cause goes in `message`. |
| 10 | Standalone util `upload-images-via-allegro.ts` with one exported orchestrator. Internal helpers file-private. |
| 11 | Logging: 1 `debug` at upload start, 1 `debug` at success, 1 `warn` on failure (count + connection only). No per-image chatter. |

## 4. Architecture in 4 boxes

```
                                                                                
┌─────────────────────────────────┐                                            
│ AllegroAdapterFactory           │  builds:                                   
│   per Connection:               │  ┌──────────────────────────────┐          
│   1. AllegroConnectionTokenState│──▶│ AllegroConnectionTokenState  │          
│   2. apiHttpClient (api host)   │  │   accessToken                 │          
│   3. uploadHttpClient (upload)  │  │   tokenExpiresAt              │          
│      ↑both reference (1)↑       │  │   refreshInFlight             │          
└─────────────────────────────────┘  │   cooldownUntil               │          
                                     │   ensureFreshToken()          │          
                                     │   refreshOnUnauthorized()     │          
                                     └──────────────────────────────┘          
                                                                               
┌──────────────────────────────────┐ ┌────────────────────────────────────┐    
│ AllegroOfferManagerAdapter       │ │ upload-images-via-allegro.ts (util)│    
│ ctor(apiClient, uploadClient,…)  │ │  exports: uploadImagesViaAllegro() │    
│                                  │ │                                    │    
│ createOffer(cmd) {               │ │  for each url (parallel):          │    
│   body = buildCreateOfferReq()   │ │    1. fetch(url) — global fetch    │    
│   if (body.images?.length)       │ │       check 2xx, content-type      │    
│     body.images = await          │─▶│    2. uploadClient.postBinary(    │    
│       uploadImagesViaAllegro(    │ │       '/sale/images', contentType, │    
│       this.uploadClient,         │ │       bytes)                       │    
│       body.images)               │ │    3. return location              │    
│   apiClient.post('/sale/...')    │ │                                    │    
│ }                                │ │  any failure → throw               │    
└──────────────────────────────────┘ │  OfferCreateRejectedException      │    
                                     └────────────────────────────────────┘    
```

## 5. Detailed design

### 5.1 `AllegroConnectionTokenState` (new)

Owns the per-connection token state currently scattered on
`AllegroHttpClient`. Both `api` and `upload` HTTP clients reference the same
instance, so a refresh by either is immediately visible to the other.

```ts
export class AllegroConnectionTokenState {
  private accessToken: string;
  private tokenExpiresAt: number | undefined;
  private refreshInFlight: Promise<void> | null = null;
  private proactiveRefreshCooldownUntil: number | undefined;

  constructor(
    private readonly connectionId: string,
    initial: AllegroCredentials,
    private readonly tokenRefreshCallback?: TokenRefreshCallback,
  ) {
    this.accessToken = initial.accessToken;
    this.tokenExpiresAt = AllegroConnectionTokenState.normalizeExpiresAt(initial.expiresAt);
  }

  getAccessToken(): string { return this.accessToken; }

  /** Pre-request hook. Single-flight via `refreshInFlight`. No-op if no callback / no expiresAt / inside cooldown / outside refresh window. */
  async ensureFreshToken(traceId: string, logger: Logger): Promise<void>;

  /** Reactive 401 path. Returns true if refreshed (caller should retry). False if no callback. */
  async refreshOnUnauthorized(traceId: string, logger: Logger): Promise<boolean>;

  // Internal
  private applyRefreshResult(result: TokenRefreshResult): void;
  private static normalizeExpiresAt(value: Date | string | undefined): number | undefined;
}
```

The `ensureFreshToken` and `refreshOnUnauthorized` methods carry the same
behaviour `AllegroHttpClient` has today (5s post-failure cooldown, 60s
refresh window, single-flight) — they're moved verbatim.

### 5.2 `AllegroHttpClient` (refactored)

Constructor signature changes:

**Before:**
```ts
constructor(
  connectionId: string,
  baseUrl: string,
  credentials: AllegroCredentials,
  _config: AllegroConnectionConfig,        // unused
  retryConfig?: Partial<RetryConfig>,
  tokenRefreshCallback?: TokenRefreshCallback,
)
```

**After:**
```ts
constructor(
  connectionId: string,
  baseUrl: string,
  tokenState: AllegroConnectionTokenState,
  retryConfig?: Partial<RetryConfig>,
)
```

Everywhere the existing client reads `this.accessToken`, it now reads
`this.tokenState.getAccessToken()`. `this.ensureFreshToken` delegates to
`this.tokenState.ensureFreshToken`. The 401 reactive path delegates to
`this.tokenState.refreshOnUnauthorized` and uses its boolean return to drive
the existing `TokenRefreshedError` retry mechanism.

The unused `_config` parameter is removed in this refactor — it's not
referenced anywhere except its own destructuring.

**New method — `postBinary`:**

```ts
async postBinary<T = unknown>(
  path: string,
  contentType: string,    // e.g. 'image/jpeg'
  body: Uint8Array,
  options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
): Promise<AllegroHttpResponse<T>>;
```

Routes through the existing `request()` so retry + token-refresh behaviour
are inherited unchanged. The only difference from `post()` is the request
build step: `Content-Type` comes from the parameter (not the JSON default)
and `body` is passed straight through to `fetch()` as a `Uint8Array` (the
Node fetch implementation accepts `BodyInit`, which includes Uint8Array, so
no `JSON.stringify`).

Internally we add one branch in `executeRequest` to skip JSON serialization
when the body is `Uint8Array`. The `Content-Type` for binary callers is set
directly from the argument; for the existing JSON path nothing changes.

### 5.3 Interface (`IAllegroHttpClient`)

Add:

```ts
postBinary<T = unknown>(
  path: string,
  contentType: string,
  body: Uint8Array,
  options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
): Promise<AllegroHttpResponse<T>>;
```

Single shared interface — both `apiHttpClient` and `uploadHttpClient`
implement it. The adapter chooses which client to call. Convention enforces
which host gets binary uploads, not the type system.

### 5.4 `AllegroConnectionConfig`

```ts
export interface AllegroConnectionConfig {
  environment: AllegroEnvironment;
  apiBaseUrl?: string;     // existing
  uploadBaseUrl?: string;  // NEW — defaults from environment if absent
}
```

`AllegroAdapterFactory.getDefaultUploadBaseUrl(env)` mirrors the existing
`getDefaultApiBaseUrl`:

| environment | default `uploadBaseUrl` |
|---|---|
| `production` | `https://upload.allegro.pl` |
| `sandbox` | `https://upload.allegro.pl.allegrosandbox.pl` |

### 5.5 `AllegroAdapterFactory.createAdapters` (edited)

```ts
const tokenState = new AllegroConnectionTokenState(
  connection.id,
  credentials,
  tokenRefreshCallback,
);

const apiHttpClient = new AllegroHttpClient(
  connection.id,
  apiBaseUrl,
  tokenState,
);

const uploadHttpClient = new AllegroHttpClient(
  connection.id,
  config.uploadBaseUrl ?? this.getDefaultUploadBaseUrl(config.environment),
  tokenState, // ✅ same instance
);

const offerManagerAdapter = new AllegroOfferManagerAdapter(
  connection.id,
  apiHttpClient,
  uploadHttpClient,
  identifierMapping,
  connection,
  this.commandRepository,
  this.quantityPollConfig,
);
const orderSourceAdapter = new AllegroOrderSourceAdapter(
  connection.id,
  apiHttpClient, // unchanged — still only needs api host
  connection,
);
```

### 5.6 `AllegroConnectionTesterAdapter` (edited)

The probe creates its own throwaway `AllegroHttpClient` and now needs a
throwaway token state too. No refresh callback — it's a probe; if the token
is bad we want it to fail clearly.

```ts
const tokenState = new AllegroConnectionTokenState(
  connection.id,
  credentials,
  undefined, // no refresh — probe
);
const client = new AllegroHttpClient(
  connection.id,
  apiBaseUrl,
  tokenState,
  { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 },
);
```

### 5.7 `upload-images-via-allegro.ts` (new util)

Public surface — one function. Returns a discriminated result; the adapter
constructs the `OfferCreateRejectedException` with its own `ALLEGRO_ADAPTER_KEY`
constant so the util stays adapter-agnostic.

```ts
export type UploadImagesResult =
  | { ok: true; locations: string[] }     // input order preserved
  | { ok: false; failures: CreateOfferValidationError[] };

export async function uploadImagesViaAllegro(
  uploadHttpClient: IAllegroHttpClient,
  imageUrls: string[],
  options?: {
    fetchImpl?: typeof fetch;
    downloadTimeoutMs?: number;  // default 30_000
  },
): Promise<UploadImagesResult>;
```

Internal flow:

```ts
1. If imageUrls.length === 0 → return { ok: true, locations: [] }.
2. const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
3. const failures: CreateOfferValidationError[] = [];
4. const results = await Promise.all(imageUrls.map(async (url) => {
     // 4a. download
     const download = await downloadImage(url, fetchImpl, downloadTimeoutMs);
     if (download.error) { failures.push(download.error); return null; }
     // 4b. upload
     const upload = await uploadOneImage(uploadHttpClient, download.contentType, download.bytes, url);
     if (upload.error) { failures.push(upload.error); return null; }
     return upload.location;
   }));
5. if (failures.length > 0) return { ok: false, failures };
6. return { ok: true, locations: results as string[] };
```

The util **never throws** for image-related failures — it returns a result.
This keeps the adapter-key string out of the util entirely and gives
`createOffer` one place to decide how to surface the failure.

Internal helpers (file-private):

- `downloadImage(url, fetchImpl, timeoutMs)`:
  - `AbortController` with `setTimeout(timeoutMs)`
  - `await fetchImpl(url, { method: 'GET', signal })`
  - On `AbortError` → return error `{ field: 'images', code: 'IMAGE_DOWNLOAD_FAILED', message: \`Image URL '${url}' timed out after ${timeoutMs}ms\` }`
  - On non-`AbortError` exception → return error with `IMAGE_DOWNLOAD_FAILED` and the message
  - On non-2xx → return error with `IMAGE_DOWNLOAD_FAILED` and `\`Image URL '${url}' returned HTTP ${status}\``
  - Read `response.headers.get('content-type')` → strip `;`-params → `normalizeImageContentType()`
  - If not in whitelist → return error with `IMAGE_DOWNLOAD_INVALID_TYPE` and `\`Image URL '${url}' returned content-type '${ct}', expected image/jpeg|png|gif|webp\``
  - `bytes = new Uint8Array(await response.arrayBuffer())`
  - Return `{ contentType, bytes }`
- `uploadOneImage(client, contentType, bytes, sourceUrl)`:
  - `await client.postBinary<{ location: string }>('/sale/images', contentType, bytes)`
  - On `AllegroApiException` → return error with `IMAGE_UPLOAD_FAILED` and message including `sourceUrl` + status
  - On any other exception → wrap as `IMAGE_UPLOAD_FAILED` with the message
  - Read `response.data.location` — if missing or non-string → error `IMAGE_UPLOAD_FAILED` `\`Allegro upload response missing 'location' for image '${sourceUrl}'\``
  - Return `{ location }`
- `normalizeImageContentType(raw: string | null): string | null`:
  - Strip everything after `;` and trim
  - lowercase
  - `image/jpg → image/jpeg`
  - Return value if in `{image/jpeg, image/png, image/gif, image/webp}`, else null

### 5.8 `AllegroOfferManagerAdapter` — `createOffer` (edited)

Constructor signature:

**Before:**
```ts
constructor(
  connectionId: string,
  httpClient: IAllegroHttpClient,
  identifierMapping: IdentifierMappingPort,
  _connection: Connection,
  commandRepository?: AllegroQuantityCommandRepositoryPort,
  quantityPollConfig?: Partial<QuantityPollConfig>,
)
```

**After:**
```ts
constructor(
  connectionId: string,
  httpClient: IAllegroHttpClient,        // ← api host (unchanged role)
  uploadHttpClient: IAllegroHttpClient,  // ← NEW, upload host
  identifierMapping: IdentifierMappingPort,
  _connection: Connection,
  commandRepository?: AllegroQuantityCommandRepositoryPort,
  quantityPollConfig?: Partial<QuantityPollConfig>,
)
```

`createOffer` body insertion (between `buildCreateOfferRequest` and `httpClient.post`):

```ts
const body = this.buildCreateOfferRequest(cmd);

if (body.images && body.images.length > 0) {
  const originalCount = body.images.length;
  this.logger.debug(
    `Allegro image upload starting: connection=${this.connectionId} count=${originalCount}`,
  );

  const result = await uploadImagesViaAllegro(this.uploadHttpClient, body.images);

  if (!result.ok) {
    const codes = Array.from(new Set(result.failures.map((f) => f.code))).join(',');
    this.logger.warn(
      `Allegro image upload rejected create: connection=${this.connectionId} ` +
        `failed=${result.failures.length}/${originalCount} codes=${codes}`,
    );
    throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, result.failures);
  }

  body.images = result.locations;
  this.logger.debug(
    `Allegro image upload complete: connection=${this.connectionId} count=${body.images.length}`,
  );
}

// existing httpClient.post('/sale/product-offers', body, …) unchanged below
```

## 6. Testing

### 6.1 New util tests (`upload-images-via-allegro.spec.ts`)

9 specs (all assert on the `UploadImagesResult` shape — never on a thrown
exception, since the util never throws for image failures):

1. Empty input → `{ ok: true, locations: [] }`; `fetch` never called, `postBinary` never called
2. Single happy path: 200 + `image/jpeg` + 1 byte → `{ ok: true, locations: ['https://...allegrostatic...'] }`
3. Order preservation: 3 inputs → 3 outputs in input order
4. Download HTTP failure (status 403) → `{ ok: false, failures: [{ code: 'IMAGE_DOWNLOAD_FAILED', message contains URL + '403' }] }`; `postBinary` never called
5. Download timeout (mock fetch rejects with `AbortError`) → `IMAGE_DOWNLOAD_FAILED` with timeout language
6. Wrong content-type (200 + `text/html`) → `IMAGE_DOWNLOAD_INVALID_TYPE`
7. `image/jpg` normalization: PS sends `image/jpg`, util sends `image/jpeg` to Allegro `postBinary` (assert on `postBinary` mock call args)
8. Upload failure (`postBinary` rejects with `AllegroApiException(422)`) → `IMAGE_UPLOAD_FAILED`
9. Mixed (one OK, one 403 download) → `{ ok: false, failures }` with one entry citing only the failing URL

### 6.2 New token-state tests (`allegro-connection-token-state.spec.ts`)

6 specs:

1. **Happy path: `ensureFreshToken` inside refresh window calls the callback, updates `accessToken`, clears cooldown** (the canonical behavior)
2. `ensureFreshToken` no-ops when no callback
3. `ensureFreshToken` no-ops when outside refresh window
4. `ensureFreshToken` calls callback once even under concurrent callers (single-flight via `refreshInFlight`)
5. `ensureFreshToken` records cooldown after callback throws; subsequent calls within cooldown skip the callback
6. `refreshOnUnauthorized`: returns true on success, false when no callback, false when callback throws (and accessToken stays unchanged)

### 6.3 Existing http-client tests (edits)

All `new AllegroHttpClient(...)` constructions update to build a token state
first. Existing behaviour assertions don't change. ~10–15 lines of churn.

**New `postBinary` specs** (added to `allegro-http-client.spec.ts`):

1. Sends raw `Uint8Array` body without JSON-stringifying
2. Sets `Content-Type` from the parameter, overriding the default `application/vnd.allegro.public.v1+json`
3. Still attaches `Authorization: Bearer <token>` from token state (regression guard for the extraction)
4. Inherits 5xx retry from `request()` (one 500 then 200 → succeeds)
5. Inherits 401 reactive refresh from `request()` (one 401 with refresh callback → token refreshes, request retries with new token)

### 6.4 Existing offer-manager adapter tests (edits)

In `describe('createOffer')`'s `beforeEach`:

```ts
let uploadHttpClient: jest.Mocked<IAllegroHttpClient>;
let fetchSpy: jest.SpyInstance;

beforeEach(() => {
  // existing httpClient/identifierMapping/connection setup,
  // PLUS update the api-host mock to include postBinary: jest.fn()
  // so jest.Mocked<IAllegroHttpClient> stays type-correct.
  uploadHttpClient = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    postBinary: jest.fn(),
  } as unknown as jest.Mocked<IAllegroHttpClient>;

  fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    }),
  );

  let i = 0;
  uploadHttpClient.postBinary.mockImplementation(() =>
    Promise.resolve({
      data: { location: `https://images.allegrostatic.com/test/uploaded-${++i}.jpg` },
      status: 201,
      headers: {},
    }),
  );

  adapter = new AllegroOfferManagerAdapter(
    connectionId, httpClient, uploadHttpClient, identifierMapping, connection,
  );
});

afterEach(() => fetchSpy.mockRestore());
```

Two existing specs need updating:

- `"emits images as a flat string[] (Allegro POST /sale/product-offers wire shape)"` —
  expectation flips from `['https://example.com/img.jpg']` to
  `['https://images.allegrostatic.com/test/uploaded-1.jpg']`. Test name stays
  accurate; the wire shape is still `string[]`.
- `"preserves image URL order when multiple images are supplied"` — expect
  `['uploaded-1.jpg', 'uploaded-2.jpg', 'uploaded-3.jpg']` (paths abbreviated).

5 new specs:

1. `"throws OfferCreateRejectedException with IMAGE_DOWNLOAD_FAILED when PrestaShop returns 403"`
2. `"throws OfferCreateRejectedException with IMAGE_DOWNLOAD_INVALID_TYPE when PrestaShop returns text/html with 200"`
3. `"throws OfferCreateRejectedException with IMAGE_UPLOAD_FAILED when Allegro upload returns 422"`
4. `"does not call POST /sale/product-offers when image upload step fails"`
5. `"calls upload host /sale/images with image/jpeg content-type"` (assert on `uploadHttpClient.postBinary` mock call args)

## 7. Step-by-step

| # | Task | File(s) |
|---|---|---|
| 1 | Create `AllegroConnectionTokenState` + spec — **with file headers per `engineering-standards.md` §"File Headers"** | 2 new files in `infrastructure/http/` |
| 2 | Refactor `AllegroHttpClient` to use token state; add `postBinary` — preserve the existing file header | 1 edit (impl), 1 edit (interface), 1 edit (spec) |
| 3 | Update `AllegroConnectionTesterAdapter` ctor call — **inline comment explaining why `tokenRefreshCallback` is intentionally `undefined`** (probe must surface stale tokens, not silently rotate) | 1 edit |
| 4 | Add `uploadBaseUrl?` to config types; update factory to build 2 clients + shared token state | 2 edits |
| 5 | Create `upload-images-via-allegro.ts` util + spec — **with file headers; util never throws for image failures, returns `UploadImagesResult`** | 2 new files in `infrastructure/util/` |
| 6 | Wire upload step into `AllegroOfferManagerAdapter.createOffer`; update its constructor signature; warn-line includes failure codes for at-a-glance triage | 1 edit |
| 7 | Update offer-manager adapter spec: `beforeEach` (two mocks + fetch spy, both mocks include `postBinary: jest.fn()`), update 2 existing image specs, add 5 new specs | 1 edit |
| 8 | `pnpm lint && pnpm type-check && pnpm test` — fix any drift | — |

## 8. Validation against engineering standards

- ✅ **Architecture:** orchestrator util lives under `libs/integrations/allegro/src/infrastructure/util/`. Token state under `infrastructure/http/`. No CORE pollution. The neutral `OfferCreateRejectedException` (CORE) is the only domain type the util references.
- ✅ **Interface separation:** `IAllegroHttpClient` is the interface; `AllegroHttpClient` is the impl. New token-state class is implementation-internal; not exposed as a port.
- ✅ **No `any`** — `Uint8Array`, typed responses, typed validation errors throughout.
- ✅ **Single interface for HTTP clients** — `postBinary` lives on `IAllegroHttpClient`; both api/upload clients implement it.
- ✅ **Naming** — `*-via-allegro.ts` follows the existing `sanitize-allegro-description.ts` util pattern.
- ✅ **No DB / migration impact.**
- ✅ **No new deps** — native fetch only.
- ✅ **Logging** — uses existing `Logger` shared lib; structured fields only; no PII (image URLs are operator-owned PrestaShop URLs).
- ✅ **Backward compat** — `cmd.overrides.imageUrls` empty/null path unchanged. The `uploadBaseUrl?` config field is optional with a sensible default; existing connection rows need no migration.

## 9. Manual sandbox verification (per issue AC)

Post-merge, on connection `eecbdcd2-862a-4f77-acb7-f764592ed3d5`, variant
`ol_variant_0c6eeb1b522144339b0882a225597859`:

- Verify offer creation now **succeeds** (instead of failing with the
  documented `status=422 errors=0`) for variants whose PrestaShop image URLs
  are localhost-only.
- Verify the `upload.allegro.pl.allegrosandbox.pl` host is the one that
  receives the image POSTs (via OL trace logs).
- Verify a deliberately misconfigured PS image (e.g., a URL that 403s) now
  surfaces as `IMAGE_DOWNLOAD_FAILED` with the URL + status in the operator-
  visible error, not as opaque Allegro 422.

## 10. Risks & known limitations

- **Per-create bandwidth.** Every retry re-downloads + re-uploads. Acceptable
  for the typical 1–8 images per variant. If a single seller hits this often
  with many images, caching becomes the next obvious follow-up. **Out of
  scope; track as a separate issue if/when measured.**
- **Allegro upload sandbox host not 100% confirmed** in public docs. The
  default I'm shipping (`upload.allegro.pl.allegrosandbox.pl`) follows
  Allegro's existing `*.allegrosandbox.pl` pattern; the manual verification
  step above will confirm. Operators can override via the new
  `uploadBaseUrl` config field if needed.
- **HEAD vs GET-from-Allegro asymmetry no longer applies** — Solution B
  takes Allegro fully out of the operator-host fetch path.
- **Allegro CDN URL stability.** Once an image is attached to a published
  offer, the CDN URL is stable per Allegro's docs. We don't persist these
  URLs anywhere, so the GC concern (only relevant for unattached uploads) is
  moot for the no-cache flow.
- **Not bundled here:** the `errors=0` diagnostic tangent (the
  `AllegroApiException.responseBody` 500-char truncation that swallows the
  real Allegro error code). It's marked optional in the issue. Solution B
  largely sidesteps the symptom (we no longer reach that code path on the
  reachability case), but the underlying logging bug still exists for any
  Allegro response > 500 chars. Track as a separate small issue/PR.

## 11. Effort

~1.5–2 days of focused work. The biggest item is the token-state extraction
+ the existing `AllegroHttpClient` test churn; everything else is additive
and follows established patterns.
