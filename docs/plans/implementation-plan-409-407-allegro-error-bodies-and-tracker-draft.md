# Implementation Plan — #409 + #407 (Allegro full error bodies + Job-detail draft tracker)

Two independent fixes shipped together because they sit on the same end-to-end Allegro `marketplace.offer.create` path that #401 / #406 / #411 just unblocked. They're orthogonal at the code level (different files, no shared symbols) but flow naturally to the same operator: #409 finally surfaces the real Allegro error in `OfferCreationRecord.errors`, and #407 finally renders that field on the Job-detail page for `draft` records. Bundling avoids two separate review cycles for what is one diagnostic-loop closure.

## Part A — #409: full error bodies + resilient JSON parser

### 1. Understand

**Goal.** When Allegro rejects `POST /sale/product-offers` with an error body > 500 chars, OpenLinker silently produces `errors=0` logs and an `OfferCreateRejectedException` with empty `errors[]`. Two compounding bugs in the same path: (a) `AllegroHttpClient` truncates `responseBody` to 500 chars before storing it on `AllegroApiException`, and (b) `parseAllegroErrors` in `AllegroOfferManagerAdapter` silently swallows `JSON.parse` failures on the truncated half-body. Sandbox confirms three real Allegro error codes (`DownloadError.Forbidden`, `ImpliedWarrantyNotDefinedException`, `ConstraintViolationException.MissingRequiredParameters`) all collapse to the same `errors=0` symptom.

**Layer.** Integration (Allegro adapter + http client). No CORE / port surface change. No FE work in this part.

