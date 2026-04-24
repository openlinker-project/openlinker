# Implementation plan — #371 Retire generic blue accent, neutralize dark canvas

## 1. Goal

Make the OpenLinker admin UI pure-monochrome in its primary accent and move the dark-mode canvas off its navy-biased hue onto a graphite-neutral one. Specifically:

- `--accent-primary`, `--accent-primary-hover`, `--accent-primary-soft`, `--accent-primary-border`, `--accent-focus` become monochrome — tied to `--text-primary` in each theme rather than a blue hue.
- `--status-info` splits off from the bootstrap/Tailwind blue it currently shares with `--accent-primary` and becomes a distinct neutral slate in both modes.
- Dark-mode canvas surfaces (`--bg-canvas`, `--bg-shell`, `--bg-surface`, `--bg-surface-elevated`, `--bg-muted`, `--bg-surface-muted`, `--bg-surface-hover`) shift from navy-biased (`#0b1220` family) to graphite-neutral (`#0e1014` family).
- `--text-on-primary` / `--text-inverse` in dark mode shift from the old navy hex to the new graphite hex so text on primary buttons tracks the new canvas.
- `--border-focus` follows `--accent-focus` in both themes (it was already documented as an alias in the light-mode comment; dark mode had a silent mismatch).
- `docs/frontend-ui-style-guide.md` color section is updated so the recommended palette, the "Color Usage Rules" prose, and the dark-mode notes match the new direction.

Status colour tokens (success / warning / error / review / conflict / disabled) are **not** changed — chroma stays reserved for semantic state.

## 2. Classification

- **Type**: Frontend
- **Layer**: Design tokens + style-guide doc
- **Surface area**: pure CSS custom-property values + prose. Zero component refactors, zero TypeScript changes.
- **Scope size**: small, token-only.

## 3. Non-goals

