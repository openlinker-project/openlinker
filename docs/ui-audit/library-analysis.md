# UI Library Analysis — OpenLinker Frontend

Produced as part of the UI refactor (epic #236). Audit + baseline are in `docs/ui-audit/`.

## Question

Should the refactor build every UI primitive from scratch, or adopt one or more libraries for the foundation?

## Current architecture constraints

- **Vanilla CSS only** — no Tailwind, no CSS-in-JS (`docs/frontend-architecture.md`, `.claude/rules/frontend.md`).
- **No external UI library** — explicitly: "no shadcn, Radix, MUI — thin wrappers over native HTML" (`.claude/rules/frontend.md`).
- Shared primitives live in `apps/web/src/shared/ui/` and are token-driven from `index.css`.
- State ownership: TanStack Query (server), RHF + Zod (forms), URL params, `SessionProvider`, local state.

The rule "no external UI library" was written before Radix Primitives became the de-facto headless standard. Today the distinction matters: **styled libraries** (MUI, Ant, Mantine, Chakra) bring an opinion about how things look; **headless libraries** (Radix, React Aria, TanStack Table) bring behavior and accessibility without a visual opinion. This analysis treats them separately.

## Context — what we actually need

From the audit, the refactor demands these primitives (style guide `§Core Component Patterns`):

| Primitive | Complexity to build from scratch | Notes |
|---|---|---|
| `DataTable` | 🔴 **High** | Sorting, filtering, column config, virtualization for 4,677-row Jobs list, row selection |
| `Dialog` / `ConfirmDialog` | 🟠 **Medium** | Focus trap, scroll lock, esc handling, ARIA |
| `Select` / `Combobox` | 🔴 **High** | Keyboard navigation, typeahead, portal positioning, a11y |
| `DropdownMenu` | 🟠 **Medium** | Keyboard nav, submenu, portal |
| `Popover` / `Tooltip` | 🟠 **Medium** | Positioning (avoid clipping), hover/focus delays |
| `Tabs` | 🟢 **Low** | Native-ish, we already have this |
| `Toast` | 🟠 **Medium** | Queue, focus management, dismiss |
| `Stepper` (`SetupStepper`) | 🟢 **Low** | Visual pattern, state is local |
| `StatusBadge`, `MetricCard`, `KeyValueList`, `EntityLabel`, `RawPayloadPanel`, `Alert`, `EmptyState`, `FormField` | 🟢 **Low** | Pure presentation, trivial |

The real work is in the high/medium-complexity pieces. Those are exactly what headless libraries cover.

## Option A — Build everything from scratch *(status quo)*

**Pros**
- Zero dependencies; smallest bundle; full control.
- No licensing / maintainer risk.
- Matches current architecture rule literally.

**Cons**
- Re-solving focus traps, portal positioning, keyboard navigation, virtualization.
- A11y is easy to break and hard to maintain (today's a11y 96 rides on simple HTML; once we add custom combobox/modal we will regress without vigilance).
- 4,677-row Jobs list will need virtualization — weeks of work to do well.
- DataTable sort/filter/column-resize is non-trivial.
- **Estimated cost for Phase 3 primitives:** ~2–3 weeks of solid engineering just to match the headless-library baseline.

**Verdict:** feasible but expensive, and we'd spend time re-inventing wheels that don't improve OpenLinker's operator value.

## Option B — Headless foundation + vanilla CSS on top *(recommended)*

Adopt two narrow, headless libraries. Keep all styling in `index.css` tokens. Every primitive is still a thin wrapper we own.

### B.1 — TanStack Table (for `DataTable` only)

- **What it is:** headless table/datagrid state machine. No DOM, no styles.
- **Why:** every list page is a table. Sorting, column config, filtering, pagination, virtualization are solved. TanStack Table ships the state; we ship the markup + CSS.
- **Bundle:** ~14 KB gzipped.
- **License:** MIT.
- **Used by:** Linear, GitHub (parts), Vercel dashboard, many others.
- **Contradicts current rule?** The rule says "thin wrappers over native HTML." TanStack Table *is* that: we render our own `<table>`, it just manages the state. Technically compatible.

### B.2 — Radix Primitives (for Dialog, Select, Dropdown, Tooltip, Popover, Toast, Tabs)

- **What it is:** unstyled, accessible primitives. Each primitive is separately installable.
- **Why:** the accessibility + keyboard + portal + focus-management work is multi-month to get right from scratch. Radix has done it.
- **Bundle:** per-primitive, ~3–8 KB each. For the subset we'd use: ~25–35 KB gzipped.
- **License:** MIT (WorkOS now maintains; formerly Radix/WorkOS).
- **Used by:** shadcn/ui (which is Radix + Tailwind, not a library), Supabase, Linear, Vercel, Resend, dozens of top-tier products.
- **Contradicts current rule?** The rule explicitly bans Radix. **This is the only real judgment call of the analysis.** The rule was written when Radix was new and the team wanted to avoid off-the-shelf looks. Today Radix Primitives provide zero visual opinion — they're behavior only. Updating the rule to "no *styled* UI library" is a sensible revision.

### B.3 — Floating UI (for Tooltip/Popover positioning)

- Radix uses this internally; we may not even need it as a direct dep.
- Only call out if we build any custom positioning logic.

**Pros (of Option B overall)**
- A11y + keyboard handling correct by default. Today's 96 score becomes easier to *maintain*, not just hit.
- Saves 2+ weeks of primitive plumbing.
- Visual identity stays 100% ours (vanilla CSS + tokens).
- Every major commerce-ops tool you mentioned (Shopify admin, Linear) use variants of this stack.
- Incremental: adopt one primitive at a time; revert any individual piece if it doesn't fit.

**Cons**
- Requires updating `.claude/rules/frontend.md` to distinguish headless vs styled.
- Two new dependencies (`@tanstack/react-table`, `@radix-ui/react-*`).
- Slight learning curve — but both libraries have excellent docs and are widely known.

**Estimated cost for Phase 3 primitives:** ~1 week for the primitives layer itself; most of Phase 3 becomes migrating pages onto the new primitives, which we'd do anyway.

## Option C — Styled UI library *(not recommended)*

For completeness. Candidates:

| Library | Fit | Why not |
|---|---|---|
| **Mantine** | High for admin panels | Brings a full design opinion; replaces our style guide. Can't match "Shopify admin + Linear polish." |
| **Ant Design** | High for admin panels | Same as Mantine; aesthetics more CRUD-y, less cockpit-y. |
| **MUI** | Medium | Heavy; its own design language (Material). |
| **Chakra UI** | Medium | Nice, but opinionated tokens + theming system fights our CSS tokens. |
| **Tremor** | Medium (dashboard-focused) | Tailwind-based; full Tailwind adoption contradicts vanilla-CSS rule. |
| **shadcn/ui** | High | Not a library — copy-paste components built on Radix + Tailwind. Brings Tailwind (which we don't want) and an opinion about look. |

**Verdict:** none of these work without discarding the style guide + vanilla CSS contracts. If we wanted to start from scratch, Mantine would probably save most time — but we'd lose the distinctive cockpit feel the style guide explicitly asks for.

## Option D — Utility libraries worth adopting regardless

Tiny, single-purpose helpers that don't affect the visual identity:

- **`clsx`** or **`classnames`** — already used in many thin-wrapper components; confirm.
- **`cmdk`** — for the top-bar search if it becomes a command menu (≥ Phase 6).
- **`@tanstack/react-virtual`** — virtualization for the Jobs list (4,677 rows). Standalone; complements TanStack Table.
- **`date-fns`** or **`dayjs`** — if we don't already have one.

These are not design decisions, just sensible dependencies.

## Recommendation

**Adopt Option B: TanStack Table + Radix Primitives**, with `@tanstack/react-virtual` added if Jobs performance needs it.

Rationale:
- The style guide's "operator cockpit" feel is our responsibility — libraries don't get it right. Headless foundation frees engineers to focus on *that* feel, not on re-implementing focus traps.
- Matches the patterns behind every operator UI we've cited as aspirational (Linear, Shopify admin, Vercel dashboard).
- Fits the existing architecture once we amend the rule to say "no *styled* external UI library." That amendment belongs in the style guide update (Phase 5 sub-issue #238 or the style-guide update in task #6).
- Incremental; cheap to back out per primitive.

**If you reject Radix specifically**, recommend still adopting **TanStack Table** — it truly is a state machine, not a UI library, and the table is the central surface of this app.

## Suggested dependencies and footprint

Assuming Option B, the Phase 3 PR would add:

```json
{
  "@tanstack/react-table": "^8.x",
  "@tanstack/react-virtual": "^3.x",
  "@radix-ui/react-dialog": "^1.x",
  "@radix-ui/react-dropdown-menu": "^2.x",
  "@radix-ui/react-select": "^2.x",
  "@radix-ui/react-tabs": "^1.x",
  "@radix-ui/react-tooltip": "^1.x",
  "@radix-ui/react-popover": "^1.x",
  "@radix-ui/react-toast": "^1.x"
}
```

Total estimated additional gzip: ~50–60 KB. Tree-shakeable.

## Decision needed

Pick one:

- **B1 — full recommendation:** TanStack Table + Radix Primitives + virtual scrolling. Amend `.claude/rules/frontend.md`. → Phase 3 moves faster; better a11y; standard cockpit stack.
- **B2 — partial:** TanStack Table + virtual scrolling *only*, keep rule against Radix. → Table quality high; dialogs/menus/selects still hand-built (medium cost).
- **A — build all:** reject libraries. → Arch rule untouched; Phase 3 grows by ~2 weeks; accept ongoing a11y maintenance cost.

Once you pick, I can adjust the Phase 3 sub-issue (#239) scope accordingly and start generating the design concepts.

---

## Decision (2026-04-19)

**B1 adopted.** Stack: TanStack Table + Radix Primitives + `@tanstack/react-virtual`, styled in **vanilla CSS using existing `index.css` tokens**.

**Visual baseline:** use **shadcn/ui** as the aesthetic reference (compact inputs, subdued palette, restrained shadows, clean proportions) — *but not as a technology dependency.* shadcn requires Tailwind; we keep vanilla CSS. We inspect shadcn's look, replicate it with our token system.

Follow-ups:
- Amend `.claude/rules/frontend.md`: change "no external UI library (no shadcn, Radix, MUI)" → "no **styled** external UI library (no shadcn, MUI, Mantine). Headless libraries (Radix Primitives, TanStack Table) are permitted when wrapped by our own primitives with our own CSS."
- Phase 3 sub-issue #239 updated with the adopted dependencies and the shadcn visual-reference note.
- Design concepts generated against this stack.
