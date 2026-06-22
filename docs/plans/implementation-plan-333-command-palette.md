# Implementation Plan: Frontend — Global Command Palette (⌘K) #333

**Date**: 2026-06-19  
**Status**: Ready for Review  
**Estimated Effort**: 2–3 days

---

## 1. Task Summary

**Objective**: Wire the visual-only ⌘K search slot in the AppShell top bar into a functional global command palette that lets operators jump to connections, orders, products, navigable pages, and sync jobs from anywhere in the app.

**Context**: The AppShell (`apps/web/src/app/app-shell.tsx`) already ships a `TopbarSearchPlaceholder` button — a static, aria-disabled element with a search icon and `⌘K` hint that does nothing. This issue turns the placeholder into a live command palette backed by `cmdk` (paco/cmdk), the de-facto headless command-menu library.

**Classification**: Frontend — Shared UI + App-layer wiring

---

## 2. Scope & Non-Goals

### In Scope
- Amend `docs/frontend-architecture.md` UI Library Policy to permit `cmdk` as a headless primitive.
- Add `cmdk` to `apps/web/package.json`.
- Create `apps/web/src/shared/ui/command-palette.tsx` — a generic, data-agnostic primitive wrapping cmdk in the existing Dialog primitive.
- Create `apps/web/src/app/command-palette-provider.tsx` — mounts the keyboard listener, assembles result sources from feature hooks, manages localStorage recents.
- Replace `TopbarSearchPlaceholder` in `app-shell.tsx` with a `CommandPaletteTrigger` button wired to the provider context.
- Export `CommandPalette` from `shared/ui/index.ts`.
- Five initial result sources: Navigation (static routes), Connections, Orders, Products, Sync Jobs.
- Recent selections: last 5, persisted to `localStorage`, cleared on logout.
- Colocated Vitest test for the primitive (`command-palette.test.tsx`).

### Out of Scope
- New backend endpoints — v1 reuses existing list endpoints.
- Webhook deliveries source (mentioned in the issue but not listed as required in acceptance criteria; can be added as a follow-up by adding one source file).
- Client-side permission filtering — the palette shows what the API returns for the current session.
- `cmdk` used directly outside `shared/ui/command-palette.tsx`.
- Fuzzy matching beyond what cmdk provides out of the box.

### Constraints
- **Blocked by**: The UI refactor PR that ships the `shell-topbar__search` CSS class and visual placeholder. The plan is implementation-ready once that PR lands. Implementation can proceed on a feature branch without the refactor by using the existing `TopbarSearchPlaceholder`'s CSS class names as a starting point.
- Dependency direction `shared` → `features` is **banned** by ESLint. The shared primitive must stay data-agnostic. All feature hook calls happen in `app/command-palette-provider.tsx`.
- `cmdk` may only be imported from `shared/ui/command-palette.tsx` — never from features or pages.

---

## 3. Architecture Mapping

**Target Layer**: Frontend — `shared/ui/` (primitive) + `app/` (provider + keyboard wiring)

**Capabilities Involved**: None (frontend-only, no backend ports).

**Existing Services Reused**:
- `Dialog` / `DialogContent` / `DialogPortal` from `shared/ui/dialog.tsx` — provides the modal overlay, focus trap, and a11y structure for free.
- `useDebouncedValue<T>` from `shared/hooks/use-debounced-value.ts` — already exists; used by each remote source.
- `useConnectionsQuery` from `features/connections/hooks/use-connections-query.ts`
- `useOrdersQuery` from `features/orders/hooks/use-orders-query.ts`
- `useProductsQuery` from `features/products/hooks/use-products-query.ts`
- `useSyncJobsQuery` from `features/sync-jobs/hooks/use-sync-jobs-query.ts`
- `BASE_NAV_GROUPS` from `app/nav-registry.ts` — static nav items become the NavigationSource.
- `useSession` from `shared/auth/use-session.ts` — for logout-triggered recents clear.
- `useNavigate` from `react-router-dom` — for navigating on item select.

**New Components Required**:
- `shared/ui/command-palette.tsx` — UI primitive (types + component)
- `shared/ui/command-palette.test.tsx` — unit tests
- `app/command-palette-provider.tsx` — keyboard listener + source assembly + context

