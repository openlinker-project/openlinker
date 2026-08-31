---
paths:
  - "docs/plans/mockups/analytics-ledger-2003.html"
  - "docs/specs/metrics-analytics-dashboard.md"
  - "apps/web/src/pages/analytics/**"
  - "apps/web/src/features/analytics/**"
---

# Analytics Metric Rules

These rules apply to every figure rendered on the Analytics page (`/`, also reachable at `/analytics`)
— in the mockup and in the shipped page alike.

## The definitions are not yours to write

`docs/specs/metrics-analytics-dashboard.md` is the canonical source for what each figure means and
how it is computed. **Read it before changing any metric label, definition, formula, tooltip or
qualifier.**

- Quote it. Do not paraphrase, summarise or "clarify" a definition — the wording was agreed with
  the customer and small rewordings change what the number promises.
- Do not invent a metric it does not cover. A figure with no entry there is not ready to be built;
  it needs a product decision first.
- The file names three figures that render under a shorter UI label (Refunded value, Cancelled
  value, Units per order). That mapping table is part of the spec — keep both sides in sync.

## On divergence, the spec wins

If a rendered label, an issue body, or a comment in the mockup contradicts the spec, the spec is
right and the other place is a bug. Say so explicitly rather than silently picking one — a
divergence usually means a definition drifted after someone edited a copy instead of the original.

## Copies drift, so keep the copy honest

The mockup's ⓘ popovers hold pasted copies of the definitions. When the spec changes, the copies
must be updated in the same change. When a copy is edited first, port it back to the spec — never
leave the two describing different arithmetic.
