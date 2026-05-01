# Implementation Plan — #449 Allegro safetyInformation ATTACHMENTS upload UI

## 1 — Goal

Ship an end-to-end flow so operators can attach PDF safety-information files to an Allegro connection's `sellerDefaults.safetyInformation` (`type: 'ATTACHMENTS'`) without dropping into the JSON view. Allegro is the system of record for the file bytes; OL only persists the returned attachment id in the existing `Connection.config.allegro.sellerDefaults.safetyInformation.attachments[].id` JSONB blob (no schema change — already covered by #445).

**Layer**: BE Integration (Allegro adapter + util + new HTTP-client multipart method) + BE Interface (new REST endpoint) + FE feature (file-upload primitive + wizard wiring).

**Non-goals** (carried straight from the issue):
- Per-product (not per-connection) safety attachments.
- An attachment management UI outside the connection wizard.
- File-storage retention/cleanup — Allegro owns the file.
- Discovering or repairing attachments uploaded outside OL.

## 2 — Codebase research notes

- **Schema already supports ATTACHMENTS.** `libs/integrations/allegro/src/domain/types/allegro-seller-defaults.types.ts:55-58` defines the discriminated union including `{ type: 'ATTACHMENTS'; attachments: Array<{ id: string }> }`. The adapter preflight at `allegro-offer-manager.adapter.ts:147-162` validates that `attachments[]` is present and non-empty; no changes needed there.
- **The wizard already shows the `ATTACHMENTS` value as a discriminator.** The Zod schema (`apps/web/src/features/connections/components/edit-connection.schema.ts`) and the form serializer pass `attachments[]` through. The gap is purely UI: `allegro-seller-defaults-section.tsx:255-257` only renders `<option>` tags for `NO_SAFETY_INFORMATION` and `TEXT`, with a paragraph admitting "no upload UI is shipped yet".
- **Allegro upload-domain client already exists.** `AllegroAdapterFactory` (`allegro-adapter.factory.ts:106-190`) instantiates a *second* `IAllegroHttpClient` pointed at `upload.allegro.pl[.allegrosandbox.pl]`, sharing token state with the main client. `AllegroOfferManagerAdapter` references it as `this.uploadHttpClient` (line 209+ in the doc comment). **The util receives this client via DI from the adapter — same pattern as `uploadImagesViaAllegro`.**
- **Image upload is the pattern to mirror, with one delta.** `libs/integrations/allegro/src/infrastructure/util/upload-images-via-allegro.ts` does the equivalent flow for images: per-file POST via `uploadHttpClient.postBinary(path, contentType, bytes)`. **Difference for attachments**: the existing `postBinary` only handles raw-byte requests, but the safety-attachment endpoint takes `multipart/form-data` (per Allegro's documented patterns for document uploads — it needs filename metadata alongside bytes). We add a sibling `postMultipart` method to `IAllegroHttpClient` to cover this.
- **No multipart handling exists in `apps/api` yet.** `grep -rn "FileInterceptor\|multer"` returns zero. We'll need NestJS' standard pattern: `multer` (runtime) + `@types/multer` (dev), `FileInterceptor` from `@nestjs/platform-express`. In-memory storage; per-file size cap.
- **HTTP layout.** New endpoint slots into `apps/api/src/integrations/http/allegro.controller.ts` next to the other `connections/:id/...` allegro-specific routes (`responsible-producers`, etc.). Auth uses `@Roles('admin')` per existing pattern.
- **Connection persistence.** `Connection.config` is JSONB; the wizard's update-connection flow already handles `sellerDefaults.safetyInformation.attachments[]` because the FE serializer (`edit-connection.schema.ts:191-196`) passes it. No core/repository changes needed.
- **No existing FE file-upload primitive.** `grep` returns zero. New shared primitive at `apps/web/src/shared/ui/file-upload.tsx`.

## 3 — Solution design

### 3.1 Allegro endpoint URL — assumed contract + verification gate

Public Developer Portal pages don't name the path explicitly enough to cite, but Allegro's naming conventions and the issue's documented response shape (`{ id }`) point at:

- **Path**: `POST {uploadHost}/sale/sale-product-offer-attachments`
- **Request body**: `multipart/form-data` with a single `file` part (`Content-Disposition: form-data; name="file"; filename="..."`). The MIME type lives in the part's `Content-Type` header.
- **Response**: `{ id: string }` (possibly with extra fields like `status`, `fileName` — we only consume `id`).

**These remain assumptions until first sandbox call succeeds.** All three live behind isolated constants/helpers so the cost of a wrong assumption is one-line edits:
- Path: `ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH` constant
- Multipart shape: contained in the new `postMultipart` HTTP-client method
- Response parse: `parseUploadResponse` helper inside the util

**Verification gate**: the implementation is structured so the first *successful* sandbox upload proves the contract end-to-end. If sandbox returns 4xx for path/shape mismatch, the failure is contained to constants/helpers above. The PR should explicitly call out the verification status in the description.

### 3.2 Backend — adapter capability + HTTP-client multipart + service + controller

**New domain capability (sub-capability on `OfferManagerPort`):** following the established pattern in `libs/core/src/listings/domain/ports/capabilities/` (#337):

```ts
// libs/core/src/listings/domain/ports/capabilities/safety-attachment-uploader.capability.ts
/**
 * Safety Attachment Uploader Capability
 *
 * Optional sub-capability of OfferManagerPort. Although safety attachments
 * are connection-level today (sellerDefaults), per-offer attachments are
 * a likely follow-up — keeping the capability under OfferManagerPort
 * matches the existing offer-creation seam and avoids growing a parallel
 * port hierarchy. See #449 + the issue's "out of scope" section.
 */
export interface SafetyAttachmentUploader {
  uploadSafetyAttachment(input: SafetyAttachmentUploadInput): Promise<SafetyAttachmentUploadResult>;
}
```

**HTTP client multipart method:** new method on `IAllegroHttpClient` mirroring `postBinary`:

```ts
postMultipart<T = unknown>(
  path: string,
  parts: MultipartPart[],
  options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
): Promise<AllegroHttpResponse<T>>;

interface MultipartPart {
  name: string;
  fileName?: string;
  contentType: string;
  bytes: Uint8Array;
}
```

Implementation builds a multipart body using a generated boundary, native `Blob`/`FormData` (Node 18+ supports both), or hand-crafted byte assembly. Will inspect `allegro-http-client.ts` to choose whichever style fits the existing fetch wrapper. Same auth header, same retry + token-refresh machinery as `postBinary` — just a different `Content-Type` and body shape.

**Util:**

```ts
// libs/integrations/allegro/src/infrastructure/util/upload-safety-attachment-via-allegro.ts
export async function uploadSafetyAttachmentViaAllegro(
  uploadHttpClient: IAllegroHttpClient,
  input: SafetyAttachmentUploadInput,
): Promise<SafetyAttachmentUploadResult>
```

The util:
1. Validates `mimeType` against `ACCEPTED_SAFETY_ATTACHMENT_MIME_TYPES` (initial set: `application/pdf`. Issue mentions "PDF and a few other types"; expand if sandbox confirms more types accepted).
2. Validates `bytes.byteLength <= ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES` (initial 25 MB; tighten/loosen once sandbox surfaces the real cap).
3. Calls `uploadHttpClient.postMultipart(ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH, [{ name: 'file', fileName, contentType: mimeType, bytes }])`.
4. Parses response via `parseUploadResponse`, throws typed `AllegroApiException` with code `SAFETY_ATTACHMENT_UPLOAD_FAILED` on non-2xx or shape mismatch.
5. Returns `{ id }`.

**Allegro adapter implementation:** `AllegroOfferManagerAdapter` adds `implements ..., SafetyAttachmentUploader`. The body delegates to the util via **`this.uploadHttpClient`** (the upload-domain client at `upload.allegro.pl[.allegrosandbox.pl]`, NOT `this.httpClient` which targets `api.allegro.pl`). Mistaking these would 404 every call — explicit per review feedback.

**No new application service.** Per review SUGGESTION on the existing `IntegrationsService` seam: the controller resolves the adapter via `IntegrationsService.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')`, narrows via `isSafetyAttachmentUploader(adapter)`, and calls `uploadSafetyAttachment(input)` directly. Adding a wrapper service would be premature.

**REST endpoint:** new method on `AllegroController` (`@Controller('integrations/allegro')`). Because the route is under `integrations/allegro`, connection-resolution rejects non-Allegro `connectionId`s before reaching the capability narrow — so the capability narrow is defense-in-depth, not a real branch (per review SUGGESTION on the dead 501 test):

```ts
@Post('connections/:id/safety-attachments')
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES } }))
@ApiConsumes('multipart/form-data')
@Roles('admin')
async uploadSafetyAttachment(
  @Param('id', ParseUUIDPipe) connectionId: string,
  @UploadedFile(new ParseFilePipe({ validators: [/* mime + size guards */] }))
  file: Express.Multer.File,
): Promise<UploadSafetyAttachmentResponseDto>
```

Returns `{ id, fileName, mimeType, sizeBytes, uploadedAt }` — extra fields are echoed for FE list-item rendering; only `id` flows to Allegro on offer create.

### 3.3 Frontend — file-upload primitive + wizard wiring

**New shared primitive:** `apps/web/src/shared/ui/file-upload.tsx`

```tsx
interface FileUploadProps {
  accept: string;             // MIME or extension list, e.g. "application/pdf"
  maxBytes: number;           // hard cap; show error before submitting
  onFileSelected: (file: File) => void | Promise<void>;
  disabled?: boolean;
  invalid?: boolean;
  busy?: boolean;             // shows spinner / progress
}
```

Plain `<input type="file">` wrapped with a vanilla-CSS drop zone. No Radix needed — native input handles a11y. Uses design tokens (`--bg-surface-muted`, `--border-default`, `--accent-focus`). One file per call; multi-file is the parent's job. New CSS rules in `apps/web/src/index.css` under the `.file-upload`, `.file-upload--invalid`, `.file-upload--busy` classes.

**Mutation hook:** `apps/web/src/features/connections/hooks/use-upload-safety-attachment-mutation.ts`

```ts
useMutation<UploadResult, ApiError, { connectionId: string; file: File }>({
  mutationFn: ({ connectionId, file }) => apiClient.allegro.uploadSafetyAttachment(connectionId, file),
  onSuccess: () => { /* no query invalidation — see state-ownership note */ },
});
```

The API client method (in `connections.api.ts` or a new `allegro.api.ts`) does `FormData` packing and POST.

**State ownership** (per review SUGGESTION): the existing `Connection.config.allegro.sellerDefaults.safetyInformation.attachments` is **server state** (fetched via `useConnectionQuery`). When the wizard opens for an existing connection, RHF initialises the form's `attachments` field from that query's data. Subsequent uploads append to **form state only** (`form.setValue(..., [...current, { id, fileName, ... }])`). On wizard save, the existing update-connection mutation persists the new array back. **No new TanStack Query keys, no separate cache for uploaded-but-unsaved attachments.**

**Wizard integration:** `allegro-seller-defaults-section.tsx`
- Add `<option value="ATTACHMENTS">Provide safety information (file)</option>` to the type `<Select>`.
- When `safetyType === 'ATTACHMENTS'`, render:
  - List of currently-attached files from `form.watch('sellerDefaults.safetyInformation.attachments')` (id + filename + remove button).
  - The `<FileUpload>` primitive. On `onFileSelected`, call `useUploadSafetyAttachmentMutation`. On success, append to the form-state attachments array; the existing serializer at `edit-connection.schema.ts:191-195` only emits `{ id }` to the API, so extra metadata (fileName/mimeType/sizeBytes) stays client-side.
  - Live count `(N/20)`; disable upload button at 20.
  - Help text describing accepted types and size limit.
- Update help paragraph to remove the "no upload UI yet" caveat.

**Zod schema upgrade** (per review SUGGESTION): `edit-connection.schema.ts` currently uses `z.enum([...]).optional()` which doesn't enforce per-branch field requirements. Convert to `z.discriminatedUnion('type', [...])`:

```ts
const allegroSafetyInformationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NO_SAFETY_INFORMATION') }),
  z.object({
    type: z.literal('TEXT'),
    description: z.string().min(1).max(5000),
  }),
  z.object({
    type: z.literal('ATTACHMENTS'),
    attachments: z.array(z.object({ id: z.string().min(1) })).min(1).max(20),
  }),
]);
```

This gives both runtime validation (1–20 attachments on the ATTACHMENTS branch only) and TypeScript narrowing in the form component.

### 3.4 Tests

**BE:**
- `libs/integrations/allegro/src/infrastructure/util/__tests__/upload-safety-attachment-via-allegro.spec.ts`: happy path, MIME-type rejection, size-cap rejection, Allegro 4xx surfacing as `AllegroApiException`, response-shape mismatch.
- `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-http-client.spec.ts` (extend): `postMultipart` builds a correct multipart envelope (boundary, parts ordering, headers), calls `requestWithRetry`, surfaces 4xx.
- `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` (extend): `uploadSafetyAttachment` delegates to the util with `uploadHttpClient`; capability guard `isSafetyAttachmentUploader(adapter)` returns true.
- `apps/api/src/integrations/http/allegro.controller.spec.ts` (extend): controller invokes the integrations service, narrows via guard, returns the DTO. **No 501-branch test** — the route is under `integrations/allegro` so the connection-resolution layer rejects non-Allegro `connectionId`s before reaching the controller. The capability narrow is defense-in-depth; a comment in the controller notes "expected unreachable for Allegro connections — guards future seam where this route may be capability-scoped."

**FE:**
- `apps/web/src/shared/ui/file-upload.test.tsx`: renders, click + change opens picker, drag-drop file fires callback, disabled/busy states, `forwardRef` works.
- `apps/web/src/features/connections/components/allegro-seller-defaults-section.test.tsx` (extend or create): selecting `ATTACHMENTS` renders the upload zone + list; uploading a file calls the mutation; removing a row clears it from form state; cap-of-20 disables further uploads.
- `apps/web/src/features/connections/hooks/use-upload-safety-attachment-mutation.test.tsx`: posts FormData, returns the new id on success, surfaces ApiError on failure.

## 4 — Step-by-step implementation

| # | File | Change |
|---|---|---|
| 1 | `libs/integrations/allegro/src/domain/types/allegro-safety-attachments.types.ts` (new) | Constants: `ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH`, `ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES`, `ACCEPTED_SAFETY_ATTACHMENT_MIME_TYPES`. Type `SafetyAttachmentUploadInput` / `SafetyAttachmentUploadResult`. |
| 2 | `libs/core/src/listings/domain/ports/capabilities/safety-attachment-uploader.capability.ts` (new) | `SafetyAttachmentUploader` interface + co-located `isSafetyAttachmentUploader` type guard with header rationale comment. Re-export from `libs/core/src/listings/index.ts`. |
| 3 | `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.interface.ts` + `.ts` | New `postMultipart` method on the interface and its implementation. Reuses the existing auth + retry + token-refresh machinery; only the body and `Content-Type` differ from `postBinary`. |
| 4 | `libs/integrations/allegro/src/infrastructure/util/upload-safety-attachment-via-allegro.ts` (new) + `.types.ts` | Validates input, calls `uploadHttpClient.postMultipart(...)`, parses response via `parseUploadResponse`, throws typed exceptions. |
| 5 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | `implements ..., SafetyAttachmentUploader`. New method `uploadSafetyAttachment(input)` calling the util via **`this.uploadHttpClient`** (NOT `this.httpClient`). |
| 6 | `apps/api/src/integrations/http/dto/upload-safety-attachment-response.dto.ts` (new) | Response DTO `{ id, fileName, mimeType, sizeBytes, uploadedAt }`. |
| 7 | `apps/api/src/integrations/http/allegro.controller.ts` | New `@Post('connections/:id/safety-attachments')` route with `FileInterceptor`, `ParseFilePipe` validators (mime + size), `IntegrationsService.getCapabilityAdapter(..., 'OfferManager')` + `isSafetyAttachmentUploader` narrow (defense-in-depth, comment to that effect). |
| 8 | `apps/api/package.json` + lockfile | Add `multer` (runtime) + `@types/multer` (dev) — first multipart usage in the codebase. |
| 9 | `apps/web/src/shared/ui/file-upload.tsx` (new) + `.test.tsx` | Shared primitive: dropzone wrapping `<input type="file">`, `forwardRef`, native a11y, vanilla-CSS classes. |
| 10 | `apps/web/src/index.css` | Add `.file-upload`, `.file-upload--invalid`, `.file-upload--busy`, `.file-upload__hint`, `.file-upload__list`, `.file-upload__list-item` rules using design tokens. |
| 11 | `apps/web/src/features/connections/api/connections.api.ts` (or new `allegro.api.ts`) | New `uploadSafetyAttachment(connectionId, file)` method packing `FormData`, POSTing to the new BE endpoint. |
| 12 | `apps/web/src/features/connections/hooks/use-upload-safety-attachment-mutation.ts` (new) | `useMutation` calling the API method. No query invalidation — form state owns the data. |
| 13 | `apps/web/src/features/connections/components/edit-connection.schema.ts` | Convert `allegroSafetyInformationSchema` to `z.discriminatedUnion`. Branch-specific validation: `TEXT` requires `description` (1–5000), `ATTACHMENTS` requires `attachments.length` 1–20. |
| 14 | `apps/web/src/features/connections/components/allegro-seller-defaults-section.tsx` | Add `ATTACHMENTS` `<option>`. Conditionally render: attachments list with remove buttons, `<FileUpload>` primitive, cap-of-20 + count display, accepted-types help text. |
| 15 | Tests | Add the test files / cases listed in §3.4. |

## 5 — Validation

### Architecture compliance
- ✅ `SafetyAttachmentUploader` lives in `libs/core/src/listings/domain/ports/capabilities/` per the established sub-capability pattern (#337). Domain has zero framework deps.
- ✅ Allegro adapter implements the capability via the same util-extracted-from-adapter pattern as `uploadImagesViaAllegro` — keeps the adapter file thin.
- ✅ Controller depends on `IntegrationsService` (existing seam), narrows via type guard, never imports the concrete adapter.
- ✅ `OfferManagerPort` base contract unchanged (#337 precedent).
- ✅ FE state ownership: server state via `useConnectionQuery`, form state via RHF — no new state plane.

### Naming
- ✅ Capability file: `safety-attachment-uploader.capability.ts`.
- ✅ Util: `upload-safety-attachment-via-allegro.ts` mirroring `upload-images-via-allegro.ts`.
- ✅ FE primitive: `file-upload.tsx` exporting `FileUpload`.
- ✅ Mutation hook: `use-upload-safety-attachment-mutation.ts`.

### Testing strategy
- BE util unit-testable with a mocked `IAllegroHttpClient`.
- HTTP client `postMultipart` unit-tested directly (boundary correctness, retry behaviour).
- BE adapter delegates to the util; spec verifies wiring + capability guard.
- FE primitive tested in isolation; wizard integration tested with `renderWithProviders` + a mocked API client.

### Security
- ✅ Auth: `@Roles('admin')` + `JwtAuthGuard`.
- ✅ Multer file-size limit + `ParseFilePipe` MIME validator prevent oversized/unexpected file types from reaching the adapter.
- ✅ No file bytes persisted on OL side — Allegro is the system of record.
- ✅ Returned `id` is opaque to OL; we don't construct download URLs.

### Risks / open questions (carried from review)
- **Endpoint contract assumed but unverified.** Mitigated by isolating path/multipart/parse logic behind constants and helpers — wrong assumption is a one-line edit. PR description should explicitly call out verification status from sandbox testing during PR review.
- **Async-processing**: if Allegro returns `{ id, status: 'PROCESSING' }` and the id can't immediately be referenced from `safetyInformation.attachments[].id` on offer create, that's a follow-up issue (similar pattern to #447's offer-status polling). Not designed for here.
- **First multipart endpoint in the codebase.** Adds `multer` + `@types/multer`. Worth a callout in the PR description.