**Core vs Integration Justification**: Pure frontend. No backend layer is touched. The `cmdk` library is a headless behavior primitive analogous to the existing Radix UI wrappers in `shared/ui/`.

---

## 4. External / Domain Research

### Library: `cmdk` (paco/cmdk)

- **Package**: `cmdk` — 5.8 kB gzipped, zero runtime dependencies, MIT licence.
- **API surface used**: `Command`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandEmpty` — all exported named components.
- **Keyboard**: cmdk owns `ArrowUp / ArrowDown / Home / End / Enter` navigation natively. `Esc` is handled by Radix Dialog (closes the portal).
- **Filtering**: cmdk applies its own string filter by default against the item's `value` prop (case-insensitive substring). The `shouldFilter` prop can be set to `false` to delegate filtering entirely to the provider (useful when debounced API results are already filtered).
- **Used by**: Linear, Vercel, Raycast, shadcn/ui — mature, well-tested in production.
- **No library-shipped CSS**: All visuals are ours (matches policy).

### Internal Patterns Found

| Pattern | File | Relevance |
|---|---|---|
| Radix Dialog wrapper | `shared/ui/dialog.tsx` | Model for wrapping cmdk in the same Dialog shell |
| Debounced value hook | `shared/hooks/use-debounced-value.ts` | Ready to use in sources |
| Feature query hooks | `features/*/hooks/use-*-query.ts` | All follow `useQuery` + `useApiClient` pattern |
| `BASE_NAV_GROUPS` | `app/nav-registry.ts` | Static navigation items for NavigationSource |
| `useSession` pattern | `shared/auth/use-session.ts` | Logout detection for recents clear |
| `shared/ui/index.ts` catalog | `shared/ui/index.ts` | One-line export addition pattern |

---

## 5. Questions & Assumptions

### Open Questions
- **Order detail route**: The nav shows `/orders` but the detail path needs confirmation. **Assumed**: `/orders/:orderId` (standard REST pattern seen for `/connections/:connectionId`).
- **Product detail route**: **Assumed**: `/products/:productId`.
- **Sync job detail route**: **Assumed**: `/jobs-logs/:syncJobId` (the nav item uses `/jobs-logs`).
- **UI refactor PR CSS classes**: `shell-topbar__search` and related tokens are assumed stable. If the class names change between the refactor PR and this implementation, only the CSS needs updating — the component logic is unaffected.

### Assumptions
- Navigation items fetch at idle (no network cost). Remote sources (`Connections`, `Orders`, `Products`, `Sync Jobs`) are fetched only after the palette first opens — `enabled: isOpen` in each `useQuery` call.
- Debounce delay: 300 ms (matches the issue spec).
- Recent selections storage key: `ol:palette:recent`; max 5 entries.
- Recent selections are cleared when `session.status` transitions to `'anonymous'` (detected via `useEffect` on `useSession()` output).
- The primitive renders all items in a single cmdk `<Command>` tree; groups are visually separated with `CommandGroup` labels.
- The `CommandPaletteTrigger` is defined inside `app/command-palette-provider.tsx` and exported for use in `app-shell.tsx` (both are in `app/`).
- `cmdk` version: latest stable at time of implementation (currently `^1.0.0`).

### Documentation Gaps
- No documented route map for detail pages. The assumption follows the established `/:resource/:id` REST pattern.

---

## 6. Proposed Implementation Plan

### Phase 1 — Library Policy Amendment and Package Setup
**Goal**: Document the policy change and add the dependency. Unlocks all subsequent steps.

1. **Amend `docs/frontend-architecture.md` — UI Library Policy table**
   - **File**: `docs/frontend-architecture.md`
   - **Action**: Add a row for `cmdk` to the headless library table:
     ```
     | `cmdk` | command-menu keyboard behavior + filtering | `shared/ui/command-palette.tsx` |
     ```
     Add below the `@radix-ui/react-toast` row. Add the import rule "may only be imported from `shared/ui/command-palette.tsx`" to the rules block below the table.
   - **Acceptance**: `pnpm lint` passes; the amendment is discoverable by a future contributor looking at the policy table.

2. **Add `cmdk` to `apps/web/package.json`**
   - **File**: `apps/web/package.json`
   - **Action**: Add `"cmdk": "^1.0.0"` to `dependencies` (it is a runtime dependency, not devDependency). Run `pnpm install` to update the lockfile.
   - **Acceptance**: `pnpm install` succeeds; `pnpm type-check` passes (cmdk ships its own `d.ts`).

---

### Phase 2 — Shared UI Primitive
**Goal**: Build the data-agnostic `CommandPalette` component. No feature hooks, no router calls — pure behavior + visuals.

3. **Create type definitions inside the primitive file**
   - **File**: `apps/web/src/shared/ui/command-palette.tsx`
   - **Action**: Define and export:
     ```typescript
     export interface PaletteItem {
       id: string;
       label: string;
       description?: string;
       to?: string;           // relative path; provider handles navigate()
       keywords?: string[];   // extra cmdk filter hints
     }

     export interface PaletteGroup {
       id: string;
       label: string;
       items: PaletteItem[];
       isLoading?: boolean;
     }

     export interface CommandPaletteProps {
       open: boolean;
       onOpenChange: (open: boolean) => void;
       groups: PaletteGroup[];
       query: string;
       onQueryChange: (query: string) => void;
       onSelect: (item: PaletteItem) => void;
       placeholder?: string;
     }
     ```
   - Types colocated with the component (they are part of its public surface, not broad enough to justify a separate `.types.ts`).
   - **Acceptance**: TypeScript compiles; types are importable by `app/command-palette-provider.tsx`.

4. **Implement `CommandPalette` component**
   - **File**: `apps/web/src/shared/ui/command-palette.tsx`
   - **Action**: Implement the component body:
     ```tsx
     import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from 'cmdk';
     import { Dialog, DialogContent } from './dialog';

     export function CommandPalette({ open, onOpenChange, groups, query, onQueryChange, onSelect, placeholder = 'Search…' }: CommandPaletteProps): ReactElement {
       return (
         <Dialog open={open} onOpenChange={onOpenChange}>
           <DialogContent className="command-palette" aria-label="Command palette">
             <Command shouldFilter={false} className="command-palette__command">
               <CommandInput
                 className="command-palette__input"
                 placeholder={placeholder}
                 value={query}
                 onValueChange={onQueryChange}
               />
               <CommandList className="command-palette__list">
                 <CommandEmpty className="command-palette__empty">No results.</CommandEmpty>
                 {groups.map((group) => (
                   <CommandGroup key={group.id} heading={group.label} className="command-palette__group">
                     {group.isLoading ? (
                       <div className="command-palette__loading" aria-busy="true">Loading…</div>
                     ) : (
                       group.items.map((item) => (
                         <CommandItem
                           key={item.id}
                           value={item.id}
                           keywords={item.keywords}
                           onSelect={() => onSelect(item)}
                           className="command-palette__item"
                         >
                           <span className="command-palette__item-label">{item.label}</span>
                           {item.description ? (
                             <span className="command-palette__item-description">{item.description}</span>
                           ) : null}
                         </CommandItem>
                       ))
                     )}
                   </CommandGroup>
                 ))}
               </CommandList>
             </Command>
           </DialogContent>
         </Dialog>
       );
     }
     ```
   - Use `shouldFilter={false}` — filtering is the provider's responsibility (API-backed results are already filtered; NavigationSource filters inline before passing groups down).
   - Add CSS class names for every element (vanilla CSS against tokens — see Phase 5).
   - **Acceptance**: Component renders without errors; opens/closes on `open` prop change; `onSelect` fires on `Enter` and click; `Esc` closes (Radix Dialog handles it).

5. **Add CSS to `apps/web/src/index.css`**
   - **File**: `apps/web/src/index.css`
   - **Action**: Add a `/* Command Palette */` section with BEM classes:
     - `.command-palette` — `DialogContent` sizing: `max-width: 600px`, `padding: 0`, `overflow: hidden`, `border-radius: var(--radius-lg)`
     - `.command-palette__command` — full-width flex column
     - `.command-palette__input` — full-width input using `var(--fg-default)`, `var(--bg-canvas)`, no border, `padding: var(--space-3) var(--space-4)`
     - `.command-palette__list` — `max-height: 360px`, `overflow-y: auto`
     - `.command-palette__group` — group heading uses `var(--fg-muted)`, `font-size: var(--text-xs)`
     - `.command-palette__item` — flex row, `padding: var(--space-2) var(--space-4)`, cursor pointer; `[data-selected]` uses `var(--bg-accent-soft)` for focus ring
     - `.command-palette__empty` — centered muted text
     - `.command-palette__loading` — skeleton or muted spinner line
   - **Acceptance**: Visual polish passes manual review; active item has visible focus indicator matching design tokens; `pnpm lint` (drift check) passes for any new token vars used.

6. **Export `CommandPalette` from the shared/ui catalog**
   - **File**: `apps/web/src/shared/ui/index.ts`
   - **Action**: Add under the `// ── Overlays / popovers` section:
     ```ts
     export { CommandPalette } from './command-palette';
     export type { CommandPaletteProps, PaletteItem, PaletteGroup } from './command-palette';
     ```
   - **Acceptance**: Import from `'../shared/ui'` works in `app/command-palette-provider.tsx`.

