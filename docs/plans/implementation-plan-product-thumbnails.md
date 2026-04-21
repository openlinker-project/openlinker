# Implementation Plan — Product Thumbnails (#273, #274, #275)

**Branch:** `273-274-275-product-thumbnails`
**Issues:** #273 (primitive) → #274 (Products list consumer) → #275 (Inventory list consumer)
**Layer:** Frontend (`apps/web`)

---

## 1. Goal

Add small product images next to product names in the Products list (32px) and Inventory list (24px) so operators can visually disambiguate similar names ("Brown bear cushion" / "Brown bear notebook") while scanning.

Three linked deliverables:

1. **#273** — new shared UI primitive `ProductThumbnail` in `apps/web/src/shared/ui/product-thumbnail.tsx` with image + placeholder + error fallback behavior, using existing design tokens.
2. **#274** — wire `ProductThumbnail` into the Products list (table name column + mobile card title), sourcing from `Product.images[0]`.
3. **#275** — wire `ProductThumbnail` into the Inventory list (product column + mobile card title) at `sm` size, sourcing from `InventoryItem.productImageUrl`.

**Non-goals:** zoom-on-hover / lightbox, `lg` size variant, retina `srcset`, per-variant thumbnails, thumbnail-as-link separate from row click.

---

## 2. Architecture layer & conventions

All three issues are pure **frontend** work in `apps/web`. No backend / core / adapter changes — the required fields are already on the wire:

