---
paths:
  - "apps/web/src/pages/**"
  - "apps/web/src/features/**"
---

# Page & Feature Composition Rules

These rules apply when building pages and feature modules in the OpenLinker frontend.

## Page Structure

Every page follows this layout using `PageLayout`:

```tsx
<PageLayout
  eyebrow="Section"
  title="Page Title"
  description="Optional subtitle"
  actions={<Link className="button button--primary" to="/new">Create</Link>}
>
  {/* Page content */}
</PageLayout>
```

## Data Fetching Pattern

### Query Hook → Loading → Error → Empty → Data

Every page or feature component that fetches data must handle all four states explicitly:

```tsx
function ConnectionsListPage() {
  const connectionsQuery = useConnectionsQuery();

  if (connectionsQuery.isLoading) {
    return <LoadingState title="Loading connections" message="Fetching connection data..." />;
  }

  if (connectionsQuery.error) {
    return (
      <ErrorState
        title="Unable to load connections"
        message={connectionsQuery.error.message}
        action={<Button onClick={() => void connectionsQuery.refetch()}>Retry</Button>}
      />
    );
  }

  const connections = connectionsQuery.data ?? [];
  if (connections.length === 0) {
    return (
      <EmptyState
        title="No connections yet"
        message="Create your first integration connection to get started."
        action={<Link className="button button--primary" to="/connections/new">Add connection</Link>}
      />
    );
  }

  return <DataTable rows={connections} columns={columns} rowKey={(c) => c.id} />;
}
```

### Rules

- **Never skip states** — loading, error, and empty must always be handled
- **Use feedback components** — `LoadingState`, `ErrorState`, `EmptyState` from `shared/ui/feedback-state`
- **Provide retry on errors** — `action` prop with `refetch()` call
- **Provide CTA on empty** — guide the user toward the next action
- **Default to empty array** — `const data = query.data ?? []` before length check

## Query & Mutation Hooks

### Query Hooks (in `features/{domain}/hooks/`)

```tsx
// use-connections-query.ts
export function useConnectionsQuery(filters?: ConnectionFilters): UseQueryResult<Connection[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: connectionsQueryKeys.list(filters),
    queryFn: () => apiClient.connections.list(filters),
  });
}
```

### Query Key Factory (in `features/{domain}/api/`)

```tsx
// connections.query-keys.ts
export const connectionsQueryKeys = {
  all: ['connections'] as const,
  list: (filters?: ConnectionFilters) =>
    ['connections', 'list', filters?.platformType ?? 'all', filters?.status ?? 'all'] as const,
  detail: (connectionId: string) => ['connections', 'detail', connectionId] as const,
};
```

### Mutation Hooks

```tsx
// use-create-connection-mutation.ts
export function useCreateConnectionMutation(): UseMutationResult<Connection, Error, CreateConnectionInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.connections.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all });
    },
  });
}
```

### Rules

- **One hook per file** — `use-{action}-query.ts` or `use-{action}-mutation.ts`
- **Always invalidate on mutation success** — use the `all` key to invalidate the entire domain
- **Return the full `UseQueryResult` / `UseMutationResult`** — let the consumer destructure
- **Use `useApiClient()`** — never import the API client directly

## Form Patterns

### Schema → Form → Mutation → Toast

```tsx
// 1. Zod schema (colocated in *.schema.ts)
const schema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
});
type FormValues = z.input<typeof schema>;
type FormSubmission = z.output<typeof schema>;

// 2. Form setup
const form = useForm<FormValues, undefined, FormSubmission>({
  defaultValues: { name: '', email: '' },
  resolver: zodResolver(schema),
});

// 3. Mutation
const mutation = useSomeMutation();
const { showToast } = useToast();

// 4. Submit handler
const onSubmit = form.handleSubmit(async (values) => {
  try {
    await mutation.mutateAsync(values);
    form.reset();
    showToast({ tone: 'success', title: 'Created', description: 'Item was created.' });
  } catch {
    // API error displayed via mutation.error below
  }
});
```

### Form Layout