7. **Write `command-palette.test.tsx`**
   - **File**: `apps/web/src/shared/ui/command-palette.test.tsx`
   - **Action**: Vitest + Testing Library tests:
     - `should render nothing when open is false`
     - `should render search input and groups when open is true`
     - `should call onSelect when an item is activated`
     - `should call onOpenChange(false) on Esc keydown`
     - `should call onQueryChange when the input value changes`
     - `should display loading state for a group with isLoading: true`
     - `should display empty state when no items match`
   - Mock `cmdk` if needed, or test against the real cmdk (preferred — testing against the real library catches integration issues).
   - **Acceptance**: `pnpm test` passes; coverage of the primitive ≥ 80%.

---

### Phase 3 — Provider: Keyboard Wiring + Sources
**Goal**: `CommandPaletteProvider` at the `app/` layer assembles result sources, manages `open` state, handles keyboard, and manages recents.

8. **Create `app/command-palette-provider.tsx`**
   - **File**: `apps/web/src/app/command-palette-provider.tsx`
   - **Action**:

   **Context shape**:
   ```typescript
   interface CommandPaletteContextValue {
     openPalette: () => void;
   }
   export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);
   export function useCommandPalette(): CommandPaletteContextValue { /* ... */ }
   ```

   **Provider state**:
   - `open: boolean` — controlled by the provider
   - `query: string` — passed to remote sources
   - `recentItems: PaletteItem[]` — from localStorage, shown as a "Recent" group when `query === ''`

   **Keyboard listener** (in `useEffect`):
   ```typescript
   useEffect(() => {
     const handler = (e: KeyboardEvent) => {
       if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
         e.preventDefault();
         setOpen((prev) => !prev);
       }
     };
     window.addEventListener('keydown', handler);
     return () => window.removeEventListener('keydown', handler);
   }, []);
   ```

   **Recents** (localStorage helpers — defined inline or as module-scope pure functions):
   ```typescript
   const RECENTS_KEY = 'ol:palette:recent';
   const MAX_RECENTS = 5;
   function readRecents(): PaletteItem[] { /* JSON.parse with try/catch */ }
   function writeRecents(items: PaletteItem[]): void { /* JSON.stringify */ }
   ```

   **Logout clear** (via `useSession`):
   ```typescript
   const { session } = useSession();
   useEffect(() => {
     if (session.status === 'anonymous') {
       localStorage.removeItem(RECENTS_KEY);
       setRecentItems([]);
     }
   }, [session.status]);
   ```

   **`handleSelect`** (called when an item is selected):
   ```typescript
   const navigate = useNavigate();
   const handleSelect = useCallback((item: PaletteItem) => {
     setOpen(false);
     setQuery('');
     // Persist to recents
     const updated = [item, ...recentItems.filter((r) => r.id !== item.id)].slice(0, MAX_RECENTS);
     setRecentItems(updated);
     writeRecents(updated);
     // Navigate
     if (item.to) navigate(item.to);
   }, [navigate, recentItems]);
   ```

   **Debounced query** for remote sources:
   ```typescript
   const debouncedQuery = useDebouncedValue(query, 300);
   ```
   Import from `'../shared/hooks/use-debounced-value'`.

   **Source: Navigation** (static, no network):
   ```typescript
   const navItems: PaletteItem[] = useMemo(() => {
     return BASE_NAV_GROUPS
       .filter((g): g is LiveNavGroup => g.kind === 'live')
       .flatMap((g) => g.items.map((item) => ({
         id: `nav:${item.to}`,
         label: item.label,
         to: item.to,
         keywords: ['navigate', 'go to', item.label.toLowerCase()],
       })));
   }, []);
   ```
   Filter by `query` client-side (substring match on `label`).

   **Source: Connections** (fetch on first open, then cached by TanStack Query):
   ```typescript
   const connectionsQuery = useConnectionsQuery(undefined, { /* no refetchInterval */ });
   // enabled by default; TanStack Query will cache after first open
   ```
   Map to `PaletteItem[]`: `{ id: 'conn:' + c.id, label: c.name, description: c.platformType, to: '/connections/' + c.id }`.
   Filter client-side on `debouncedQuery` (connections list is typically small).

   **Source: Orders** (fetch on first open, filter server-side):
   ```typescript
   const ordersQuery = useOrdersQuery(
     query.length >= 2 ? { search: debouncedQuery } : undefined,
     { limit: 10 },
   );
   ```
   Map to `PaletteItem[]`: `{ id: 'order:' + o.id, label: o.externalOrderNumber ?? o.id, description: o.status, to: '/orders/' + o.id }`.

   **Source: Products** (fetch on first open, filter server-side):
   ```typescript
   const productsQuery = useProductsQuery(
     query.length >= 2 ? { search: debouncedQuery } : undefined,
     { limit: 10 },
   );
   ```
   Map to `PaletteItem[]`: `{ id: 'product:' + p.id, label: p.name, description: p.sku ?? undefined, to: '/products/' + p.id }`.

   **Source: Sync Jobs** (fetch on first open, filter server-side):
   ```typescript
   const syncJobsQuery = useSyncJobsQuery(
     query.length >= 2 ? { search: debouncedQuery } : undefined,
     { limit: 10 },
   );
   ```
   Map to `PaletteItem[]`: `{ id: 'job:' + j.id, label: j.type + ' — ' + j.id, description: j.status, to: '/jobs-logs/' + j.id }`.

   **Groups assembly**:
   ```typescript
   const groups: PaletteGroup[] = useMemo(() => {
     const result: PaletteGroup[] = [];
     if (!query && recentItems.length > 0) {
       result.push({ id: 'recent', label: 'Recent', items: recentItems });
     }
     // Navigation always shown, filtered client-side
     const filteredNav = query
       ? navItems.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
       : navItems;
     if (filteredNav.length > 0) result.push({ id: 'nav', label: 'Navigation', items: filteredNav });
     // Remote sources — shown only when query has meaningful input OR already fetched
     if (connectionsQuery.data?.length || connectionsQuery.isLoading) {
       const filteredConns = (connectionsQuery.data ?? [])
         .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))
         .map(...);
       result.push({ id: 'connections', label: 'Connections', items: filteredConns, isLoading: connectionsQuery.isLoading });
     }
     // ... orders, products, sync-jobs similarly
     return result;
   }, [query, recentItems, navItems, connectionsQuery, ordersQuery, productsQuery, syncJobsQuery, debouncedQuery]);
   ```

   **JSX**:
   ```tsx
   return (
     <CommandPaletteContext.Provider value={{ openPalette }}>
       {children}
       <CommandPalette
         open={open}
         onOpenChange={setOpen}
         groups={groups}
         query={query}
         onQueryChange={setQuery}
         onSelect={handleSelect}
         placeholder="Search orders, products, connections…"
       />
     </CommandPaletteContext.Provider>
   );
   ```

   - **Acceptance**: Palette opens on ⌘K/Ctrl+K from any route; all five source groups render; recent items persist across opens; logout clears recents; navigate fires on item select.

