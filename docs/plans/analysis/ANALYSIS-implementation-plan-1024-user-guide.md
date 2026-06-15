# Pre-Implement Analysis — #1024 Screenshot-Driven End-User Platform Guide

**Plan**: `docs/plans/implementation-plan-1024-user-guide.md`
**Date**: 2026-06-12
**Verdict**: ✅ READY — no blockers

---

## Phase A — Artifacts extracted from the plan

The plan proposes exclusively **new additive** work:

| Artifact | Type | Notes |
|---|---|---|
| `docs/user-guide/` | New directory | Confirmed absent (`ls docs/` shows no `user-guide/`) |
| `docs/user-guide/README.md` | New file | Index |
| `docs/user-guide/01-overview.md` | New file | |
| `docs/user-guide/02-connecting-a-platform.md` | New file | |
| `docs/user-guide/03-catalog-and-inventory.md` | New file | |
| `docs/user-guide/04-listings.md` | New file | |
| `docs/user-guide/05-orders.md` | New file | |
| `docs/user-guide/06-diagnostics.md` | New file | |
| `docs/user-guide/07-settings-and-admin.md` | New file | |
| `docs/user-guide/images/*.png` | New screenshots | Referenced by relative path |
| `README.md` | Edit (additive, 1 line) | Cross-link to the guide |
| `docs/getting-started.md` | Edit (additive, 1 line) | Cross-link in "What's next" section |

No ports, services, DI tokens, ORM entities, barrel exports, DTOs, adapters, or capability registrations involved.

---

## Phase B — Reuse audit

| Plan artifact | Exists today? | Finding |
|---|---|---|
| `docs/user-guide/` directory | No — confirmed absent | Plan correctly marks as new |
| `docs/user-guide/images/` | No | Plan correctly marks as new |
| Reusable screenshots (`docs/plans/371-*-light.png`) | Yes — all 4 confirmed present | Plan correctly identifies them as copy/recapture candidates; no reinvention |
| Cross-link in `README.md` | Pattern exists (current embeds) | Additive 1-line insert — safe |
| Cross-link in `docs/getting-started.md` | Pattern exists (`docs/integrations/*/setup-guide.md` links) | Additive insert in "What's next" — safe |

**No reinvention detected.** The plan correctly identifies and reuses existing screenshot assets rather than proposing to recreate them from scratch. No code artifact is invented that already exists.

---

## Phase C — Backward-compatibility checklist

| Surface | Result | Reason |
|---|---|---|
| Top-level barrels `@openlinker/core/<ctx>` | ✅ Not touched | Docs-only |
| Port method signatures | ✅ Not touched | Docs-only |
| DTO shapes | ✅ Not touched | Docs-only |
| Symbol tokens (`*.tokens.ts`) | ✅ Not touched | Docs-only |
| ORM schema / TypeORM entities | ✅ None required | No entity changes |
| `pnpm check:invariants` rules | ✅ Not triggered | No source imports, no service files, no cross-context paths |
| `README.md` | ✅ Safe (additive) | One link line inserted; existing embeds and prose unchanged |
| `docs/getting-started.md` | ✅ Safe (additive) | One link inserted at the bottom of "What's next"; no existing links removed |

**Zero Critical items. Zero Warning items.**

---

## Phase D — Open questions (non-blocking)

1. **Visual System v2 (#775) recapture**: the plan correctly flags that `371-*-light.png` shots may pre-date the signal-orange OKLCH accent introduced in #775. Verify visually before committing screenshots — recapture if the nav/accent color looks materially different from the current live app.

2. **"Integrations" vs "Connections" nav label**: the plan defaults to "Connections" (URL-consistent). Confirm the shipped nav label matches before writing prose that references it by name.

Both are implementation-time checks, not blockers to starting.

---

## Verdict

**READY.**

The plan is purely additive documentation. There are no reuse collisions (no code or doc artifact the plan would reinvent already exists), no contract-surface breaks (no barrel exports, port signatures, tokens, DTOs, or ORM schema touched), and no invariant rules that could fire. The two edits to `README.md` and `docs/getting-started.md` are single-line insertions that cannot break existing links or anchors.

Start with **Phase 1 (scaffold + index)** — it has no dependencies and unblocks all section writing in parallel.