- No component-level restyling or CSS changes beyond the token definitions.
- No changes to typography, spacing, radii, shadows, motion tokens, or the `a` tag style.
- No changes to success / warning / error / review / conflict / disabled tokens.
- No wizard / sidebar / layout work (separate issues: #368 done, #333 still open).
- No updates to historical audit artifacts:
  - `docs/ui-audit/baseline/**` (Lighthouse snapshots — frozen audit output)
  - `docs/ui-audit/concepts/**` (static HTML design explorations — historical)
  - `docs/plans/implementation-plan-ui-concept-adoption.md` (frozen historical plan record)

## 4. Files in scope

| File | Change |
|---|---|
| `apps/web/src/index.css` | Replace the accent, status-info, border-focus, dark-canvas, and dark-text-on-primary token values in the `:root` and `html[data-theme='dark']` blocks. |
| `docs/frontend-ui-style-guide.md` | Update the recommended light-theme token block, add the matching dark-theme block if missing, and rewrite the "Color Usage Rules" bullet about the primary CTA so it reflects the pure-monochrome direction (removing the "demoted blue" framing). |

## 5. Design

### 5.1 Token values

**Light mode (`:root`)**

| Token | Before | After |
|---|---|---|
| `--accent-primary` | `#2f6fed` | `#16202b`  *(= `--text-primary`)* |
| `--accent-primary-hover` | `#245fd1` | `#000000` |
| `--accent-primary-soft` | `#e8f0ff` | `rgba(22, 32, 43, 0.06)` |
| `--accent-primary-border` | `rgba(79, 140, 255, 0.35)` | `rgba(22, 32, 43, 0.18)` |
| `--accent-focus` | `#7ea6ff` | `#16202b` |
| `--border-focus` | `#7ea6ff` | `#16202b`  *(tracks `--accent-focus`)* |
| `--status-info` | `#2b7de9` | `#5a6b85` |
| `--status-info-soft` | `#eaf3ff` | `#eef1f5` |
| `--status-info-border` | `#bfd7fb` | `#c9d0db` |
| `--status-info-fg` | `#2456a5` | `#3e4a60` |
| `--status-info-strong` | `#2456a5` | `#3e4a60` |

**Dark mode (`html[data-theme='dark']`)**

| Token | Before | After |
|---|---|---|
| `--bg-canvas` | `#0b1220` | `#0e1014` |
| `--bg-shell` | `#10192a` | `#131519` |
| `--bg-surface` | `#111c2e` | `#16181d` |
| `--bg-surface-elevated` | `#172338` | `#1b1e24` |
| `--bg-muted` | `#1b2740` | `#1f2229` |
| `--bg-surface-muted` | `#1b2740` | `#1f2229` |
| `--bg-surface-hover` | `#223057` | `#272b33` |
| `--text-on-primary` | `#0b1220` | `#0e1014`  *(tracks new canvas)* |
| `--text-inverse` | `#0b1220` | `#0e1014` |
| `--accent-primary` | `#6c96ff` | `#e9eef5`  *(= `--text-primary`)* |
| `--accent-primary-hover` | `#87a9ff` | `#ffffff` |
| `--accent-primary-soft` | `rgba(108, 150, 255, 0.16)` | `rgba(233, 238, 245, 0.08)` |
| `--accent-primary-border` | `rgba(108, 150, 255, 0.4)` | `rgba(233, 238, 245, 0.24)` |
| `--accent-focus` | `#9cbaff` | `#e9eef5` |
| `--border-focus` | `#7ea6ff` | `#e9eef5`  *(tracks `--accent-focus`)* |
| `--status-info` | `#5b9df0` | `#8a95a8` |
| `--status-info-soft` | `rgba(91, 157, 240, 0.16)` | `rgba(138, 149, 168, 0.14)` |
| `--status-info-border` | `rgba(91, 157, 240, 0.35)` | `rgba(138, 149, 168, 0.32)` |
| `--status-info-fg` | `#a8c9f7` | `#c5cbd6` |
| `--status-info-strong` | `#a8c9f7` | `#c5cbd6` |

### 5.2 What each surface becomes

| Surface | Before | After |
|---|---|---|
| Primary CTA (`.button--primary`) | near-black / near-white (already mono) | unchanged |
| Body link (`a`, uses `--accent-primary-hover`) | blue | near-black in light, near-white in dark |
| Focus rings | soft blue halo | near-black / near-white ring (via `--accent-focus`) |
| `--shadow-focus` halo (3px × `--accent-primary-soft`) | blue-tinted glow | 6–8% mono tint — subtle but visible |
| Selected nav rail / stepper current step | blue fill | `--text-primary` fill |
| "Before you start" info alert | blue-tinted | neutral slate |
| Status badges (success / warning / error / review / conflict / disabled / live dot) | unchanged | unchanged |
| Dark canvas | navy-biased (`#0b1220` family) | graphite-neutral (`#0e1014` family) |

### 5.3 Why the `#0e1014` graphite canvas ramp

The existing dark canvas ramp is a near-linear navy lightening from `#0b1220` → `#223057`. The replacement is a pure-neutral ramp with the same perceptual steps, tuned on the HSL L channel at ~0° hue and ~0% chroma:

- `#0e1014` — canvas (darkest)
- `#131519` — shell
- `#16181d` — surface
- `#1b1e24` — surface-elevated
- `#1f2229` — muted / surface-muted
- `#272b33` — surface-hover (one step up from muted, matches existing "one step darker than muted" relationship)

This keeps the elevation ladder identical in relative terms — no component needs to adjust for bigger/smaller steps.

## 6. Step-by-step implementation

All work happens in two files. Order below is safe to apply sequentially.

### Step 1 — `apps/web/src/index.css` `:root` (light mode)

Edit the accent block (lines 216–220 as of `486fa5c`) to the values from §5.1 (light). Edit the `--border-focus` line (205) to match the new `--accent-focus`. Edit the status-info block (244–248) to the neutral-slate values.

Acceptance: file diff only touches lines 205, 216–220, 244–248. No other tokens move.

### Step 2 — `apps/web/src/index.css` `html[data-theme='dark']` (dark mode)

Edit the canvas block (337–343) to the graphite ramp. Edit the `--border-focus` (349), the `--text-on-primary` / `--text-inverse` pair (356–357), the accent block (360–364), and the status-info block (388–392) to the values from §5.1 (dark).

Acceptance: file diff only touches lines 337–343, 349, 356–357, 360–364, 388–392. No other tokens move.

### Step 3 — `docs/frontend-ui-style-guide.md` color section

Update the recommended token block (currently shown at lines 189–247 under a `:root[data-theme="light"]` selector — note this selector does not match the real-code convention, but is doc-only and pre-existing; leave the selector alone, edit only the values).

Changes:

- Replace the `--accent-*` values and `--status-info*` values with the light-mode values from §5.1.
- Add a short dark-theme token block below the light one (or extend the existing "Dark Mode" section just below) with the new graphite ramp + mono accent values — the doc currently describes dark mode only in prose; this issue is the right time to land the actual values so the guide reflects reality.
- Rewrite the second bullet of "Color Usage Rules" (line 253–257). Old: "the primary CTA is near-black … Demoted blue (`var(--accent-primary)`) is reserved for links, focus rings, and the active-nav inset indicator only". New: the UI is **fully monochrome** — `--accent-primary` is itself an alias of `--text-primary`, so links, focus rings, and the active-nav inset indicator all read as page foreground in both themes.
- Update the "Dark Mode > Color" subsection (lines 279–298) to note that dark canvas is **graphite-neutral** (not navy) and `--status-info` is a **neutral slate** (not a second blue).

Acceptance: the doc reads as a description of the code as it stands after Step 2, not a description of the previous palette.

### Step 4 — Visual QA sweep

Start the dev stack + web app:

```bash
pnpm dev:stack:up           # only if Postgres/Redis not already running
pnpm start:dev:api          # separate shell
pnpm start:dev:web          # :5173
```

Walk the following routes in **both** light and dark:

- `/` Dashboard
- `/connections` (list)
- `/connections/new` (wizard — steps 1 → 4)
- `/orders`
- `/products`
- `/inventory`
- `/customers`
- `/listings`
- `/settings`
- `/login` (log out to reach it)

At each page, eyeball:

- focus ring visible when tabbing through interactive controls (buttons, inputs, selects, nav items, tabs)
- primary CTAs remain monochrome filled (no regression to blue)
- any "info" alert reads as neutral slate, not as a second primary
- body links read as page foreground with a visible underline
- dark canvas reads as neutral graphite, not navy

Capture screenshots for at least: Dashboard, Connections list, Connection wizard, Login — light + dark — for the PR description.

### Step 5 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

No failures expected — this is token-only and no test asserts exact hex values.

## 7. Validation

- **Architecture compliance**: pure CSS custom-property change in an existing file + a doc edit. No layer crossings introduced.
- **No hardcoded secrets, no `any`, no `console.log`**: N/A (no TS code changes).
- **Naming conventions**: token names are unchanged — only values move.
- **Testing strategy**: Jest / Vitest unit tests do not assert CSS values, so no new tests are required. Visual QA + style-guide doc is the verification surface per the issue's acceptance criteria.
- **Security**: N/A.
- **Migrations**: N/A.

## 8. Risks & open questions

- **Focus-ring contrast**: a near-black ring on a white surface is AA-visible (near-max contrast), and a near-white ring on the graphite canvas is also AA-visible. Narrow rings against the `--bg-surface-elevated` variants were the concern pre-change; post-change contrast improves in most cases. Verified during the visual sweep, not automated.
- **Links become monochrome**: per issue intent. If user feedback later wants a chromatic link, reopen — not in scope here.
- **`--shadow-focus` tint**: the 3px halo around focused buttons now sits at 6–8% mono alpha instead of a blue tint. Still visible against all surfaces but slightly quieter. Accepted as a side effect of the token refactor; revisit only if the sweep flags it.
- **Out-of-scope duplicates**: the Lighthouse JSON snapshots and `docs/ui-audit/concepts/**` static HTML reference the old hexes. These are historical artifacts and not part of the live UI or style guide. Left untouched on purpose.

## 9. Acceptance checklist (from the issue)

- [ ] `--accent-primary` in both themes resolves to a monochrome value tied to `--text-primary`.
- [ ] `--status-info` is a distinct neutral-slate hue in both themes; no longer conflated with `--accent-primary`.
- [ ] Dark-mode canvas tokens shift from navy-biased to graphite-neutral.
- [ ] All status colors (success/warning/error/review/conflict/disabled) are unchanged.
- [ ] Focus rings remain AA-visible against all background surfaces in both modes.
- [ ] `docs/frontend-ui-style-guide.md` color section updated.
- [ ] Visual regression screenshots attached for Dashboard, Connections list, Connection wizard, Login — light + dark.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` pass.