9. **Export `CommandPaletteTrigger` from the provider**
   - **File**: `apps/web/src/app/command-palette-provider.tsx`
   - **Action**: Add an exported `CommandPaletteTrigger` component that reads the context and renders the trigger button (replacing `TopbarSearchPlaceholder`):
   ```tsx
   export function CommandPaletteTrigger(): ReactElement {
     const { openPalette } = useCommandPalette();
     return (
       <button
         type="button"
         className="shell-topbar__search"
         aria-label="Open command palette (⌘K)"
         onClick={openPalette}
       >
         <span className="shell-topbar__search-icon" aria-hidden="true">⌕</span>
         <span className="shell-topbar__search-placeholder">
           Search orders, products, connections…
         </span>
         <kbd className="shell-topbar__search-kbd" aria-hidden="true">⌘K</kbd>
       </button>
     );
   }
   ```
   - **Acceptance**: Button is focusable, has correct `aria-label`, opens palette on click.

---

### Phase 4 — AppShell Wiring
**Goal**: Mount the provider and replace the placeholder.

10. **Mount `CommandPaletteProvider` in `app-shell.tsx`**
    - **File**: `apps/web/src/app/app-shell.tsx`
    - **Action**:
      - Import `CommandPaletteProvider` and `CommandPaletteTrigger` from `'./command-palette-provider'`.
      - Remove the `TopbarSearchPlaceholder` function and its `<TopbarSearchPlaceholder />` usage.
      - Wrap the shell's root `<div className="shell">` with `<CommandPaletteProvider>`.
      - Replace `<TopbarSearchPlaceholder />` in the topbar with `<CommandPaletteTrigger />`.
    - **Acceptance**: `TopbarSearchPlaceholder` is fully removed; the trigger button renders in the same slot; clicking it opens the palette; ⌘K works from any child route.
    - **Dependency**: Steps 8 + 9 must be complete.