**Non-goals.**
- Translating Allegro error codes into operator-friendly messages — separate FE concern (e.g. `MissingRequiredParameters` ID → human name lookup, which depends on #410's category-parameter capability).
- Truncating large error bodies in `OfferCreationRecord.errors` persistence — Allegro errors are bounded by Allegro's own response size; we don't need a separate cap.
- Any retry-policy change — error visibility only.

### 2. Research

#### Truncation sites in `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts`

Three call sites pass a `body.substring(0, 500)` to `AllegroApiException`:

| Line | Context |
|---|---|
| **L315–320** | `executeRequest` JSON-parse failure on a 2xx body: `Invalid JSON response from Allegro API` |
| **L417–422** | `handleError` 5xx branch: `Allegro API server error (${statusCode})` |
| **L427–432** | `handleError` 4xx-other branch (the **#409 hot path**): `Allegro API error (${statusCode})` |

Plus one *log* line at **L426** that uses `body.substring(0, 200)` — that one is operator scroll-back, deliberately tight, and stays.

`body` at all three sites comes from `await response.text()` at L302 — already in memory, no streaming benefit to truncating.

#### Parser site in `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts:867-878`

```ts
private parseAllegroErrors(responseBody: string | undefined): AllegroValidationError[] {
  if (!responseBody) return [];
  try {
    const parsed = JSON.parse(responseBody) as { errors?: AllegroValidationError[] };
    if (Array.isArray(parsed.errors)) return parsed.errors;
  } catch {
    // Response wasn't JSON or didn't match the expected shape.   ← silently swallowed
  }
  return [];
}
```

Caller at L667–681 (the `createOffer` catch block) feeds `error.responseBody` in and produces the `errors=0` log when the parser returns `[]`.

#### Existing test patterns

- `allegro-http-client.spec.ts` already has `it('should throw AllegroApiException on 4xx errors', …)` at L441 that mocks `text: () => Promise.resolve('{"error": "bad_request"}')` — pattern is solid, just needs a new spec asserting `responseBody` is the full original (not truncated).
- `allegro-offer-manager.adapter.spec.ts` (~140 specs already) — needs two new specs in the `createOffer` describe block: large-body parse-OK round-trip, and unparseable-body warn-log assertion.

### 3. Design

#### Adapter change — `AllegroHttpClient`

Pass full `body` to the exception at all three sites; keep the 200-char cap only on the L426 log line. Concrete diff:

```ts
// L315-320 (JSON-parse failure on 2xx)
throw new AllegroApiException(
  `Invalid JSON response from Allegro API: ${url.toString()}`,
  response.status,
  responseBody,                                      // was: responseBody.substring(0, 500)
  url.toString(),
);

// L417-422 (5xx)
throw new AllegroApiException(
  `Allegro API server error (${statusCode}): ${url}`,
  statusCode,
  body,                                              // was: body.substring(0, 500)
  url,
);

// L427-432 (4xx-other) + L426 log preview cap stays
this.logger.error(`[${traceId}] Allegro API error (${statusCode}): ${url} - ${body.substring(0, 200)}`);
throw new AllegroApiException(
  `Allegro API error (${statusCode}): ${url}`,
  statusCode,
  body,                                              // was: body.substring(0, 500)
  url,
);
```

No type signature change — `AllegroApiException.responseBody` is already `string | undefined` (verified at `domain/exceptions/allegro-api.exception.ts:13`).

#### Parser change — `parseAllegroErrors`

Replace silent `catch {}` with a `warn` log carrying the parser-error message and a 500-char preview. Keep the empty-array return so the upstream `OfferCreateRejectedException` shape is unchanged for genuinely-unparseable bodies (HTML proxy errors, etc.):

```ts
private parseAllegroErrors(responseBody: string | undefined): AllegroValidationError[] {
  if (!responseBody) return [];
  try {
    const parsed = JSON.parse(responseBody) as { errors?: AllegroValidationError[] };
    if (Array.isArray(parsed.errors)) return parsed.errors;
  } catch (err) {
    this.logger.warn(
      `Failed to parse Allegro error body as JSON: ${(err as Error).message}. ` +
        `Raw body (first 500 chars): ${responseBody.slice(0, 500)}`,
    );
  }
  return [];
}
```

The `warn` is the bridge: with (a) fixed, the parser will succeed for most real Allegro error bodies; the `warn` only fires for the residual class (truly malformed responses), and now carries breadcrumbs.

### 4. Implementation Steps (Part A)

#### Step A.1 — Adapter HTTP client

**File:** `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts`

Three one-line changes at L318, L420, L430 — drop `.substring(0, 500)` on the `responseBody` argument to `AllegroApiException`. L426 log line untouched.

#### Step A.2 — `parseAllegroErrors` warn

**File:** `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts:867-878`

Replace `catch {}` with the `catch (err) { this.logger.warn(...) }` block above.

#### Step A.3 — HTTP client spec

**File:** `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-http-client.spec.ts`

Add one spec in the existing 4xx/5xx describe block:

```ts
it('preserves the full Allegro error body on AllegroApiException (#409)', async () => {
  const longErrorJson = JSON.stringify({
    errors: [
      {
        code: 'ConstraintViolationException.MissingRequiredParameters',
        message: 'x'.repeat(2000),
        details: 'y'.repeat(2000),
      },
    ],
  });
  expect(longErrorJson.length).toBeGreaterThan(500);

  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    status: 422,
    headers: new Headers(),
    text: () => Promise.resolve(longErrorJson),
  });

  await expect(client.get('/test')).rejects.toMatchObject({
    statusCode: 422,
    responseBody: longErrorJson,           // not truncated
  });
});
```

Acceptance: spec fails against pre-fix code, passes after Step A.1.

#### Step A.4 — Adapter spec

**File:** `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` — locate the `createOffer` describe block (existing happy path at `:715`, #406 specs at `:751-784`).

Two new specs:

```ts
it('preserves Allegro error codes through full responseBody round-trip (#409)', async () => {
  const longBody = JSON.stringify({
    errors: [
      { code: 'ConstraintViolationException.MissingRequiredParameters', message: 'M', details: 'd'.repeat(6000) },
    ],
  });
  expect(longBody.length).toBeGreaterThan(500);

  httpClient.post.mockRejectedValue(
    new AllegroApiException('Allegro API error (422)', 422, longBody, 'https://…/sale/product-offers'),
  );

  await expect(adapter.createOffer(baseCmd)).rejects.toMatchObject({
    errors: [
      expect.objectContaining({ code: 'ConstraintViolationException.MissingRequiredParameters' }),
    ],
  });
});

it('logs warn when Allegro response body is not parseable JSON (#409)', async () => {
  // Access the private logger to assert the breadcrumb warn fires; no
  // existing log-spy pattern in this suite to follow.
  const warnSpy = jest.spyOn((adapter as unknown as { logger: { warn: jest.Mock } }).logger, 'warn');

  httpClient.post.mockRejectedValue(
    new AllegroApiException('Allegro API error (502)', 502, '<html>upstream proxy error</html>', 'https://…/sale/product-offers'),
  );

  await expect(adapter.createOffer(baseCmd)).rejects.toBeInstanceOf(OfferCreateRejectedException);
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining('Failed to parse Allegro error body as JSON'),
  );
});
```

Acceptance: both specs pass; spec 1 specifically fails against pre-A.1 code (assertion would see `errors: []`).

---

## Part B — #407: Job-detail OfferCreationTracker draft branch

### 1. Understand

**Goal.** When Allegro accepts an offer-create as `draft` (offer exists in seller panel but not yet published), the Job-detail page renders three problems: tracker keeps polling forever ("Still processing"), `externalOfferId` and `record.errors` are hidden, and there's no link to the seller panel. All three trace to a single FE assumption that `draft` is non-terminal — which is wrong: `draft` is the *terminal* outcome of the create lifecycle ("offer created, now sitting awaiting manual publish"). `validating` correctly stays non-terminal until the future `marketplace.offer.pollCreationStatus` handler arrives.

**Layer.** Frontend (web). No BE / port / API surface change. The data is already on the wire — just unrendered.

**Non-goals.**
- The `marketplace.offer.pollCreationStatus` follow-up for `validating` records — explicitly deferred per `OfferCreationExecutionService:144`.
- A "Publish from OL" action — needs an `OfferPublisher` capability the codebase doesn't expose. Allegro seller-panel link is the MVP path.
- Surfacing offer creation status on the Listings page — scoped to Job-detail.

### 2. Research

#### Terminal statuses

`apps/web/src/features/listings/api/listings.types.ts:91`
```ts
export const TERMINAL_OFFER_CREATION_STATUSES: readonly OfferCreationStatus[] = ['active', 'failed'];
```

Read by:
- `use-offer-creation-status-query.ts:32-35` — `refetchInterval` returns `false` (stop polling) when status is terminal.
- `OfferCreationTracker.tsx:94` — `isTerminal` gates the "Still processing" copy and the Dismiss button.

The hook test at `use-offer-creation-status-query.test.tsx:54` asserts polling stops on terminal — the same assertion needs to hold for `draft`.

#### Tracker render branches (`OfferCreationTracker.tsx:106-157`)

Currently:
- Header: badge + record id + optional Retry/Dismiss
- Body: "Still processing" (when `!isTerminal`), "Offer is live · external id …" (when `active`), "Offer creation failed" + `OfferCreationErrorList` (when `failed`)

No `draft` branch. With `draft` flipped terminal but no body branch, the tracker would render only the header — strictly worse UX. So the branch addition is mandatory, not optional.

#### Seller-panel URL derivation

Allegro factory at `libs/integrations/allegro/src/application/allegro-adapter.factory.ts:128-138` switches on `connection.config.environment` (`'sandbox' | 'production'`) to pick the API host. The seller-panel host follows the same convention:
- production: `https://allegro.pl/oferta/{externalOfferId}/edit`
- sandbox: `https://allegro.pl.allegrosandbox.pl/oferta/{externalOfferId}/edit`

FE `Connection` type already exposes `config: Record<string, unknown>` (verified at `apps/web/src/features/connections/api/connections.types.ts:22`). Reading `(connection.config?.environment as 'sandbox' | 'production' | undefined)` is sufficient — **no BE change needed**, contrary to issue Step 3 option (a)'s "may need to add to response DTO" caveat.

`OfferCreationTracker` is presentational and only sees `connectionId: string`. Two options for surfacing the platform + environment to the tracker so it can compute the seller-panel URL:

1. **Hook inside the tracker** — `useConnectionsQuery()` (list) or `useConnectionQuery(connectionId)` (single) inside the tracker, look up by id, read `config.environment`. Couples a presentational component to a network dep that doesn't exist today and adds a render-time fetch every time the tracker mounts.
2. **Props from the caller** — the Job-detail page (`apps/web/src/pages/sync-jobs/sync-job-detail-page.tsx:148`) already knows `job.connectionId`; add `useConnectionQuery(job.connectionId)` there (one hook call, the page is the data-coordination layer) and pass `marketplacePlatformType` + `marketplaceEnvironment` as optional scalar props to the tracker.

**Choosing option 2** — keeps the tracker presentational, makes the network dep visible at the page boundary (where it belongs per `frontend-architecture.md` § Components — "page components own route composition and layout only" but composition includes wiring data into feature components), and the tracker test no longer needs to mock `connections.list`. Verified: `apps/web/src/features/connections/hooks/use-connection-query.ts` exposes a single-connection fetch by id, and Job-detail does **not** currently fetch the connection.

### 3. Design

#### Step B.1 — Mark `draft` terminal

```ts
export const TERMINAL_OFFER_CREATION_STATUSES: readonly OfferCreationStatus[] = ['draft', 'active', 'failed'];
```

Hook polling and tracker `isTerminal` immediately follow.

#### Step B.2 — Seller-panel URL helper

New tiny helper in `apps/web/src/features/listings/lib/allegro-seller-panel-url.ts`:

```ts
/** Derives the Allegro seller-panel deep link for an offer.
 *  Returns null when platform is not allegro or external id missing. */
export function buildAllegroSellerPanelUrl(
  platformType: string,
  environment: string | undefined,
  externalOfferId: string | null,
): string | null {
  if (platformType !== 'allegro' || !externalOfferId) return null;
  const host = environment === 'production'
    ? 'allegro.pl'
    : 'allegro.pl.allegrosandbox.pl';
  return `https://${host}/oferta/${encodeURIComponent(externalOfferId)}/edit`;
}
```

Pure function, easy unit test, lives inside `features/listings/` so it reuses the listings dependency boundary (no shared/ leak). Default to sandbox host on unknown / missing environment matches the BE adapter's `getDefaultApiBaseUrl` fallback.

#### Step B.3 — Tracker draft branch

`OfferCreationTracker` props gain two optional scalars:

```tsx
interface OfferCreationTrackerProps {
  connectionId: string;
  offerCreationRecordId: string;
  /** Platform type of the connection. When 'allegro' (and environment provided),
   *  the draft branch renders an "Open in Allegro seller panel" deep link. */
  marketplacePlatformType?: string;
  /** Connection environment ('sandbox' | 'production'). Used together with
   *  marketplacePlatformType to derive the seller-panel host. */
  marketplaceEnvironment?: string;
  onDismiss?: () => void;
  onRetry?: (record: OfferCreationStatusResponse) => void;
}
```

Compute `sellerPanelUrl` via the helper. Render the draft branch only when `record.status === 'draft'`:

```tsx
{record.status === 'draft' ? (
  <>
    <p className="offer-creation-tracker__body">
      Offer created as a draft on Allegro
      {record.externalOfferId ? (
        <> · external id <span className="mono-text">{record.externalOfferId}</span></>
      ) : null}
      .{' '}
      {sellerPanelUrl ? (
        <a href={sellerPanelUrl} target="_blank" rel="noopener noreferrer">
          Open in Allegro seller panel
        </a>
      ) : null}
    </p>
    {record.errors && record.errors.length > 0 ? (
      <>
        <p className="offer-creation-tracker__body">
          Allegro reported validation issues that block publishing:
        </p>
        <OfferCreationErrorList errors={record.errors} />
      </>
    ) : (
      <p className="offer-creation-tracker__body offer-creation-tracker__body--muted">
        No inline validation issues — publish manually in the Allegro seller panel.
      </p>
    )}
  </>
) : null}
```

Single new CSS modifier `.offer-creation-tracker__body--muted` (one rule, `color: var(--text-muted)`) to keep "no issues" copy visually subordinate. Per `frontend-ui-style-guide.md` § Color Usage Rules — token-driven, no hex.

`rel="noopener noreferrer"` (not `nofollow`, which is for crawlers) — security best practice for `target="_blank"` external links.

### 4. Implementation Steps (Part B)

#### Step B.1 — Terminal statuses + hook test

**File:** `apps/web/src/features/listings/api/listings.types.ts:91`

Add `'draft'` to the array.

**File:** `apps/web/src/features/listings/hooks/use-offer-creation-status-query.test.tsx`

Add one spec mirroring the existing "stops polling once the status is terminal" but with a `draft` factory:

```ts
function draft(): OfferCreationStatusResponse {
  return { ...pending(), status: 'draft', externalOfferId: 'ext-1' };
}

it('stops polling on draft status (#407)', async () => {
  const getOfferCreationStatus = vi.fn().mockResolvedValue(draft());
  const apiClient = createMockApiClient({ listings: { getOfferCreationStatus } });
  const { result } = renderHook(() => useOfferCreationStatusQuery('conn-1', 'rec-1'), {
    wrapper: wrap(apiClient),
  });
  await waitFor(() => expect(result.current.data?.status).toBe('draft'));
  await new Promise((r) => setTimeout(r, 80));
  expect(getOfferCreationStatus).toHaveBeenCalledTimes(1);
});
```

#### Step B.2 — Seller-panel URL helper + spec

**File:** `apps/web/src/features/listings/lib/allegro-seller-panel-url.ts` (new)
**File:** `apps/web/src/features/listings/lib/allegro-seller-panel-url.test.ts` (new)

Helper as designed. Spec covers: production host, sandbox host, sandbox default on undefined/unknown environment, null on non-allegro platform, null on missing externalOfferId, encodeURIComponent on offer ids with special chars.

#### Step B.3 — Tracker draft branch

**File:** `apps/web/src/features/listings/components/OfferCreationTracker.tsx`

Add the two new optional props per the design above. Compute `sellerPanelUrl = buildAllegroSellerPanelUrl(marketplacePlatformType, marketplaceEnvironment, record.externalOfferId)`. Insert the draft branch between the `active` and `failed` branches.

When the caller doesn't supply the props (or supplies a non-allegro platform / unknown environment), `sellerPanelUrl` stays null and the link is omitted — the rest of the draft body still renders.

**Caller update:** `apps/web/src/pages/sync-jobs/sync-job-detail-page.tsx` adds `useConnectionQuery(job.connectionId)` and threads `connection?.platformType` + `(connection?.config?.environment as string | undefined)` into the tracker. The page is the right layer for that data per `frontend-architecture.md` § Components.

#### Step B.4 — CSS modifier

**File:** `apps/web/src/index.css` — find the `.offer-creation-tracker__body` block, add one modifier rule:

```css
.offer-creation-tracker__body--muted {
  color: var(--text-muted);
}
```

#### Step B.5 — Tracker test

**File:** `apps/web/src/features/listings/components/OfferCreationTracker.test.tsx`

Three new specs in a new `describe('draft status (#407)', …)` block, passing the new props directly (no connection-query mock needed since the tracker no longer hooks the API for environment):

1. `draft + externalOfferId + non-empty errors + marketplaceEnvironment='sandbox' + marketplacePlatformType='allegro'` → renders id, link to `allegro.pl.allegrosandbox.pl`, error list.
2. `draft + externalOfferId + empty errors + marketplaceEnvironment='production' + marketplacePlatformType='allegro'` → renders id, link to `allegro.pl`, "no inline validation issues" copy.
3. `draft + null externalOfferId + props omitted` → renders body without id/link, no crash.

### 5. Quality gate

```
pnpm test:ci          # build libs + run all backend unit tests (covers Part A specs)
pnpm --filter @openlinker/web test   # web tests (covers Part B specs)
pnpm lint
pnpm type-check
```

Both parts must pass with zero new errors.

### 6. Commit

Single commit (small enough, both halves coherent under "close the offer-create diagnostic loop"):

```
fix(allegro,web): preserve full Allegro error bodies + render draft offers on Job detail

Two complementary fixes that together close the operator-debug loop on
the Allegro marketplace.offer.create path that #401 unblocked.

allegro: AllegroHttpClient was truncating responseBody to 500 chars at
all three error sites (5xx / 4xx-other / 2xx-with-bad-JSON), then
parseAllegroErrors silently swallowed the JSON.parse failure on the
truncated body — producing useless errors=0 logs and empty
OfferCreateRejectedException.errors[]. Sandbox confirmed three real
Allegro error codes (DownloadError.Forbidden,
ImpliedWarrantyNotDefinedException,
ConstraintViolationException.MissingRequiredParameters) all collapsed
to the same symptom. Pass the full body to AllegroApiException; keep
the 200-char preview cap on the operator-visible log line. Make
parseAllegroErrors log warn with the parser-error message + raw-body
preview when JSON.parse genuinely fails (HTML proxy errors etc).
Closes #409.

web: OfferCreationTracker treated 'draft' as non-terminal so the
polling hook kept refetching forever, the body kept showing "Still
processing", and externalOfferId + record.errors stayed hidden. Mark
'draft' terminal in TERMINAL_OFFER_CREATION_STATUSES, add a draft body
branch that renders the Allegro external id, an error list when
present, and a deep link to the Allegro seller panel (sandbox vs
production derived from connection.config.environment via a new pure
buildAllegroSellerPanelUrl helper). 'validating' stays non-terminal
until the marketplace.offer.pollCreationStatus follow-up handler
lands.
Closes #407.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### 7. Push & PR

`409-407-allegro-error-bodies-and-tracker-draft` → PR with `Closes #409` + `Closes #407` (both on separate lines so GitHub auto-closes both).

## Validate

**Architecture.** Part A is integration-layer (Allegro adapter + http client). Part B is FE-only. No CORE / port surface change in either. No new capabilities.

**Naming / standards.** New helper `allegro-seller-panel-url.ts` matches kebab-case feature-lib convention. New test spec names follow the project's verb-form (`it('preserves the full…', …)`). No `any`, no `console.log`. Comments explain *why* (cite issue numbers), not *what*.

**Testing strategy.** 3 new BE specs (1 http client + 2 adapter) and ≈10 new FE specs across 3 files (1 hook + 6 helper + 3 tracker). All unit-level — no integration tests warranted because the change is pure behavior-preservation at integration layer + presentation-only at FE.

**Security.** `target="_blank"` on the Allegro deep link uses `rel="noopener noreferrer"` (per OWASP guidance). Helper uses `encodeURIComponent` on the offer id to defend against any pathological id values from Allegro.

**Risks.**
- *#410 was filed assuming this `errors=0` truncation bug is still present and uses the partial body to investigate*. After Part A lands, future Allegro error responses will surface fully — operators get clearer signal, and the "first manual sandbox verify" sub-task on #410 becomes much easier (can read `MissingRequiredParameters` parameter IDs directly from `OfferCreationRecord.errors`).
- *Connection query in tracker is best-effort* — if the connections list query fails or hasn't loaded by render time, the seller-panel link is omitted and the rest renders. Acceptable degradation per `frontend-ui-style-guide.md` § Color Usage Rules ("color is never the only signal" — the link is a convenience, not the only path to the info).

**Open questions.** None.