- `Product.images: string[] | null` — `apps/web/src/features/products/api/products.types.ts:35` (shipped by #271)
- `InventoryItem.productImageUrl: string | null` — `apps/web/src/features/inventory/api/inventory.types.ts:21` (shipped by #272)

Conventions to follow (`.claude/rules/frontend.md`, `.claude/rules/ui-components.md`):

- `forwardRef` + `ComponentPropsWithoutRef<'span'>` (so caller can attach a ref / spread extra native attrs)
- Named function inside `forwardRef<El, Props>(function Name(...) {})`
- Manual class concat: `['base', cond ? 'mod' : '', className].filter(Boolean).join(' ')` — never `cn()` / `clsx`
- BEM-flat class names: `.product-thumbnail`, `.product-thumbnail--sm`, `.product-thumbnail__image` (implicit on `<img>`)
- Tokens only — no hardcoded colors. Use `--bg-surface-muted`, `--text-muted`, `--border-subtle`, `--font-mono`
- Accept `className`, merge, never override
- `alt=""` default (decorative when adjacent text is present); caller can override

Reference component for the exact pattern: `apps/web/src/shared/ui/button.tsx`.

---

## 3. Design

### 3.1 `ProductThumbnail` component shape

```tsx
// apps/web/src/shared/ui/product-thumbnail.tsx
import { forwardRef, useState, type ComponentPropsWithoutRef, type ReactElement } from 'react';

export type ProductThumbnailSize = 'md' | 'sm';

export interface ProductThumbnailProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  alt?: string;
  name: string;
  size?: ProductThumbnailSize;
  src: string | null | undefined;
}

export const ProductThumbnail = forwardRef<HTMLSpanElement, ProductThumbnailProps>(
  function ProductThumbnail({ alt = '', className = '', name, size = 'md', src, ...rest }, ref): ReactElement {
    const [erroredSrc, setErroredSrc] = useState<string | null>(null);

    const classes = ['product-thumbnail', `product-thumbnail--${size}`, className].filter(Boolean).join(' ');
    const showImage = Boolean(src) && erroredSrc !== src;
    const initial = name.trim().charAt(0).toUpperCase();

    return (
      <span ref={ref} className={classes} aria-hidden={alt === '' ? true : undefined} {...rest}>
        {showImage ? (
          <img
            src={src ?? undefined}
            alt={alt}
            loading="lazy"
            decoding="async"
            onError={() => { setErroredSrc(src ?? null); }}
          />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </span>
    );
  },
);
```

**Notes:**
- Error state is derived from render via `erroredSrc`, not a boolean + effect. When `src` changes, `erroredSrc !== src` automatically flips back to showing the image — no `useEffect` needed.
- `aria-hidden` on the wrapper when `alt` is empty — decorative thumbnails shouldn't clutter screen readers when an adjacent name label exists. Caller providing explicit `alt` opts out.
- Inner placeholder span gets its own `aria-hidden="true"` — the letter is not meaningful content.
- Placeholder initial is `""` when `name` is empty/whitespace (unreachable in practice given callers' resolved-name inputs; the empty state degrades to an empty square, visually indistinguishable from a sized placeholder).

### 3.2 CSS

Added to `apps/web/src/index.css` in a new section right after the DataTable block (before the FE-specific feature styles). Follows the exact token set and radius prescribed by #273.

```css
.product-thumbnail {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 0.375rem;
  background: var(--bg-surface-muted);
  overflow: hidden;
  font-family: var(--font-mono);
  color: var(--text-muted);
  text-transform: uppercase;
  line-height: 1;
  user-select: none;
}
.product-thumbnail--sm { width: 1.5rem; height: 1.5rem; font-size: 0.6875rem; }
.product-thumbnail--md { width: 2rem;   height: 2rem;   font-size: 0.8125rem; }
.product-thumbnail img { width: 100%; height: 100%; object-fit: cover; display: block; }
```

Shared row-layout helper class (used by both consumer pages to keep thumbnail + text aligned):

```css
.product-row { display: inline-flex; align-items: center; gap: 0.75rem; min-width: 0; }
.product-row__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

### 3.3 Products list integration

`apps/web/src/pages/products/products-list-page.tsx`:

- Replace name cell:
  ```tsx
  cell: (product) => (
    <span className="product-row">
      <ProductThumbnail src={product.images?.[0] ?? null} name={product.name} />
      <span className="product-row__name">{product.name}</span>
    </span>
  ),
  ```
- Replace `cardView.title` with the same row at `size="sm"`:
  ```tsx
  title: (product) => (
    <span className="product-row">
      <ProductThumbnail src={product.images?.[0] ?? null} name={product.name} size="sm" />
      <span className="product-row__name">{product.name}</span>
    </span>
  ),
  ```

### 3.4 Inventory list integration

`apps/web/src/pages/inventory/inventory-list-page.tsx`:

- Wrap the existing name/SKU/productId fallback in `.product-row` with an `sm` thumbnail. The `name` prop resolves `productName ?? productSku ?? productId` so the placeholder letter stays meaningful even when name is null. Existing fallback text stays inside `.product-row__name`.
- `cardView.title` becomes the same `.product-row` with `sm` thumbnail.

### 3.5 Style guide entry

Add an inventory entry to `docs/frontend-ui-style-guide.md` (§ MVP Primitives Standard → **Status & data surfaces**, next to `EntityLabel` / `KeyValueList`):

- Component name, size tokens, accessibility note (decorative-by-default, caller provides `alt` when thumbnail is the sole label)
- Rule: always render a `ProductThumbnail` when a product appears in a list/row — the placeholder doubles as a visual affordance ("this row is a product") and keeps row heights stable while images load

---

## 4. Step-by-step plan

### Step 1 — Primitive (#273)

| # | File | Change |
|---|---|---|
| 1.1 | `apps/web/src/shared/ui/product-thumbnail.tsx` | **New.** Component per §3.1. |
| 1.2 | `apps/web/src/shared/ui/product-thumbnail.test.tsx` | **New.** Tests per §5.1. |
| 1.3 | `apps/web/src/index.css` | **Edit.** Add `.product-thumbnail*` + `.product-row*` blocks per §3.2. Insert right after the DataTable section (after the `.data-table__cell--hide-below-*` block, before feature-specific sections). |
| 1.4 | `docs/frontend-ui-style-guide.md` | **Edit.** Add `ProductThumbnail` entry to the primitives inventory. |

Acceptance: primitive renders four states (image / null src / empty src / broken src → placeholder), two size variants, className merge, ref forwarded, `alt=""` by default.

### Step 2 — Products list consumer (#274)

| # | File | Change |
|---|---|---|
| 2.1 | `apps/web/src/pages/products/products-list-page.tsx` | **Edit.** Import `ProductThumbnail`; replace the name column cell and `cardView.title` per §3.3. |
| 2.2 | `apps/web/src/pages/products/products-list-page.test.tsx` | **Edit.** Add test data row with `images: ['https://cdn.example/p.jpg']`; assert image `src` rendered on that row, placeholder on the row with `images: null`. |

Acceptance: desktop table shows 32px thumbnail + name; mobile card shows 24px thumbnail + name; no layout shift; row-click navigation unaffected; placeholder on empty/null images.

### Step 3 — Inventory list consumer (#275)

| # | File | Change |
|---|---|---|
| 3.1 | `apps/web/src/pages/inventory/inventory-list-page.tsx` | **Edit.** Import `ProductThumbnail`; wrap the existing product column fallback in `.product-row` with `size="sm"`; same in `cardView.title`. |
| 3.2 | `apps/web/src/pages/inventory/inventory-list-page.test.tsx` | **Edit.** Add row with `productImageUrl: 'https://…'`; assert image appears; keep an existing null-url row to assert placeholder. |

Acceptance: 24px thumbnail left of the existing product label on desktop and mobile cards; fallback text (name → SKU → productId) unchanged; numbers columns still the scan target.

### Step 4 — Quality gate

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all unit tests pass
```

### Step 5 — Commit + PR

Three conventional commits, one per issue (cleaner `git log` granularity matching recent product-images PR):

1. `feat(web): add ProductThumbnail shared UI primitive` — closes #273
2. `feat(web): show product thumbnails in Products list` — closes #274
3. `feat(web): show product thumbnails in Inventory list` — closes #275

PR body references all three `Closes #N` lines so GitHub auto-closes on merge.

---

## 5. Testing strategy

### 5.1 `product-thumbnail.test.tsx`

Vitest + @testing-library/react. Covers:

- Renders `<img>` with the given `src` when `src` provided
- Renders placeholder with uppercase first letter of `name` when `src === null`
- Renders placeholder when `src === ''`
- Switches to placeholder on `img.onError` (simulate via `fireEvent.error`)
- Passes explicit `alt` through to the `<img>`; uses `alt=""` by default (and sets `aria-hidden` on wrapper)
- Applies `product-thumbnail--sm` / `product-thumbnail--md` based on `size` prop (default `md`)
- Merges custom `className` with `product-thumbnail` base class (never overrides)
- Forwards ref to the wrapper `<span>`
- Resets error state when `src` changes (re-renders image after previously errored)

### 5.2 `products-list-page.test.tsx` additions

- Sample data row with `images: ['https://cdn.example/p.jpg']` → assert an `<img>` with that `src` is rendered next to the name
- Existing `images: null` row still renders → assert no `<img>` in its `.product-row`, assert a `.product-thumbnail` wrapper is still present (placeholder)
- Existing row-click / loading / error / empty tests must still pass unchanged

### 5.3 `inventory-list-page.test.tsx` additions

- Add a second row with `productImageUrl: 'https://cdn.example/i.jpg'` → assert `<img>` renders
- Keep the existing `productImageUrl: null` row → assert placeholder
- Existing product fallback tests (name → SKU → productId) continue to pass

---

## 6. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Thumbnail intercepts row click (`DataTable` uses `shouldIgnoreRowClick`) | Low — wrapper is a `<span>`, not a link/button | Wrap in a plain `<span>`, confirm `shouldIgnoreRowClick` ignores images (it skips elements matching `a, button, input, select, textarea, [role="button"]`). `<img>` is not in that list. |
| Layout shift as images load | Medium | Wrapper reserves full 24/32px size via CSS; `<img>` fills it with `object-fit: cover`. No shift. |
| Broken external image URLs spam console errors | Low | Silent `onError` flip to placeholder; no log. |
| `name` empty string produces visually-empty placeholder | Very low (unreachable with current types but defensive) | `name.trim().charAt(0)` → fallback to `"·"` middle dot. |
| Existing test snapshots / queries break from added wrapper | Medium | Existing tests use `findByText('Test Product')` — text is still present inside `.product-row__name`. No snapshot tests in either page's test file. |
| Card view row height grows noticeably on mobile | Low | `sm` (24px) size on card view matches the card's existing padding footprint. |

---

## 7. Architecture compliance check

- ✅ Frontend dependency direction respected: `pages → shared/ui`. No `shared → features` or `shared → pages` imports added.
- ✅ No new global state, no new store. Component is stateless except for local `errored` boolean.
- ✅ Uses only existing design tokens — no new CSS custom properties.
- ✅ Follows `forwardRef` + `ComponentPropsWithoutRef` pattern per `.claude/rules/ui-components.md`.
- ✅ `tone`-style prop naming (`size` is a sizing scale, standard pattern).
- ✅ No TypeScript `any`, no `console.log`, no hardcoded secrets.
- ✅ Semantic HTML (`<span>` wrapper + `<img>`), accessibility-aware (decorative by default).
- ✅ Tests colocated, Vitest, no DB/HTTP mocks needed.

---

## 8. Rollout

Single PR. No migration, no config, no env vars. Reversible via PR revert — `ProductThumbnail` is additive; reverting drops the component and restores plain name cells.