---

### Phase 5 — Quality Gate
**Goal**: No regressions before commit.

11. **Run quality gate**
    ```bash
    cd /path/to/worktree
    pnpm lint        # zero errors
    pnpm type-check  # zero errors
    pnpm test        # all tests pass including new command-palette.test.tsx
    ```
    - **Acceptance**: All three commands exit 0. ESLint `no-restricted-imports` confirms no `cmdk` import outside `command-palette.tsx`. Design-token drift check passes.

---

### Implementation Details

**New Components**:
- `apps/web/src/shared/ui/command-palette.tsx` — exports `CommandPalette`, `PaletteItem`, `PaletteGroup`, `CommandPaletteProps`
- `apps/web/src/shared/ui/command-palette.test.tsx` — Vitest tests
- `apps/web/src/app/command-palette-provider.tsx` — exports `CommandPaletteProvider`, `CommandPaletteTrigger`, `CommandPaletteContext`, `useCommandPalette`

**Modified Files**:
- `docs/frontend-architecture.md` — policy table row + import rule
- `apps/web/package.json` — `cmdk` dependency
- `apps/web/src/shared/ui/index.ts` — 2-line export addition
- `apps/web/src/app/app-shell.tsx` — remove `TopbarSearchPlaceholder`, add `CommandPaletteProvider` + `CommandPaletteTrigger`
- `apps/web/src/index.css` — command palette CSS section

