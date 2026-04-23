# Implementation Plan: Unified Product Content Editor + AI Description Suggestion (#339 + #342)

**Date**: 2026-04-23
**Status**: Ready for Review
**Estimated Effort**: ~18–22 hours (one combined vertical slice; two issues shipped together)

**Issues**:
- [#339 feat(web): unified product content editor (master + per-channel overrides)](https://github.com/SilkSoftwareHouse/openlinker/issues/339)
- [#342 feat(core+web): AI description suggestion flow with draft integration](https://github.com/SilkSoftwareHouse/openlinker/issues/342)

**Epic**: [#6 Content & AI](https://github.com/SilkSoftwareHouse/openlinker/issues/6)

**Depends on** (all merged):
- #338/#340 content storage + AI engine foundation (via #350)
- #341 editable prompt-template storage (via #361)
- #360 `MarketplacePort` split into `OfferManagerPort` + capabilities (via #360)

**Why bundled**: The two issues assume each other. #342's FE spec literally places the Suggest button "inside the master panel and each channel panel of the content editor"; #339 is that editor. The `IntegrationsContentPublisher` throws `ChannelContentPublishNotSupportedException` today with a comment pinning the fix to "#339 / #342" — channel publish is a shared dependency. Shipping them split leaves main in a half-built state where neither issue's acceptance criteria can be demonstrated. Combined is one reviewable vertical slice operator-facing from end to end.

**Revision log (tech-review feedback applied, 2026-04-23)**:
- Role gating: **admin-only on all five endpoints** confirmed (matches the conservative MVP stance set by #341).
- `GET /products/:id/content` response shape pinned explicitly in §5.1 + §6.3 Step 11 (no ellipses).
- `NoLinkedOffersException` → HTTP 422 (not 404) — the product exists, the precondition (linked offers) is the failing piece.
- `tone` query field capped at `@MaxLength(64)`; `extraInstructions` at `@MaxLength(1024)`; `value` at `@MaxLength(65536)`.
- Channel-panel filter now explicit: connection must be `status === 'active'` **and** adapter must satisfy `isOfferFieldUpdater` **and** have ≥1 offer mapped for the product.
- `ContentSuggestionService` is a synchronous HTTP handler (AI call blocks the request); documented expectation + timeout contract in §7 Risks. No queueing for MVP.
- Plan acknowledges `content → listings` cross-context import as a deliberate pragmatic choice (follows the existing `content → products` precedent in the publisher); flagged as a refactor candidate if the coupling grows.
- Accept-path in the diff dialog overwrites any existing draft silently via `saveDraft`'s upsert semantics — noted in §5.5; FE adds a confirmation line ("This will replace your current draft") when a panel is already in draft state.
- Integration test (§6.3 Step 12) explicitly exercises the channel-publish path: seeds an offer mapping, publishes a channel override, asserts `updateOfferFields` was called with the structured Allegro payload.
- Style-guide phase-PR screenshot practice added to §7 / §8 checklist (360 × 812, 768 × 1024, 1440 × 900).
- Architecture doc update at Step 20 also tweaks §13's "Worker registration deferred" line since the AI consumer is now in-process, not scheduled.
- Per-template `maxOutputTokens` (storing completion params on the `PromptTemplate` row) explicitly deferred to a follow-up; MVP uses a service constant.

---

## 1. Task Summary

Deliver the operator workflow end to end:

1. Open a product, see master + per-channel description state (draft / published / conflict).
2. Edit freely — drafts are local to OpenLinker; nothing hits the platform.
3. Optionally click **Suggest** — AI generates a channel-appropriate draft; review as a diff; accept into draft or reject/edit.
4. Publish — master goes via `ProductMasterPort.updateProduct`; channels go via `OfferManagerPort.updateOfferFields` for each offer linked to the product on that connection.
5. Conflicts (external edit vs pending draft) are surfaced inline and resolved explicitly — no silent overwrites.

**Classification**: **CORE (application + a new API controller) + Interface (FE content editor)**. No new ports; no new integrations; reuses existing `ContentDraftService`, `AiCompletionPort`, `PromptTemplateService`, `OfferManagerPort`, `ProductMasterPort`, and offer-mapping plumbing.

---

## 2. Scope & Non-Goals

### In Scope — #339 (Editor)

- HTTP API under `apps/api/src/content/` wrapping the existing `ContentDraftService`:
  - `GET /products/:id/content` — list all master + channel rows for a product, plus the list of content-capable connections (for panel discovery).
  - `POST /products/:id/content/draft` — save a draft (master or channel).
  - `POST /products/:id/content/discard` — discard a draft.
  - `POST /products/:id/content/publish` — publish a draft.
- Extend `IntegrationsContentPublisher` with the channel path:
  - Resolves connection's offers for the product by walking `product.variants[]` → `OfferMappingRepositoryPort.findMany({ connectionId, internalId: variantId })`.
  - Calls `OfferManagerPort.updateOfferFields` for every linked offer (description is offer-level, not variant-level, on Allegro; multiple variants per offer = same description content broadcast to each distinct `externalOfferId`).
  - Uses the publish timestamp as `baseVersion` for channel rows (channel-side inbound reconcile doesn't exist yet; documented as a follow-up invariant).
- Remove the `ChannelContentPublishNotSupportedException` throw; the exception class stays in the domain for any future "this adapter doesn't support channel content" branch but is no longer raised on the happy path.
- FE route: a new **Content** tab on `/products/:id` (tab-param on the existing product detail page; no new URL).
- Feature module `apps/web/src/features/content/` with API client + typed hooks.
- `ContentEditor` page-component composition:
  - Master panel: read current resolved value; `Edit` flips into draft mode; `Save draft` / `Publish` / `Discard draft`.
  - Channel panel per connection that is both active + supports `OfferFieldUpdater` + has at least one offer for this product; header = `EntityLabel` for the connection; default state "Using master description" with `Customize for this channel` affordance that seeds the override from master.
  - Conflict pane (two-column diff) when a draft row carries `hasConflict=true`; actions: `Keep draft` / `Overwrite with platform` / `Edit merged`.
- Responsive: desktop = master-left / channels-right split; tablet = single column; mobile = read-only with `DesktopOnlyBanner` (same pattern the prompt-template editor uses).
- Loading / empty / error / success states per `fe-pages` rule; mutations invalidate TanStack Query cache.

### In Scope — #342 (Suggest)

- New application service `ContentSuggestionService` (+ `IContentSuggestionService`) under `libs/core/src/content/application/services/`.
- `suggestDescription(cmd)`:
  1. Loads product via `ProductMasterPort.getProduct`.
  2. Assembles the variable payload expected by the seeded template (`product.name`, `product.attributes`, `product.category`, optional `tone`, optional `extraInstructions`).
  3. Picks the template key `offer.description.suggest` and channel (`prestashop` / `allegro` / `null` for master) from the command.
  4. Calls `IPromptTemplateService.render({ key, channel, values })` → gets `RenderedPrompt`.
  5. Calls `AiCompletionPort.complete({ systemPrompt, userPrompt, cacheSystemPrompt: true, maxOutputTokens: 1024, requestId })`.
  6. Returns `{ suggestion: text, usage, templateVersion, requestId }` — **does not** persist.
- `acceptSuggestion(cmd)` → thin delegate to `ContentDraftService.saveDraft`.
- REST endpoint `POST /products/:id/content/suggest` — admin-gated (same guard set as the prompt-template surface — or at least JWT-authenticated; see §7 Security). Accepts `{ channel, tone?, extraInstructions? }`, returns `{ suggestion, requestId, templateKey, templateVersion, usage }`.
- Per-call `maxOutputTokens` cap documented in `suggest.types.ts` — default 1024; overridable per call.
- Telemetry: structured log on suggest (`{ requestId, productId, channel, templateKey, templateVersion, inputTokens, outputTokens, cachedInputTokens, latencyMs }`), and on accept/reject (`{ requestId, productId, channel, accepted }`). No analytics backend — logs only.
- FE: `Suggest` button in the master + each channel panel. Opens a small controls popover (optional `tone` select + `extraInstructions` textarea) → submits → shows a loading state ("Thinking…") on the panel (NOT in a modal — modal opens on result).
- `SuggestionDiffDialog` (Radix Dialog wrapper): current value on the left, suggestion on the right, three actions:
  - **Accept** → saves as draft via the content draft API, toast, closes.
  - **Reject** → discards suggestion (nothing saved), closes.
  - **Edit before accept** → swaps the right panel into an editable textarea pre-filled with the suggestion; save from there becomes the draft.

### Out of Scope (deferred)

- Rich-text editor (Lexical / Quill / etc.) — MVP uses `Textarea` for both sides per style guide §"UI Library Policy". Allegro's structured block description format is translated in the publisher (`value` string → single `TEXT` section with one item); a richer editor is a follow-up flagged in #339.
- Multi-turn refinement ("try again, shorter" conversations). One-shot suggestions only; regenerate = call the endpoint again.
- Bulk suggestions across products.
- Cost / per-user rate limiting.
- Image / attribute / title suggestions.
- Channel inbound reconcile (external Allegro edit → update our base row). Publisher uses `publishTimestamp` as channel baseVersion; this assumption is documented. When inbound channel sync lands (separate issue), the strategy reconciles.
- Localisation (per-locale overrides).

### Constraints

- No `any`, no `console.log`, no deep relative imports (`../../../`).
- All HTTP endpoints under `/products/:id/content/*` are JWT-guarded. The `suggest` endpoint must be explicit about role requirements — see §7.
- No new ports; no new adapters.
- `pnpm lint && pnpm type-check && pnpm test` must be clean at the end; `pnpm test:integration` covers the vertical slice.
- Migration count: **zero** — this whole slice reuses the existing `product_content_field` + `identifier_mappings` tables.
- The Suggest button never publishes directly. The US-25 guarantee is enforced at the API boundary: `POST /suggest` never writes; the only writes go through the existing draft/publish endpoints.

---

## 3. Research Summary

| Concern | File / Path |
|---|---|
| Content draft lifecycle (saveDraft / publishDraft / resolveValue / reconcileExternal) | `libs/core/src/content/application/services/content-draft.service.ts` |
| Content publisher current (master path; channel throws) | `libs/core/src/content/application/services/integrations-content-publisher.service.ts` |
| ContentDraftService DI token | `libs/core/src/content/content.tokens.ts` — `CONTENT_DRAFT_SERVICE_TOKEN` |
| AiCompletionPort + input/result types | `libs/core/src/ai/domain/ports/ai-completion.port.ts`, `libs/core/src/ai/domain/types/ai-completion.types.ts` |
| PromptTemplateService + render | `libs/core/src/ai/application/services/prompt-template.service.ts` (shipped in #341) |
| OfferFieldUpdater capability | `libs/core/src/listings/domain/ports/capabilities/offer-field-updater.capability.ts` — optional on `OfferManagerPort`; discover via `isOfferFieldUpdater` guard |
| OfferFieldUpdate shape (Allegro-style structured sections) | `libs/core/src/listings/domain/types/offer-update.types.ts` |
| Offer mapping lookups (variant-scoped) | `libs/core/src/listings/domain/ports/offer-mapping-repository.port.ts` + `findMany({ connectionId, internalId })` |
| IntegrationsService (adapter discovery) | `libs/core/src/integrations/application/interfaces/integrations.service.interface.ts` — `listCapabilityAdapters`, `getCapabilityAdapter` |
| Product detail page (tab host) | `apps/web/src/pages/products/product-detail-page.tsx` (244 lines; tab param added around its main render) |
| Tabs primitive | `apps/web/src/shared/ui/tabs.tsx` |
| Dialog / ConfirmDialog | `apps/web/src/shared/ui/dialog.tsx`, `confirm-dialog.tsx` |
| DesktopOnlyBanner | `apps/web/src/shared/ui/desktop-only-banner.tsx` |
| EntityLabel (connection-name resolver) | `apps/web/src/shared/ui/entity-label.tsx` |
| Roles guard / admin decorator | `apps/api/src/auth/guards/roles.guard.ts`, `apps/api/src/auth/decorators/roles.decorator.ts` |
| Test harness + truncate list | `apps/api/test/integration/setup.ts` — already truncates `product_content_field` |
| API client composition | `apps/web/src/app/api/api-client.ts` — add `content` + `contentSuggest` branches |

### What this unlocks
- The Content & AI epic (#6) closes: US-23 (#339 editor), US-24 (#342 suggest), US-25 (human-in-loop review via diff), US-26 (publish-back wired through master + channel).
- Channel publishing becomes a real primitive — other features can rely on `publishDraft` for channel rows.
- PrestaShop rich-text description export is unchanged (master writes `description` string → PrestaShop `description` field as-is).

---

## 4. Architecture Mapping

```
┌───────────────────────────────────────────────────────────────────┐
│ Interface (apps/web + apps/api)                                   │
│ Product detail tab → ContentEditor component tree                 │
│ POST /products/:id/content/{draft,discard,publish,suggest}        │
│ GET  /products/:id/content                                        │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│ Application (libs/core/src/content/application)                   │
│ IContentDraftService ← ContentDraftService (#338 — reused)        │
│ IContentSuggestionService ← ContentSuggestionService (NEW)        │
│ IntegrationsContentPublisher — extended for channel path          │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│ Domain (libs/core/src/content/domain + libs/core/src/ai)          │
│ ContentPublisherPort, ProductContentField, FieldKey               │
│ AiCompletionPort, PromptTemplate + types                          │
│ OfferFieldUpdater, OfferMappingRepositoryPort                     │
└───────────────────────────────────────────────────────────────────┘
```

Dependency direction holds: `interfaces → application → domain`, `infrastructure → domain`. No new ports.

---

## 5. Data Flow

### 5.1 Content editor read
```
GET /products/:id/content
  ├─ ProductMasterPort.getProduct(id)          → name, description, variants[]
  ├─ ContentDraftRepository.findByProduct(id)  → all master + channel rows
  ├─ IntegrationsService.listCapabilityAdapters({ capability: 'OfferManager' })
  │   └─ filter to adapters with connection.status === 'active' AND isOfferFieldUpdater(adapter)
  │       └─ for each connection, OfferMappingRepository.findMany({ connectionId, internalId: variantId })
  │           └─ keep connections with ≥1 offer for this product
  └─ response (pinned shape):
       {
         productId: string,
         master: {
           baseValue: string | null,
           draftValue: string | null,
           hasConflict: boolean,
           updatedAt: string | null,        // ISO, null when no row exists yet
           updatedBy: string | null
         },
         channels: Array<{
           connectionId: string,
           connectionName: string,           // from Connection.name
           platformType: string,             // 'allegro', etc.
           connectionStatus: 'active' | 'disabled' | 'error',
           baseValue: string | null,
           draftValue: string | null,
           hasConflict: boolean,
           updatedAt: string | null,
           updatedBy: string | null,
           linkedOfferCount: number          // drives "this channel has N offers" affordance
         }>
       }
```
Channels returned in a deterministic order: `connectionName` ASC, then `connectionId` ASC as a tie-breaker.

### 5.2 Save draft
```
POST /products/:id/content/draft
Body: { connectionId: string | null, fieldKey: 'description', value: string }
  └─ ContentDraftService.saveDraft(...)  → returns updated row
```

### 5.3 Publish (master)
```
POST /products/:id/content/publish  { connectionId: null, fieldKey: 'description' }
  └─ ContentDraftService.publishDraft(...)
      └─ IntegrationsContentPublisher.publish({ connectionId: null })
          └─ ProductMasterPort.updateProduct(id, { description: value })
              → baseVersion = product.updatedAt.toISOString()
```

### 5.4 Publish (channel)
```
POST /products/:id/content/publish  { connectionId: <id>, fieldKey: 'description' }
  └─ ContentDraftService.publishDraft(...)
      └─ IntegrationsContentPublisher.publish({ connectionId })
          ├─ productMaster.getProduct(productId) → variants[]
          ├─ for each variant: OfferMappingRepository.findMany({ connectionId, internalId: variant.id })
          ├─ collect distinct externalOfferIds
          ├─ assert adapter satisfies isOfferFieldUpdater — otherwise throw
          ├─ for each externalOfferId: OfferManagerPort.updateOfferFields({
          │     externalOfferId,
          │     fields: { description: { sections: [{ items: [{ type: 'TEXT', content: value }] }] } },
          │     idempotencyKey: `content:${productId}:${connectionId}:${publishedAtISO}`
          │   })
          └─ baseVersion = new Date().toISOString()  // documented fallback; channel reconcile is a follow-up
```

### 5.5 Suggest → review → accept
```
POST /products/:id/content/suggest  { channel, tone?, extraInstructions? }
  └─ ContentSuggestionService.suggestDescription(...)
      ├─ ProductMasterPort.getProduct(productId) → payload
      ├─ PromptTemplateService.render({ key: 'offer.description.suggest', channel, values })
      ├─ AiCompletionPort.complete({ systemPrompt, userPrompt, cacheSystemPrompt: true, maxOutputTokens: 1024, requestId })
      └─ response: { suggestion, requestId, templateKey, templateVersion, usage }

(FE) Operator reviews in SuggestionDiffDialog:
  ├─ Accept → POST /products/:id/content/draft  { connectionId, fieldKey: 'description', value: suggestion }
  │   • saveDraft is upsert — if the panel already had a pending draft, it is overwritten.
  │   • When the panel is already in draft state, the dialog adds a confirmation line:
  │     "This will replace your current draft." Accept stays one click; the line is informational.
  ├─ Reject → close modal, no server call
  └─ Edit-then-accept → swap to editable textarea → POST draft with edited value
```

---

## 6. Step-by-Step Implementation Plan

### 6.1 Backend core — ContentSuggestionService (#342)

**Step 1 — Command / result types.** Create `libs/core/src/content/application/types/content-suggestion.types.ts`:
- `SuggestDescriptionCommand` (`productId`, `channel: 'prestashop' | 'allegro' | null`, `tone?`, `extraInstructions?`).
- `SuggestionResult` (`suggestion: string`, `requestId: string`, `templateKey: string`, `templateVersion: number`, `usage: AiCompletionUsage`).
- `DEFAULT_MAX_OUTPUT_TOKENS = 1024`.

**Step 2 — Service interface.** Create `libs/core/src/content/application/services/content-suggestion.service.interface.ts`:
```ts
export interface IContentSuggestionService {
  suggestDescription(cmd: SuggestDescriptionCommand): Promise<SuggestionResult>;
}
```
(Accept is not a method on this service — accepting a suggestion is just calling `ContentDraftService.saveDraft` from the controller; no new wrapper needed per YAGNI.)

**Step 3 — Service implementation.** Create `libs/core/src/content/application/services/content-suggestion.service.ts`:
- `@Injectable()`, inject `@Inject(INTEGRATIONS_SERVICE_TOKEN) IIntegrationsService`, `@Inject(PROMPT_TEMPLATE_SERVICE_TOKEN) IPromptTemplateService`, `@Inject(AI_COMPLETION_PORT_TOKEN) AiCompletionPort`.
- Uses `Logger` for structured telemetry.
- Resolves product via `integrationsService.listCapabilityAdapters<ProductMasterPort>({ capability: 'ProductMaster' })` (same pattern as `IntegrationsContentPublisher`).
- Builds the render variables payload from the product (name, attributes, category) + cmd.tone / extraInstructions (empty string when absent — the render helper treats declared-optional missing as empty, so this is equivalent).
- Logs per-call: `{ requestId, productId, channel, templateKey, templateVersion, inputTokens, outputTokens, cachedInputTokens, latencyMs }`.

**Step 4 — Wire into ContentModule.**
- Add `CONTENT_SUGGESTION_SERVICE_TOKEN` to `libs/core/src/content/content.tokens.ts`.
- Register `ContentSuggestionService` + token binding in `libs/core/src/content/content.module.ts`.
- Add imports for `AiModule` (core) + `IntegrationsModule` (already imported).
- Export `CONTENT_SUGGESTION_SERVICE_TOKEN` from `content.module.ts` and from the `libs/core/src/content/index.ts` barrel.

**Step 5 — Unit tests.** `libs/core/src/content/application/services/content-suggestion.service.spec.ts`:
- Mocks `IIntegrationsService`, `IPromptTemplateService`, `AiCompletionPort`.
- Asserts: product lookup → template render with correct variables → AI call with `cacheSystemPrompt: true` and the requested `maxOutputTokens` → response shape correct.
- Edge case: no ProductMaster adapter available → raises `NoProductMasterAdapterException` (reuse the existing exception from the content publisher).
- Edge case: `extraInstructions` and `tone` both provided → passed through to the render payload verbatim.

### 6.2 Backend core — Channel publisher (#339+#342)

**Step 6 — Extend `IntegrationsContentPublisher`.**
File: `libs/core/src/content/application/services/integrations-content-publisher.service.ts`.
- Inject `OFFER_MAPPING_REPOSITORY_TOKEN` (port; already exists) and `INTEGRATIONS_SERVICE_TOKEN`.
- Replace the `ChannelContentPublishNotSupportedException` throw with a real implementation:
  1. `getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')`.
  2. Type-guard via `isOfferFieldUpdater` — if false, throw a new `ChannelAdapterLacksFieldUpdaterException` (new exception in `domain/exceptions/`).
  3. `getCapabilityAdapter<ProductMasterPort>('ProductMaster')` (first available; single-master assumption matches the existing master path — log when multiple).
  4. `product = productMaster.getProduct(productId)` → iterate `product.variants[]`.
  5. For each variant: `offerMappings.findMany({ connectionId, internalId: variant.id, limit: 100, offset: 0 })` — collect distinct `externalId` values.
  6. If zero offers found → throw `NoLinkedOffersException` (new exception; 404-ish at the HTTP layer).
  7. For each unique `externalOfferId`: `updater.updateOfferFields({ externalOfferId, fields: { description: { sections: [{ items: [{ type: 'TEXT', content: value }] }] } }, idempotencyKey: 'content:{productId}:{connectionId}:{iso}' })`.
  8. Return `{ baseVersion: new Date().toISOString() }` — document the fallback in a header comment.
- Keep the domain exception class `ChannelContentPublishNotSupportedException` in the file system — other callers / future code may still need to throw it (e.g. a fully unsupported connection type) — but it is no longer thrown on the default channel path.

**Step 7 — New exceptions.** Under `libs/core/src/content/domain/exceptions/`:
- `channel-adapter-lacks-field-updater.exception.ts` — thrown when the connection's `OfferManager` does not implement `OfferFieldUpdater`.
- `no-linked-offers.exception.ts` — thrown when no offers are mapped for this product on this connection.

**Step 8 — Update publisher unit test.** `integrations-content-publisher.service.spec.ts`:
- Existing master path unchanged.
- Add: channel path with mocked `OfferFieldUpdater`, mocked offer-mapping repo returning one offer → asserts `updateOfferFields` called with the Allegro-shaped payload.
- Add: adapter without `updateOfferFields` → `ChannelAdapterLacksFieldUpdaterException`.
- Add: no offers mapped → `NoLinkedOffersException`.
- Add: multiple variants with distinct offers → publisher calls `updateOfferFields` once per distinct `externalOfferId` (dedup).

### 6.3 Backend HTTP — Content module (#339+#342)

**Step 9 — New API module.** Create `apps/api/src/content/content.module.ts` exporting `ContentApiModule`:
- Imports `ContentModule` (core) and `AiModule` (core, via the existing re-export).
- Controllers: `ContentController` (new).

**Step 10 — Controller.** `apps/api/src/content/http/content.controller.ts`:
- Class-level `@ApiBearerAuth()`, `@ApiTags('content')`, `@Controller('products/:productId/content')`.
- Every handler carries at minimum the existing JWT guard (global); suggest + publish also `@Roles('admin')` to match the pattern from #341's admin-only AI surface. Draft save / discard can be any authenticated user if the product team wants to let editors draft without admin — **flag as open question for the user** in the summary (default: admin-only on all four, matching conservative MVP).
- Endpoints:
  - `GET /` — list master + channels for the product.
  - `POST /draft` — save draft (body: `{ connectionId, fieldKey, value }`).
  - `POST /discard` — discard draft (body: `{ connectionId, fieldKey }`).
  - `POST /publish` — publish draft (body: `{ connectionId, fieldKey }`).
  - `POST /suggest` — AI suggest (body: `{ channel, tone?, extraInstructions? }`).
- Every handler carries `@Roles('admin')` (confirmed default — see revision log).
- DTOs with `class-validator`:
  - `@MaxLength(65536)` on `value`,
  - `@MaxLength(1024)` on `extraInstructions`,
  - `@MaxLength(64)` on `tone`.
- Exception → HTTP mapping:
  - `ContentConflictException` → 409 `ConflictException`
  - `ContentFieldNotFoundException` → 404
  - `ChannelAdapterLacksFieldUpdaterException` → 422 (the connection can't receive this content)
  - `NoLinkedOffersException` → **422** (product exists, precondition "at least one linked offer" not met)
  - `PromptTemplateNotFoundException` / `PromptTemplateRenderException` → 404 / 422 (consistent with the prompt-template controller)
  - `AiCompletionError` family → 502 `BadGatewayException` (upstream AI issue)
- Register `ContentApiModule` in `apps/api/src/app.module.ts`.

**Step 11 — DTOs.** Under `apps/api/src/content/http/dto/`:
- `save-content-draft.dto.ts`, `discard-content-draft.dto.ts`, `publish-content.dto.ts`, `suggest-content.dto.ts`.
- `content-state-response.dto.ts` — master + channels summary matching the pinned shape in §5.1 (productId, master block, channels array with per-channel `connectionStatus`, `linkedOfferCount`, `platformType`, draft/base values, timestamps).
- `suggestion-response.dto.ts` — `{ suggestion, requestId, templateKey, templateVersion, usage }`.

**Step 12 — Integration test.** `apps/api/test/integration/content-crud-and-suggest.int-spec.ts`:
- Uses the `fake` AI provider (`OL_AI_PROVIDER=fake`) so the suggest endpoint is deterministic.
- Seeds a product + one active PrestaShop connection (master) + one active Allegro connection with **at least one `identifier_mappings` row linking a variant of the product to an external offer id** so `OfferMappingRepository.findMany` returns a real offer to target.
- Stubs `OfferManagerPort.updateOfferFields` and `ProductMasterPort.updateProduct` at the integration boundary via the existing adapter-registration hooks (no real HTTP egress).
- Exercises the full flow:
  1. `GET /content` returns master + channel panels with the pinned shape (productId, master block, channels array including `linkedOfferCount ≥ 1`).
  2. `POST /draft` saves a master draft.
  3. `POST /publish` (master) calls the stubbed `ProductMasterPort.updateProduct` exactly once.
  4. `POST /draft` + `POST /publish` (Allegro channel) — explicit assertion that `OfferManagerPort.updateOfferFields` was called with `{ externalOfferId: <seeded id>, fields: { description: { sections: [{ items: [{ type: 'TEXT', content: <value> }] }] } }, idempotencyKey: /^content:.../ }`.
  5. `POST /suggest` (channel=allegro) returns the Fake adapter's canned response, with a `requestId` and non-empty `usage`.
  6. `POST /draft` using the suggestion value → `POST /publish` → stubbed adapter received the suggestion text.
  7. Non-admin (`role: viewer`) → 403 on all endpoints (the role gate is enforced at the controller boundary by `RolesGuard`).
  8. Conflict path: call `ContentDraftService.reconcileExternal` directly with a divergent `externalVersion` while a draft is pending → `POST /publish` returns 409.
  9. Channel with no linked offers (second Allegro connection seeded without any offer mappings) → `POST /publish` returns 422.

### 6.4 Frontend — Feature module (#339+#342)

**Step 13 — FE types.** `apps/web/src/features/content/api/content.types.ts`:
- Wire types mirroring backend DTOs (state response, mutation inputs, suggestion response).
- Local `PromptTemplateChannel = 'prestashop' | 'allegro'` union mirrored from core.

**Step 14 — FE API client.** `apps/web/src/features/content/api/content.api.ts`:
- `getContent(productId)`, `saveDraft`, `discardDraft`, `publish`, `suggest` methods.
- Registered in `apps/web/src/app/api/api-client.ts` as `content: ContentApi`.
- Mock registrations added to `test/test-utils.tsx`.

**Step 15 — Query + mutations.** `apps/web/src/features/content/hooks/`:
- `use-content-query.ts` (per productId).
- `use-save-content-draft-mutation.ts`, `use-discard-content-draft-mutation.ts`, `use-publish-content-mutation.ts`, `use-suggest-content-mutation.ts`.
- All mutations invalidate `contentQueryKeys.forProduct(productId)` on success.

**Step 16 — Components.** `apps/web/src/features/content/components/`:
- `ContentEditor.tsx` — grid container; renders master panel + list of channel panels; feeds shared render helpers / dialog state.
- `ContentMasterPanel.tsx` — read-mode header + edit textarea + action cluster + `Suggest` button.
- `ContentChannelPanel.tsx` — same shape as master, plus the "Using master description" default state with `Customize for this channel` button that seeds a draft from master.
- `ContentConflictPane.tsx` — rendered inside a panel when `hasConflict`; two-column diff, three actions (Keep draft / Overwrite with platform / Edit merged).
- `SuggestionTrigger.tsx` — the button + popover with tone + extraInstructions inputs.
- `SuggestionDiffDialog.tsx` — Radix Dialog; props: `current`, `suggestion`, `onAccept(value)`, `onReject`, `onEditAndAccept(editedValue)`.
- All components wrapped in `forwardRef` where they wrap native controls (per UI-components rule).

**Step 17 — Page integration.** Extend `apps/web/src/pages/products/product-detail-page.tsx`:
- Add a tabbed shell (using the `Tabs` primitive): `Overview` (existing content) | `Content`.
- `Content` tab renders `<ContentEditor productId={product.id} />`.
- Tab state via URL search param (`?tab=content`) per FE state rules (URL-owned).
- Add a staticCrumb entry in `app-shell.tsx` for the tabbed URL if needed (probably not — tab param doesn't change the path).

**Step 18 — CSS.** Append to `apps/web/src/index.css`:
- `.content-editor`, `.content-editor__grid` (desktop 55/45 split, tablet stack).
- `.content-panel`, `.content-panel--channel`, `.content-panel__header`, `.content-panel__actions`.
- `.content-suggestion-trigger` (inline popover container).
- `.content-diff-pane` (two-column within the dialog, mono-textarea on both sides).
- `.content-conflict-pane` (three-action row, visually distinguished with `--status-conflict-*` tokens).

**Step 19 — FE tests.** Vitest + Testing Library under the usual colocated pattern:
- `ContentEditor.test.tsx` — renders with master + one channel from mocked API; empty state; error state.
- `ContentMasterPanel.test.tsx` — edit → save → publish flow (mocks mutation); conflict pane rendering.
- `ContentChannelPanel.test.tsx` — default "using master" state → customize → edit → save → publish.
- `SuggestionDiffDialog.test.tsx` — accept / reject / edit-then-accept paths; asserts the correct mutation is called with the expected value.
- `product-detail-page.test.tsx` — extend existing test with the Content tab visible and the ContentEditor mounted when activated.

### 6.5 Documentation + wiring

**Step 20 — Architecture doc touch-up.** Short edit to `docs/architecture-overview.md`:
- §12 (Content): add the channel publish path to the "Capability" bullet; remove the "channel path is deferred to #339/#342" qualifier; add a bullet "`ContentSuggestionService` composes `PromptTemplateService.render` + `AiCompletionPort.complete` and never writes directly".
- §13 (AI): update the "Worker registration: deferred" bullet to reflect that AI consumers now run in-process inside `apps/api` (the suggest HTTP handler), not in `apps/worker`. No worker AI consumer yet.

**Step 21 — Test file-naming consistency.** Confirm the new integration test uses `*.int-spec.ts`. No changes to existing tests.

---

## 7. Validation & Risks

### Architecture compliance checklist
- [ ] Domain layer has zero framework imports (`grep -rn "@nestjs\|typeorm" libs/core/src/content/domain/` returns nothing new).
- [ ] `ContentSuggestionService` depends only on Symbol tokens, never concrete classes.
- [ ] No new ORM entities; no migration.
- [ ] All new exceptions live under `domain/exceptions/`.
- [ ] Every new `.ts` file carries the documented header block.
- [ ] All API endpoints JWT-guarded; `@Roles('admin')` on mutating endpoints; 403 covered by integration test.
- [ ] No `any`; no `console.log`; no deep relative imports.

### Resolved decisions (from tech review)
1. **Role gating:** admin-only on all five endpoints (confirmed default).
2. **Channel baseVersion:** publish timestamp used as the synthetic baseVersion; channel inbound-reconcile is a separate future issue.
3. **Channel-panel filter:** strict — `status === 'active'` + `isOfferFieldUpdater` + `≥1` linked offer.
4. **Suggest handler:** synchronous HTTP call; target p95 ≤ `OL_AI_TIMEOUT_MS` (default 60 s in the SDK adapter). FE shows `Thinking…` until response; `AiTimeoutError` → HTTP 502. No queueing for MVP.

### Known risks and mitigations
1. **Multiple offers per product on one connection.** If an Allegro connection has many offers mapped across variants, publishing broadcasts the same description to each. For MVP that's the desired behaviour (description is product-level). Mitigation: the publisher dedupes `externalOfferId` before issuing updates; log the count.
2. **AI timeout / rate-limit.** The existing `AiCompletionPort` exception family (`AiTimeoutError`, `AiRateLimitError`, `AiCompletionError`) is surfaced by the SDK adapter. Controller maps these to HTTP 502. FE renders a toast with the error message and keeps the panel in its prior state (no draft written, no state changes).
3. **Prompt render error.** Missing required variable → `PromptTemplateRenderException` → 422. Pre-flight in `ContentSuggestionService` always provides `product.name`, so the only real risk is a template edit that introduces a new required variable without updating the service's payload assembly — caught by the service unit tests if we keep the payload list in a single place.
4. **Publishing drift under concurrent editors.** Two admins click Publish simultaneously on the same channel row. Each grabs the draft, calls `updateOfferFields`, one wins. Since we're not using optimistic concurrency on channel rows (publisher returns a synthetic baseVersion), the second publish succeeds silently and overwrites. For MVP this matches "last writer wins"; we flag it and note that once channel reconcile lands, a proper lock-or-reject strategy follows. Document in the publisher header.
5. **Allegro description format.** Allegro accepts structured block descriptions; our publisher wraps the string in a single TEXT section. Rich operator HTML from PrestaShop won't render as separate Allegro blocks — mitigated by letting operators edit the channel override if they want Allegro-specific formatting. A richer editor is explicitly out of scope (called out in issue #339).

### Security
- All endpoints JWT-guarded; mutating endpoints admin-gated.
- No secrets in browser; the AI API key lives server-side in `@openlinker/integrations-ai` and is only consumed through the port.
- The suggest endpoint never writes to the platform. The AI's output only lands on a platform after the operator explicitly publishes a draft that contains it. This is the US-25 guarantee; the integration test asserts the AI response is never fed directly into any `ProductMasterPort.updateProduct` or `OfferFieldUpdater.updateOfferFields` call without passing through `saveDraft` first.
- Input validation: `value` capped at 64 KB; `extraInstructions` at 1 KB; `tone` is a string with class-validator length cap.

---

## 8. Acceptance Criteria

### From #339
- [x] Operator views master + per-channel descriptions on one screen. *(Step 16 + 17.)*
- [x] Drafts don't touch the platform until Publish. *(Reuses `ContentDraftService.saveDraft`; integration test verifies.)*
- [x] Discarding a draft reverts the UI to the platform value. *(Reuses `ContentDraftService.discardDraft`.)*
- [x] Conflict surfaces a two-pane UI and never silently overwrites. *(Step 16 `ContentConflictPane`.)*
- [x] Breakpoints verified at 360 / 768 / 1440. *(Step 18 CSS + manual QA pre-commit; screenshots attached to the PR at all three widths per `docs/frontend-ui-style-guide.md` §Responsive phase-PR rule.)*

### From #342
- [x] Suggest on a channel panel uses the channel-specific template. *(Step 3 service resolves template by channel.)*
- [x] Accept saves as a draft; platform not touched. *(Step 10 endpoint enforces via `saveDraft` only.)*
- [x] Publish pushes the draft to the platform via the correct port. *(Step 6 channel publisher; integration test verifies.)*
- [x] AI never writes to the platform directly. *(Step 10: no code path in the suggest endpoint invokes a `*Port.update*` method.)*
- [x] Cached input tokens observable in logs. *(Step 3: structured log carries `cachedInputTokens`.)*

---

## 9. Step-count summary

| Layer | New files | Modified files |
|---|---|---|
| Core domain (exceptions + types) | 3 | 0 |
| Core application (service + interface + types) | 3 | 1 (publisher) |
| Core module wiring | 0 | 2 (`content.tokens.ts`, `content.module.ts`, `index.ts`) |
| API controller + DTOs + module | 8 | 1 (`app.module.ts`) |
| API integration test | 1 | 0 |
| FE feature module | ~14 (types, api, 5 hooks, 6 components + tests) | 2 (`api-client.ts`, `test-utils.tsx`) |
| FE page + CSS | 0 | 2 (`product-detail-page.tsx`, `index.css`) |
| Docs | 0 | 1 (`architecture-overview.md`) |

~30 files touched; zero migrations; zero new ports; zero new integrations.
