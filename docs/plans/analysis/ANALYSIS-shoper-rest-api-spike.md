# Pre-implement gate: Shoper REST API Spike (#3638)

**Plan**: `docs/plans/implementation-plan-shoper-rest-api-spike.md`
**Issue**: #3638

## Verdict: READY

## Why the reuse audit and backward-compat checklist are vacuous here, not skipped

The plan's own "Implementation Details" section is explicit that this issue produces **zero code
artifacts**: no port, no service, no DI token, no ORM entity, no controller, no DTO, no event, no
migration. Its single deliverable is one new markdown file,
`docs/plans/analysis/SPIKE-3638-shoper-rest-api.md`.

The reuse audit (Phase B) exists to catch a plan that *assumes* something is new when it already
exists in `libs/core/src/**/domain/ports/**`, `libs/**/application/services/**`,
`libs/core/src/**/*.tokens.ts`, or `**/*.orm-entity.ts`. With no artifact of any of those kinds
proposed, there is nothing for that audit to fan out `Explore` agents against — running them would
search for zero named things and report "not applicable" for each, which is what this section
states directly instead. This is a judgment call the gate's own instructions permit implicitly
(Phase B classifies *each plan artifact*; an empty artifact list classifies to an empty table), not
a shortcut around the gate's intent.

The backward-compatibility checklist (Phase C) is likewise vacuous: nothing is changed. No barrel
export, port signature, DTO shape, Symbol token, or ORM schema is touched by writing a new file
under `docs/plans/analysis/`.

## Reuse findings

| Plan artifact | Classification | Note |
|---|---|---|
| — (none proposed) | N/A | The plan proposes one new markdown file and no code. |

## Backward-compat findings

| Surface | Checked | Result |
|---|---|---|
| Top-level barrels (`@openlinker/core/<ctx>`) | Yes | Not touched — no code change. |
| Port method signatures | Yes | Not touched. |
| DTO shapes | Yes | Not touched. |
| Symbol tokens (`*.tokens.ts`) | Yes | Not touched. |
| ORM schema | Yes | Not touched — no migration implied. |
| `check:invariants` rules | Checked against the file's own location | `docs/plans/analysis/*.md` is not a scanned path for `check-cross-context-imports`, `check-service-interfaces`, deep-barrel-import rules, or the repo-URL guard — all of those walk `libs/**`, `apps/**`, and TypeScript source. A new markdown file under `docs/plans/analysis/` trips none of them. |

No Critical or Warning items.

## Open questions

None that block implementation of this specific issue. The plan itself correctly defers two real
open questions (the `x-webhook-sha1` signing algorithm; the real sustained rate-limit ceiling) to
the SPIKE doc's own "open items" section and to the Webhook Reconciliation mini-epic (#3644) —
those are findings to *report*, not blockers to *this* gate, since resolving them is explicitly out
of this issue's scope per the plan's "Out of Scope" section.

One forward-looking note for whoever later gates the six mini-epic issues this spike feeds
(#3639-#3644): those WILL propose real code artifacts (a new `libs/integrations/shoper/` package,
new adapter classes, and — for #3642 (OrderProcessorManager) specifically — a new per-order
idempotency lock explicitly modeled on the existing `#2047` invoicing guard). Phase B's reuse audit
will be load-bearing there in a way it structurally cannot be here, and should confirm at that time
whether `SyncLockPort`, the `identifier_mappings` check shape, and the `#2047` guard's exact
implementation are reusable as-is or need extension for the orders-idempotency case.