**Configuration Changes**: None (no env vars needed).

**Database Migrations**: None (frontend-only).

**Events**: None.

**Error Handling**:
- Each `useQuery` call handles loading/error state via `isLoading` / `isError` flags. On query error, the source group is hidden (no group rendered for failed queries) — the palette remains functional with other sources.
- `readRecents()` wraps `JSON.parse` in try/catch; corrupted localStorage returns `[]`.
- If `useNavigate()` is called with an invalid path, React Router silently ignores it. Items always supply valid paths, so this is informational only.

---

## 7. Alternatives Considered

### Alternative 1: Build a custom command palette from scratch using `<dialog>` + Radix Select
- **Description**: Use the native `<dialog>` element or a Radix Popover as the shell, implement keyboard navigation manually with `useRef` + `onKeyDown`.
- **Why Rejected**: Arrow-key roving tabindex, type-ahead filtering, ARIA `role="listbox"` / `role="option"` markup, and CMDk's cmdk-specific ARIA patterns are non-trivial to implement correctly. `cmdk` encapsulates ~1 500 lines of keyboard + a11y logic that would otherwise be hand-rolled.
- **Trade-offs**: Custom implementation avoids adding a dependency; `cmdk` is battle-tested and maintained. For a single component adding 5.8 kB gzipped, the dependency is justified.

