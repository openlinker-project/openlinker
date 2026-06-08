# Implementation Plan: WooCommerce Frontend Plugin — Connection Setup Wizard + Platform UI Slots

**Issue**: #975  
**Category**: Frontend  
**Status**: Waiting for #878 (WooCommerce order-source backend) to merge before starting  
**Blocked by**: #878  

---

## Summary

Add the WooCommerce in-tree plugin to the OpenLinker frontend (`apps/web`). This plugin contributes:

1. A **single-step setup wizard** at `/connections/new/woocommerce` — enter connection name, site URL, consumer key, and consumer secret.
2. **Platform UI slots** on the edit-connection form: a `StructuredConfigSection` for `siteUrl` and a `CredentialsPanel` to rotate the `consumerKey` + `consumerSecret` pair.
3. A **setup card** on the platform picker so operators can discover and initiate WooCommerce connections.

WooCommerce uses static Consumer Key / Consumer Secret credentials (no OAuth redirect), so the setup is single-step — simpler than PrestaShop's 4-step wizard and without Allegro's OAuth callback route.

---

## Questions & Assumptions

| # | Question / Assumption | Confidence |
|---|---|---|
| 1 | `woocommerce.rest.v3` is the adapter key that will be registered by #878's backend. Assumed from the pattern `prestashop.webservice.v1` and `allegro.publicapi.v1`. | High |
| 2 | `WooCommerceConnectionConfig.siteUrl` is the only configurable field (other fields like `orders.pageSize` are internal defaults). Sourced from `woocommerce-config.types.ts` in worktree 876. | High |
| 3 | Credentials shape: `{ consumerKey: string; consumerSecret: string }` — from `woocommerce-credentials.types.ts` in worktree 876. | High |
| 4 | Capabilities available on the WooCommerce adapter at #878 merge time: `OrderSource` only (the first WooCommerce PR scope). The wizard will query `/adapters` and default to whatever the backend advertises; the schema's fallback constant should reflect `OrderSource`. | Medium — adjust after #878 lands. |
| 5 | `siteUrl` must be HTTPS — enforced by the backend but mirrored in the FE schema for immediate feedback. Loopback (`localhost` / `127.x`) may be allowed for dev; the FE schema will require `https://` unless the host is a loopback. Per the backend SSRF decision: Azure IMDS and private RFC-1918 ranges are blocked server-side; the FE doesn't need to replicate the full block-list. | High |
| 6 | No `ConnectionActions` slot needed for WooCommerce MVP (PrestaShop has a "Configure webhooks" action; WooCommerce has no equivalent on #878). | High |
| 7 | The `WooCommerceSetupForm` will NOT include a capabilities step — WooCommerce's capability set is small (OrderSource only at MVP), and a step-less form is cleaner for single-capability platforms. The capabilities will be pre-seeded from the adapter registry exactly like the full wizard would produce. If the backend later adds more capabilities, revisit this decision. | Medium |

---

## Architecture Decision

WooCommerce follows the **same hexagonal plugin pattern** as PrestaShop (static credentials, no OAuth), NOT the Allegro pattern (OAuth redirect). The delta from PrestaShop:

- **No steps / stepper** — single flat form with 4 fields.
- **No `getCallbackUrlDefault`** — WooCommerce has no callback URL.
- **No `ConnectionActions`** — no equivalent of PrestaShop's webhook installer.
- **Credential shape differs** — two fields (`consumerKey` + `consumerSecret`) instead of one (`webserviceApiKey`).
- **Config differs** — `siteUrl` instead of `baseUrl`.

All other conventions (form → schema → mutation → toast → navigate, `PageLayout` wrapper, lazy route, `StructuredConfigSection`, `CredentialsPanel`) are copy-adapted from PrestaShop.

---

## Files to Create / Modify

### New Files

| File | Purpose |
|---|---|
| `apps/web/src/features/connections/components/woocommerce-setup.schema.ts` | Zod schema, form value types, `toCreateConnectionInput` mapper |
| `apps/web/src/features/connections/components/woocommerce-setup-form.tsx` | Single-step setup form component |
| `apps/web/src/pages/connections/woocommerce-setup-page.tsx` | Thin `PageLayout` wrapper |
| `apps/web/src/plugins/woocommerce/woocommerce-setup.route.tsx` | Lazy route at `connections/new/woocommerce` |
| `apps/web/src/plugins/woocommerce/components/woocommerce-structured-section.tsx` | Edit-form `siteUrl` field |
| `apps/web/src/plugins/woocommerce/components/woocommerce-credentials-panel.tsx` | Key-rotation panel for `consumerKey` + `consumerSecret` |
| `apps/web/src/plugins/woocommerce/index.ts` | Plugin descriptor (`definePlugin`) |

### Modified Files

| File | Change |
|---|---|
| `apps/web/src/plugins/index.ts` | Append `woocommercePlugin` to the `plugins` array |

---

## Step-by-Step Implementation Plan

Rebase from `main` after #878 is merged, then implement in order.

---

### Phase 1 — Zod Schema + Form Types

**File**: `apps/web/src/features/connections/components/woocommerce-setup.schema.ts`

**Intent**: Define the validated form shape, typed output, and the mapper to `CreateConnectionInput`. This is the single source of truth for field names used by the form, the structured section, and the credentials panel.

```typescript
import { z } from 'zod';
import type { CoreCapability, CreateConnectionInput } from '../api/connections.types';

export const WOOCOMMERCE_ADAPTER_KEY = 'woocommerce.rest.v3';

export const WOOCOMMERCE_FALLBACK_CAPABILITIES: CoreCapability[] = ['OrderSource'];

const httpsOrLoopback = (value: string) =>
  value.startsWith('https://') ||
  value.startsWith('http://localhost') ||
  value.startsWith('http://127.');

export const woocommerceSetupSchema = z.object({
  name: z.string().trim().min(1, 'Connection name is required'),
  siteUrl: z
    .url('Site URL must be a valid URL (e.g. https://shop.example.com)')
    .refine(httpsOrLoopback, 'Site URL must use HTTPS (or localhost for development)'),
  consumerKey: z
    .string()
    .trim()
    .min(1, 'Consumer key is required')
    .refine((v) => v.startsWith('ck_'), 'Consumer key must start with ck_'),
  consumerSecret: z
    .string()
    .trim()
    .min(1, 'Consumer secret is required')
    .refine((v) => v.startsWith('cs_'), 'Consumer secret must start with cs_'),
  enabledCapabilities: z
    .array(z.enum(['ProductMaster', 'InventoryMaster', 'OrderProcessorManager', 'OrderSource', 'OfferManager']))
    .default(WOOCOMMERCE_FALLBACK_CAPABILITIES),
});

export type WoocommerceSetupFormValues = z.input<typeof woocommerceSetupSchema>;
export type WoocommerceSetupFormSubmission = z.output<typeof woocommerceSetupSchema>;

export const WOOCOMMERCE_SETUP_DEFAULT_VALUES: WoocommerceSetupFormValues = {
  name: '',
  siteUrl: '',
  consumerKey: '',
  consumerSecret: '',
  enabledCapabilities: WOOCOMMERCE_FALLBACK_CAPABILITIES,
};

export function toCreateConnectionInput(
  values: WoocommerceSetupFormSubmission,
): CreateConnectionInput {
  return {
    name: values.name,
    platformType: 'woocommerce',
    adapterKey: WOOCOMMERCE_ADAPTER_KEY,
    credentials: { consumerKey: values.consumerKey, consumerSecret: values.consumerSecret },
    config: { siteUrl: values.siteUrl },
    enabledCapabilities: values.enabledCapabilities,
  };
}
```

**Acceptance criteria**:
- `woocommerceSetupSchema.parse({...})` succeeds for valid HTTPS URLs starting with `ck_` / `cs_`.
- It rejects HTTP (non-loopback), missing `ck_` / `cs_` prefixes, blank fields.
- `toCreateConnectionInput` maps cleanly to `CreateConnectionInput` (TypeScript compiles).

---

### Phase 2 — Single-Step Setup Form

**File**: `apps/web/src/features/connections/components/woocommerce-setup-form.tsx`

**Intent**: Single flat form (no stepper) that collects all 4 required fields, queries the adapter registry for the correct capability defaults, and creates the connection via `useCreateConnectionMutation`. Mirrors the structure of `PrestashopSetupForm` but without the step machinery.

Key behaviours:
- `noValidate` on `<form>` — Zod handles validation.
- `FormErrorSummary` visible only after first submit attempt (`submitCount > 0`).
- API errors rendered in an `Alert` at the top.
- Submit button disabled during mutation, shows "Connecting…" text.
- On success: `showToast({ tone: 'success', … })` → `form.reset()` → `navigate('/connections')`.
- Abandon-prevention: `useEffect` attaches a `beforeunload` listener when `form.formState.isDirty`.
- `useAdaptersQuery()` is used to hydrate `enabledCapabilities` from the backend — same pattern as the PrestaShop wizard. The `enabledCapabilities` field is **hidden** from the operator on this single-step form (WooCommerce MVP exposes only `OrderSource`; a capabilities step would be noise). The backend-sourced defaults are written into the form via `form.setValue` once the adapters query resolves.

Skeleton structure:
```tsx
export function WoocommerceSetupForm(): ReactElement {
  const createConnection = useCreateConnectionMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const adaptersQuery = useAdaptersQuery();
  const form = useForm<WoocommerceSetupFormValues, undefined, WoocommerceSetupFormSubmission>({
    defaultValues: WOOCOMMERCE_SETUP_DEFAULT_VALUES,
    resolver: zodResolver(woocommerceSetupSchema),
  });

  // Seed capabilities from adapter registry
  useEffect(() => {
    const adapter = adaptersQuery.data?.find((a) => a.adapterKey === WOOCOMMERCE_ADAPTER_KEY);
    if (adapter) {
      form.setValue('enabledCapabilities', adapter.supportedCapabilities as CoreCapability[]);
    }
  }, [adaptersQuery.data, form]);

  // Abandon prevention
  useEffect(() => {
    if (!form.formState.isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [form.formState.isDirty]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await createConnection.mutateAsync(toCreateConnectionInput(values));
      showToast({ tone: 'success', title: 'Connected', description: 'WooCommerce connection created.' });
      form.reset();
      navigate('/connections');
    } catch {
      // error surfaced via createConnection.error
    }
  });

  // ... render 4 FormField + Input rows + Submit button
}
```

**Acceptance criteria**:
- Submitting with all blank fields shows validation errors without calling the API.
- A valid submit calls `createConnection.mutateAsync` with the correct payload shape.
- API error displays in an `Alert` above the fields.
- Successful submit navigates to `/connections`.
- Closing the tab with dirty fields triggers a native confirm dialog.

---

### Phase 3 — Setup Page

**File**: `apps/web/src/pages/connections/woocommerce-setup-page.tsx`

**Intent**: Thin `PageLayout` wrapper delegating to `WoocommerceSetupForm`. Matches `PrestashopSetupPage` exactly in structure.

```tsx
export function WoocommerceSetupPage(): ReactElement {
  return (
    <PageLayout
      eyebrow="Integrations"
      title="Connect WooCommerce"
      description="Provide your store URL and REST API credentials. OpenLinker uses them to sync orders and inventory."
      summary={
        <div className="toolbar__group">
          <span className="toolbar-chip">REST API</span>
          <span className="toolbar-chip">Guided setup</span>
        </div>
      }
    >
      <WoocommerceSetupForm />
    </PageLayout>
  );
}
```

**Acceptance criteria**:
- Page renders with correct title, description, and toolbar chips.
- `WoocommerceSetupForm` is mounted.

---

### Phase 4 — Plugin Scaffold

#### 4a. Lazy Route

**File**: `apps/web/src/plugins/woocommerce/woocommerce-setup.route.tsx`

```typescript
export const woocommerceSetupRoute: RouteObject = {
  path: 'connections/new/woocommerce',
  handle: { crumb: { group: 'Platform', title: 'Connect WooCommerce' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { WoocommerceSetupPage } = await import('../../pages/connections/woocommerce-setup-page');
    return { Component: WoocommerceSetupPage };
  },
};
```

**Acceptance criteria**: Navigating to `/connections/new/woocommerce` renders `WoocommerceSetupPage`.

---

#### 4b. Structured Config Section

**File**: `apps/web/src/plugins/woocommerce/components/woocommerce-structured-section.tsx`

**Intent**: Plugin-owned structured-config inputs for the edit-connection form. WooCommerce MVP exposes only `siteUrl` (cannot be changed post-create through this form without backend support — label it read-only or note its effect). Initially render it as an editable field using the same `syncStructuredToJson` pattern as PrestaShop's `baseUrl`.

```tsx
export function WoocommerceStructuredSection({
  form,
  configIsParseable,
  syncStructuredToJson,
}: StructuredConfigSectionProps): ReactElement {
  return (
    <FormField
      label="Site URL"
      name="siteUrl"
      error={form.formState.errors.siteUrl?.message}
      description="The root URL of the WooCommerce store. Must use HTTPS."
    >
      <Input
        value={form.watch('siteUrl') ?? ''}
        onChange={(event) => syncStructuredToJson('siteUrl', event.target.value)}
        placeholder="https://shop.example.com"
        disabled={!configIsParseable}
        invalid={Boolean(form.formState.errors.siteUrl)}
      />
    </FormField>
  );
}
```

**Acceptance criteria**: The `siteUrl` field appears in the edit-connection form for WooCommerce connections. Typing a new value updates the JSON config blob via `syncStructuredToJson`.

---

#### 4c. Credentials Panel

**File**: `apps/web/src/plugins/woocommerce/components/woocommerce-credentials-panel.tsx`

**Intent**: Plugin-owned credentials rotation panel. WooCommerce has two credential fields that must be rotated together (`consumerKey` + `consumerSecret`). The rotation form shows/hides on toggle like PrestaShop's single-key rotation, but exposes both fields.

Key behaviours:
- Toggle "Rotate credentials" button → reveals two `<Input type="password">` fields.
- Both fields must be non-empty to enable "Save new credentials".
- Calls `useUpdateConnectionCredentialsMutation` with `{ consumerKey, consumerSecret }`.
- Shows inline `Alert` on error, toast on success.
- Hides and clears the form on success or cancel.

```tsx
export function WoocommerceCredentialsPanel({ connection }: { connection: Connection }): ReactElement {
  const [showRotate, setShowRotate] = useState(false);
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const rotate = useUpdateConnectionCredentialsMutation();
  const { showToast } = useToast();

  if (!connection.credentialsBacked) {
    return (
      <FormField label="API Credentials" name="credentials">
        <Input value="Environment variable (not editable via UI)" disabled />
      </FormField>
    );
  }

  const canSubmit = consumerKey.trim().length > 0 && consumerSecret.trim().length > 0;

  const onRotate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credentials: { consumerKey: consumerKey.trim(), consumerSecret: consumerSecret.trim() },
      });
      showToast({ tone: 'success', title: 'Credentials rotated', description: 'New WooCommerce API credentials are now in use.' });
      setConsumerKey('');
      setConsumerSecret('');
      setShowRotate(false);
    } catch {
      // surfaced via rotate.error
    }
  };

  // ... render toggle / rotation form
}
```

**Acceptance criteria**:
- "Rotate credentials" button appears when `credentialsBacked` is true.
- Both fields visible when rotating; submit disabled until both are non-empty.
- Success rotates credentials and collapses the form.
- Error displayed inline.

---

#### 4d. Plugin Descriptor

**File**: `apps/web/src/plugins/woocommerce/index.ts`

```typescript
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { WoocommerceCredentialsPanel } from './components/woocommerce-credentials-panel';
import { WoocommerceStructuredSection } from './components/woocommerce-structured-section';
import { woocommerceSetupRoute } from './woocommerce-setup.route';

export const woocommercePlugin: OpenLinkerPlugin = definePlugin({
  id: 'woocommerce',
  platformType: 'woocommerce',
  build: {
    routes: [woocommerceSetupRoute],
  },
  platform: {
    displayName: 'WooCommerce',
    setupCard: {
      title: 'WooCommerce',
      description:
        'Connect a WooCommerce store via the REST API. You will need the site URL and a Consumer Key / Secret pair.',
      to: '/connections/new/woocommerce',
      badge: 'REST API',
    },
    StructuredConfigSection: WoocommerceStructuredSection,
    CredentialsPanel: WoocommerceCredentialsPanel,
  },
});
```

**Acceptance criteria**: `woocommercePlugin` typechecks as `OpenLinkerPlugin`. `platformType: 'woocommerce'` and `id: 'woocommerce'` are consistent (matching `assertUniquePluginInvariants` convention).

---

### Phase 5 — Plugin Registry

**File**: `apps/web/src/plugins/index.ts`

Add the import and append `woocommercePlugin` to the array:

```typescript
import { woocommercePlugin } from './woocommerce';

export const plugins: readonly OpenLinkerPlugin[] = [
  prestashopPlugin,
  allegroPlugin,
  woocommercePlugin,   // ← append
];
```

**Acceptance criteria**: `assertUniquePluginInvariants(plugins)` does not throw. WooCommerce setup card appears on the platform picker. `/connections/new/woocommerce` route resolves.

---

## Data Flow

```
User → PlatformPicker (setup card "WooCommerce") 
  → /connections/new/woocommerce (lazy route)
  → WoocommerceSetupPage
    → WoocommerceSetupForm
      → zodResolver(woocommerceSetupSchema)
      → useAdaptersQuery() → seed enabledCapabilities from backend
      → onSubmit → toCreateConnectionInput(values) → useCreateConnectionMutation()
        → POST /connections { platformType: 'woocommerce', adapterKey: 'woocommerce.rest.v3', config: { siteUrl }, credentials: { consumerKey, consumerSecret }, enabledCapabilities: [...] }
        → showToast success → navigate('/connections')

User → Edit Connection (WooCommerce)
  → EditConnectionForm
    → WoocommerceStructuredSection (siteUrl field via syncStructuredToJson)
    → WoocommerceCredentialsPanel (rotate key pair)
```

---

## Testing Strategy

### What to test

Per user constraint: **do not run the full test suite** (`pnpm test` across all packages). Run only the web-scoped quality gate:

```bash
pnpm --filter @openlinker/web lint
pnpm --filter @openlinker/web type-check
```

### Unit tests (optional, add if time allows)

If writing test files, follow `*.test.tsx` co-location convention:

- `woocommerce-setup-form.test.tsx` — happy path submit, validation errors (blank fields, HTTP URL, missing prefix), API error display.
- Use `renderWithProviders()` + `createMockApiClient()` from `test/test-utils.tsx`.
- Do NOT run the full suite; run `pnpm --filter @openlinker/web test --run woocommerce` for isolation.

### Manual verification checklist

- [ ] WooCommerce card appears on the platform picker.
- [ ] `/connections/new/woocommerce` loads without 404.
- [ ] Submitting blank fields shows validation errors per field.
- [ ] `http://` (non-loopback) URL is rejected.
- [ ] Key fields without `ck_` / `cs_` prefix are rejected.
- [ ] Valid submit creates the connection and navigates to `/connections`.
- [ ] Edit-connection form shows `siteUrl` field for WooCommerce connections.
- [ ] Credentials panel shows rotate button, both fields required, success collapses form.
- [ ] Breadcrumb shows "Connect WooCommerce".

---

## Risks and Edge Cases

| Risk | Mitigation |
|---|---|
| Adapter key `woocommerce.rest.v3` doesn't match what #878 registers | Confirm after #878 merges; update `WOOCOMMERCE_ADAPTER_KEY` constant if needed. Single-file change. |
| `ck_` / `cs_` prefix validation may reject valid dev credentials | The refinement is `startsWith`, so any valid WooCommerce key passes. Worst case: remove the refinement for the first iteration. |
| Capabilities from the adapter registry may differ from the `WOOCOMMERCE_FALLBACK_CAPABILITIES` constant | The wizard seeds from `useAdaptersQuery()` at runtime; the constant is only a fallback on network failure. |
| `StructuredConfigSection` Zod schema for `siteUrl` in the edit form — the edit form has its own schema (`EditConnectionForm`'s structured config schema) | Check the `StructuredConfigSectionProps.form` field type. If the edit form doesn't validate `siteUrl` with the same refinement, the FE will show no error on bad input. Confirm schema wiring from `EditConnectionForm`'s structured config mechanism before Phase 4b. |
| `connection.credentialsBacked` is `false` for env-var credentials | Panel already handles this case (disabled display). |

---

## Final Validation Checklist

- [ ] Follows hexagonal architecture (FE: `app → pages → features → shared`, no shared → features import)
- [ ] Plugin in `apps/web/src/plugins/woocommerce/` — consistent with `prestashop/` and `allegro/`
- [ ] Single edit point: only `plugins/index.ts` and one new `plugins/woocommerce/` folder changed
- [ ] No `any` in TypeScript
- [ ] No `console.log` — no logging needed in form components
- [ ] Form uses `noValidate` + Zod; API errors in `Alert`; `FormErrorSummary` gated on `submitCount > 0`
- [ ] Abandon-prevention with `beforeunload`
- [ ] Toast on success
- [ ] Naming conventions: kebab-case files, PascalCase exports, `use-*.ts` hooks
- [ ] Quality gate: `pnpm --filter @openlinker/web lint` + `pnpm --filter @openlinker/web type-check` pass
- [ ] Rebase from `main` after #878 merges — confirm `WOOCOMMERCE_ADAPTER_KEY` matches registered key

---

## Implementation Order

1. `woocommerce-setup.schema.ts` (foundation; blocks everything else)
2. `woocommerce-setup-form.tsx` (uses schema)
3. `woocommerce-setup-page.tsx` (uses form)
4. `woocommerce-setup.route.tsx` (uses page)
5. `woocommerce-structured-section.tsx` (independent)
6. `woocommerce-credentials-panel.tsx` (independent)
7. `woocommerce/index.ts` (assembles all above)
8. `plugins/index.ts` (wire into registry — last, one-line change)

Steps 5 and 6 can be done in parallel with steps 2–4.
