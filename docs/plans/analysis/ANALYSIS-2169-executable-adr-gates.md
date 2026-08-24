# Pre-implementation Analysis — #2169 executable ADR gates

**Plan**: `docs/plans/implementation-plan-2169-executable-adr-gates.md`
**Gate run**: 2026-08-21 (deep pass, worktree at `627b567e8`)
**Verdict**: **READY**

Scripts-only + one docs-marker touch: no port, service, DI token, ORM entity, DTO, or barrel is
created or changed. The audit therefore concentrated on (a) name/overlap collisions with the 15
existing invariant scripts, and (b) — the substantive risk — empirical verification of the plan's
two detection rules against the live tree, since a checker whose heuristic is wrong on day one is
worse than prose.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `scripts/check-architecture-gates.mjs` | NEW (confirmed absent) | zero matches in `scripts/`; the name is the one #2169 specifies |
| Overlap with existing checks | NONE | `check-repo-urls.mjs` is the only script walking `docs/` (URL rule only); no script scans ADR content or counts config helpers |
| ADR-049 markers | PARTIAL (edit existing `Proposed` ADR) | 10 unmarked inline `*Reversal gate:*` occurrences (lines 45–151); 048 block-form pre-classified; 050/051 already marked |
| `check:invariants` chain entry | PARTIAL (edit `package.json:29`) | established `--self-check && run` pattern, 15 precedents |

## Detection-rule verification (deep pass)

**Config-knob discovery.** The breadcrumb alone (`Connection.config` literal in
`libs/core/src/**/domain/types/*.types.ts`) matches **six** files — the four knobs **plus two
non-knobs**:

- `identifier-mapping/domain/types/connection.types.ts` — defines `ConnectionConfig` itself;
  exports no `read*`/`parse*` function → excluded by the plan's conjunction.
- `listings/domain/types/resolve-concurrency.types.ts` (merged yesterday, #2238) — mentions
  `Connection.config.rateLimit.maxConcurrent` in a doc comment only; exports **no** function →
  excluded by the conjunction.

So the conjunction (breadcrumb **AND** exported `read[A-Z]…`/`parse[A-Z]…`) is **required, not
optional** — breadcrumb-only discovery would false-positive two files immediately. With it, the
match set is exactly the four registry entries; **threshold ≥ 5 passes today with zero margin
tricks**.

**A near-miss worth writing into the script header**: `config.rateLimit` looks like a fifth knob
but is not one — it is a **typed field** (`ConnectionRateLimit` on `ConnectionConfig`,
`connection.types.ts:118`) consumed as `connection.config.rateLimit ?? metadata.defaultRateLimit`
(`adapter.types.ts:137`), i.e. a structured schema field, not an untrusted-JSONB coercion of the
`parseTriggerModel` pattern. The gate counts the *pattern*, not every config key — state this in
the header or a future reader will "correct" the count.

**Gate-marker regex.** The inline form terminates `:\*` (`*Reversal gate (countable):*`,
`*Reversal gate:*`); ADR-048's block heading `**Reversal gates** (marked for #2169):` does **not**
terminate `:*`, so a regex anchored on the `:\*` suffix cannot false-positive it. Verified: only
ADRs 048–051 mention "Reversal gate" at all; 049 is the only file with unmarked inline
occurrences. Scope the scan to `docs/architecture/adrs/` (plan already does) — the merged
implementation-plan documents under `docs/plans/` quote the lexical form and must stay out of
scope.

**Ladder rungs.** `libs/core/src/products/domain/ports/capabilities/` exists with exactly one file
(`modified-product-lister.capability.ts` — the ADR-048 rung); count-with-classify-list is sound.

## Backward-compatibility findings

- No Critical: no contract surface touched.
- Warning-level, both clear: `check-repo-urls.mjs` (markers add no URLs); the new script joins a
  `&&` chain, so its own failure semantics must be exit-code-1-with-report like its siblings
  (plan follows the house pattern).
- ADR edit policy: 049 is `Proposed`; the markers are the classification #2169's dependency line
  itself mandates. No accepted-ADR body is touched.

## Open questions (non-blocking)

1. The plan's `NON_KNOBS` exclusion list is not needed for today's tree (the conjunction already
   excludes both non-knobs) — keep the mechanism, seed it empty, and let the failure message offer
   it as the deliberate escape hatch.
2. Self-check must include the two real-world near-misses found here as fixtures (a
   breadcrumb-only file must NOT count; the 048 block heading must NOT trip the inline rule) —
   they are the regressions most likely to recur.

## Verdict rationale

No Critical, no reuse collision, both detection rules verified against the live tree with their
edge cases enumerated. **READY.**