### Alternative 2: Re-use the existing `Combobox` primitive
- **Description**: Extend `shared/ui/combobox.tsx` (wraps a custom dropdown) to act as a global command menu.
- **Why Rejected**: `Combobox` is built for form field use (React Hook Form integration, controlled `ComboboxValue`). The command palette is a modeless global overlay with multiple grouped sources, recents, keyboard-shortcut trigger, and navigation dispatch — a fundamentally different UX contract.

### Alternative 3: Radix DropdownMenu or Select as the overlay
- **Description**: Use an existing Radix primitive to avoid new dependencies.
- **Why Rejected**: Neither Radix DropdownMenu nor Select ships the command-search pattern (fuzzy filtering, multi-group, type-to-filter input). Radix does not have a command palette primitive.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ `shared/ui/command-palette.tsx` contains no feature imports — it is a pure presentational primitive with typed props.
- ✅ Feature hooks (`useConnectionsQuery`, etc.) called only from `app/command-palette-provider.tsx` — within the allowed `app → features` dependency direction.
- ✅ `cmdk` imported only from `shared/ui/command-palette.tsx`. ESLint `no-restricted-imports` should be extended to enforce this:
  ```json
  { "name": "cmdk", "message": "cmdk may only be imported from shared/ui/command-palette.tsx" }
  ```
  Add this rule to `.eslintrc.js` under the global rule set (or the `apps/web/src` scope). **Important**: add this to the `.eslintrc.js` rule to prevent future violations.
- ✅ No `console.log`, no `any`, no inline secrets.

### Naming Conventions
- ✅ Component file: `command-palette.tsx` (kebab-case, named export `PascalCase`)
- ✅ Provider file: `command-palette-provider.tsx`
- ✅ Test file: `command-palette.test.tsx`
- ✅ Hook: `useCommandPalette` (camelCase with `use` prefix)
- ✅ Context: `CommandPaletteContext`

### Existing Patterns
- ✅ Follows the Radix wrapper pattern established by `dialog.tsx`, `dropdown-menu.tsx`, `popover.tsx`.
- ✅ Follows the provider pattern established by `toast-provider.tsx`.
- ✅ Follows feature barrel imports (all feature hooks imported from barrel where barrels exist; connections, orders, products, and sync-jobs features each expose a public barrel index or the hooks directly).

### Risks

- **TanStack Query cache misuse**: Remote sources call `useQuery` unconditionally inside the provider (which is always mounted once the user is authenticated). This means the first `useConnectionsQuery()` call may fire at mount, not on first open. To defer, set `enabled: isOpen || connectionsQuery.isFetched` — queries only run once the palette is first opened, then cache is reused. **Mitigation**: use `enabled: isOpen` for the first open; after that, staleTime handles re-fetch intervals normally.
- **Memory leak if provider is unmounted while queries are in-flight**: TanStack Query handles cleanup automatically on unmount. No additional action required.
- **cmdk version drift**: cmdk v1.x API is stable; no breaking changes expected in minor versions. The `^1.0.0` semver range is safe.
- **Feature barrel completeness**: `useOrdersQuery` is imported from the feature hook file directly, not via a barrel. If the connections feature barrel doesn't export the hook, import directly from the hooks path (same-feature internal path). Verify barrel exports before implementation.
- **ESLint rule for `cmdk`**: The "no direct cmdk import" rule must be added to `.eslintrc.js`. If forgotten, a future contributor can import cmdk from a feature; add the ESLint rule as Step 1.5 or during the quality gate step.