```tsx
<form onSubmit={onSubmit} noValidate>
  {/* API errors at top */}
  {mutation.error && <Alert tone="error">{mutation.error.message}</Alert>}

  {/* Validation summary after first submit */}
  {form.formState.submitCount > 0 && validationMessages.length > 0 && (
    <FormErrorSummary errors={validationMessages} />
  )}

  {/* Fields */}
  <FormField label="Name" name="name" error={form.formState.errors.name?.message}>
    <Input {...form.register('name')} />
  </FormField>

  {/* Submit with pending state */}
  <Button type="submit" disabled={mutation.isPending}>
    {mutation.isPending ? 'Creating...' : 'Create'}
  </Button>
</form>
```

### Rules

- **Zod schemas in `*.schema.ts`** — colocated with the form component
- **Export types** — `FormValues` (input), `FormSubmission` (output), and a `toApiInput()` mapper if shapes differ
- **Show validation summary only after first submit** — `submitCount > 0`
- **Show API errors in `Alert`** — at the top of the form, separate from validation
- **Disable submit during mutation** — show loading text in the button
- **Reset form on success** — `form.reset()` after successful mutation
- **Toast on success** — always confirm the action to the user
- **`noValidate` on `<form>`** — let Zod handle validation, not the browser

## Toast Usage

```tsx
const { showToast } = useToast();

// Success
showToast({ tone: 'success', title: 'Saved', description: 'Connection updated.' });

// Error (manual, when not using mutation.error)
showToast({ tone: 'error', description: 'Something went wrong.' });
```

- Default auto-dismiss: 4 seconds
- Use for transient feedback (success confirmations, background task completions)
- Do NOT use for errors that need user action — use `Alert` or `ErrorState` instead

## Feature Module Structure

```
features/{domain}/
├── index.ts                       # Public barrel — only the symbols cross-feature/cross-plugin callers need (#609)
├── api/
│   ├── {domain}.api.ts            # API functions
│   ├── {domain}.types.ts          # Request/response types
│   └── {domain}.query-keys.ts     # Query key factory
├── hooks/
│   ├── use-{domain}-query.ts      # Query hooks
│   └── use-{action}-mutation.ts   # Mutation hooks
├── components/
│   ├── {Component}.tsx            # Feature components
│   ├── {Component}.test.tsx       # Component tests
│   └── {component}.schema.ts      # Zod form schemas
├── lib/                           # Optional: pure helpers / view-model mappers
└── types/                         # Optional: feature-local types not bound to api/
```

**Canonical subdirectories** are `api`, `hooks`, `components`, `lib`, `types`. The cross-feature deep-import ban in `.eslintrc.js` enumerates exactly this set. If a new subdirectory is genuinely needed (e.g. `schemas/`, `utils/`), extend the canonical set in `docs/frontend-architecture.md` § Feature Public Surface AND in both ESLint pattern groups at the same time — otherwise the rule silently fails open for the new subdirectory.

Cross-feature and plugin → feature consumers import only from the barrel; same-feature relative imports between subdirectories are unaffected.

## Testing Feature Components

Use `renderWithProviders()` from `test/test-utils.tsx`:

```tsx
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';

it('should show connections table when data loads', async () => {
  const mockApi = createMockApiClient({
    connections: {
      list: vi.fn().mockResolvedValue([{ id: '1', name: 'Store' }]),
    },
  });

  renderWithProviders(<ConnectionsListPage />, { apiClient: mockApi });

  expect(await screen.findByText('Store')).toBeInTheDocument();
});

it('should show error state when fetch fails', async () => {
  const mockApi = createMockApiClient({
    connections: {
      list: vi.fn().mockRejectedValue(new Error('Network error')),
    },
  });

  renderWithProviders(<ConnectionsListPage />, { apiClient: mockApi });

  expect(await screen.findByText('Unable to load connections')).toBeInTheDocument();
});
```

### Testing Priorities

1. **Happy path** — data loads and renders correctly
2. **Loading state** — spinner/skeleton appears
3. **Error state** — error message and retry button
4. **Empty state** — empty message and CTA
5. **Form submission** — validation, success toast, API error display
6. **User interactions** — clicks, navigation, dialog confirm/cancel
