# OMS Wave 2 — operator experience mockups

Design exploration for the four Wave-2 surfaces described in
[`docs/specs/product-spec-oms-wave2-operator-experience.md`](../../../specs/product-spec-oms-wave2-operator-experience.md)
(S1 who-decides, S2 authority status, S3 automation v1).

Live, interactive versions — **the canonical copy**:
<https://claude.ai/design/p/9811a593-63ff-4c9d-95bc-e80fe2651c8d>

| Surface | Route | Template | Screenshot |
|---|---|---|---|
| S1 + S2 — arrangement presets, decision table, needs-attention | `/settings/who-decides` | [`WhoDecides.dc.html`](./WhoDecides.dc.html) | [png](./screenshots/who-decides.png) |
| S3 — automation rules index | `/automations` | [`Automations.dc.html`](./Automations.dc.html) | [png](./screenshots/automations.png) |
| S3 — rule composer | modal, from `Configure` | [`AutomationComposer.dc.html`](./AutomationComposer.dc.html) | [png](./screenshots/automation-composer.png) |
| S3 — global run log | `/automations/activity` | [`RunLog.dc.html`](./RunLog.dc.html) | [png](./screenshots/run-log.png) |

## ⚠️ These do not open in a browser

Unlike every other file in `docs/plans/mockups/`, these are **not** standalone pages. They are
`.dc.html` templates that compose the **real** `apps/web/src/shared/ui` components at runtime via
`window.OpenLinkerUI.*`, and they need three files that are deliberately not committed here:
`support.js`, `ds-base.js`, and the compiled `_ds_bundle.js` (a multi-MB React bundle).

Read them as **source**, view them via the **live project** link above, or look at the screenshots.

The upside of the trade: these compose the actual components and read the actual tokens, so the
layouts are true by construction. The existing hand-authored mockups in this folder re-declare
approximations of the design tokens inline, which can and does drift from `apps/web/src/index.css`.

## Provenance and drift

Produced by prompting the design agent at claude.ai/design against the **OpenLinker UI** design
system, which is [`/design-sync`](../../../../.design-sync/)'s export of `apps/web/src/shared/ui`
(45 components) — see #2303.

**The design project is the source of truth; these files are a point-in-time copy.** Editing them
here does not change the design, and re-running the design agent does not update them. Re-export by
reading `templates/*/[Name].dc.html` from the project.

Operator-facing copy is taken **verbatim** from the product spec (§3.2 page furniture and preset
cards, §3.3 the seven decision rows and the closed badge vocabulary, §4.2 inert states, §5.1
first-run card, §5.5 composer skeleton including the AND footer sentence, §5.6 run-log columns and
the closed outcome vocabulary). Where the spec is silent — supporting labels such as the composer's
per-step parameters (`Carrier`, `Pay from`, `Status to send`, `Include tracking number`), the filter
chips, and the sample data — the values are invented for the mockup and carry no authority.

## Known gaps, and what they revealed

Building these surfaced three defects in the real component library, each filed separately:

- **#2435** — `FormField` calls `React.Children.only`, so a labelled field cannot hold a composed
  control. The composer's per-step parameter fields therefore reproduce `.form-field` markup by hand
  instead of using the component, which also drops the `aria-invalid` / `aria-describedby` wiring.
  This is why `AutomationComposer.dc.html` contains mis-nested `<x-import>`/`</div>` markup around
  those fields — copied verbatim from the project rather than tidied, so the two do not diverge.
- **#2436** — two `apps/web/src/index.css` defects (unclassifiable `--duration-*` / `--ease-*`
  tokens; a custom property declared under `.form-field-row--cols-3` instead of `:root`).
- **#2299** — the catalog's `Dialog` re-exports only the bare Radix root, so every sub-part carrying
  the dialog CSS is unreachable. The composer's modal surface is hand-built for that reason.

## Overlap to resolve

PR #2318 adds `docs/plans/mockups/mockup-who-decides-what.html`, a standalone hand-authored mockup of
the same S1 surface. It is not on `main` yet, so there is no conflict — but once both land there are
two mockups of one screen. `WhoDecides.dc.html` additionally covers S2 (`Needs attention`) and the
full seven-row table with real tokens; the standalone one opens offline. Worth picking one.