### Edge Cases
- **Empty query, no recents**: Shows all navigation items and all connections (no debounce needed — they're already loaded).
- **Long connection list**: Connections are filtered client-side (typically < 20). No virtualization needed for v1.
- **Order search with 1 character**: `query.length >= 2` guard prevents firing the API on single-character input. Below 2 chars, orders/products/jobs groups are hidden.
- **cmdk empty state**: `<CommandEmpty>` renders when no `CommandItem` is visible across all groups. Ensure it's always present in the markup.
- **Focus return after close**: Radix Dialog returns focus to the element that was focused before the dialog opened — this is handled by Radix automatically.
- **Mobile**: The `shell-topbar__search` button is already present in the mobile topbar layout. `CommandPaletteTrigger` replaces it identically.

### Backward Compatibility
- ✅ `TopbarSearchPlaceholder` is removed — it was always aria-disabled with no functionality. No consumers outside `app-shell.tsx`.
- ✅ No API changes.
- ✅ No breaking changes to existing shared/ui exports.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests — `command-palette.test.tsx`
- `should not render palette when open is false`
- `should render input and groups when open is true`
- `should call onQueryChange when typing in the input`
- `should call onSelect with the correct item when Enter is pressed on an active item`
- `should call onOpenChange(false) when Esc is pressed`
- `should show loading indicator for a group with isLoading: true`
- `should show CommandEmpty when all groups are empty`
- **Files**: `apps/web/src/shared/ui/command-palette.test.tsx`

### Unit Tests — `command-palette-provider.tsx`
- Tested as part of the primitive integration; full provider tests would require mocking all feature hooks. For v1, the provider is covered by manual QA + the primitive unit tests.
- If a dedicated provider test is added later, it mocks `useConnectionsQuery`, `useOrdersQuery`, `useProductsQuery`, `useSyncJobsQuery`, and `useSession`.

### Mocking Strategy
- `cmdk` is not mocked — tests run against the real library (catches integration bugs).
- Feature hooks are not called in the primitive tests (the primitive takes `groups: PaletteGroup[]` as props).
- `useNavigate` from `react-router-dom` is mocked in provider tests if added.

### Acceptance Criteria
- [ ] `docs/frontend-architecture.md` UI Library Policy table includes `cmdk` row.
- [ ] `cmdk` added to `apps/web/package.json` dependencies.
- [ ] `CommandPalette` exported from `shared/ui/index.ts`.
- [ ] Palette opens on ⌘K / Ctrl+K from any authenticated route.
- [ ] Palette closes on Esc and on backdrop click (Radix Dialog handles both).
- [ ] Navigation items render in the "Navigation" group and navigate on select.
- [ ] Connections items render (by connection name) and navigate to `/connections/:id`.
- [ ] Orders items render for query ≥ 2 chars and navigate to `/orders/:id`.
- [ ] Products items render for query ≥ 2 chars and navigate to `/products/:id`.
- [ ] Sync Jobs items render for query ≥ 2 chars and navigate to `/jobs-logs/:id`.
- [ ] Last 5 recent selections are shown as a "Recent" group when query is empty.
- [ ] Recents are persisted to `localStorage` and survive page reload.
- [ ] Recents are cleared on logout (session status → anonymous).
- [ ] Focus returns to the invoking element after palette closes (Radix default).
- [ ] Keyboard navigation: ArrowUp / ArrowDown / Home / End works inside the list.
- [ ] Active item has a visible focus ring using design tokens.
- [ ] No ESLint errors from `cmdk` import outside `command-palette.tsx`.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` all exit 0.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (frontend-only; no backend layers touched)
- [x] Respects CORE vs Integration boundaries (n/a — pure FE)
- [x] Uses existing patterns (Dialog wrapper, TanStack Query, useDebouncedValue, useSession)
- [x] Idempotency considered (localStorage write is idempotent; TanStack Query dedupes)
- [x] Event-driven patterns used where applicable (n/a — palette is user-triggered, not event-driven)
- [x] Rate limits & retries addressed (TanStack Query handles retry; debounce guards keystroke flood)
- [x] Error handling comprehensive (query errors hide the group; localStorage parse errors return `[]`)
- [x] Testing strategy complete (primitive unit tests + acceptance criteria)
- [x] Naming conventions followed (`kebab-case.tsx`, `PascalCase` exports, `use-*` hooks)
- [x] File structure matches standards (`shared/ui/` for primitive, `app/` for provider)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Frontend Architecture](../frontend-architecture.md) — UI Library Policy, dependency rules
- [Frontend UI Style Guide](../frontend-ui-style-guide.md) — design tokens and component patterns
- [Engineering Standards](../engineering-standards.md) — naming conventions, TypeScript rules
- [Testing Guide](../testing-guide.md) — Vitest + Testing Library patterns
- [Architecture Overview](../architecture-overview.md) — dependency direction rules
