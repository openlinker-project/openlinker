# Implementation Plan — #2169: make the ADR reversal gates executable in `check:invariants`

**Issue**: #2169 (Wave 1 tail of epic #2162)
**Branch**: `2169-executable-adr-gates`
**Layer**: DX (`scripts/`, root `package.json`) + one docs touch (ADR-049 gate markers)

---

## 1. Understand the task

The four async-work-layer ADRs (renumbered **048–051** per the #2169 comment; script messages must
use the new numbers) are mostly decisions *not* to build something, each with a reversal gate. A
gate that lives only in prose is never checked. This task adds `scripts/check-architecture-gates.mjs`
to `check:invariants` so the mechanically-countable gates fail `pnpm lint` with a message naming the
ADR, the threshold, and the decision to revisit.

**Non-goals** (documented in the script header as named follow-ups, per the issue's
"not countable — mark as prose-only" instruction):
- Subscribers-per-fact-type (ADR-049 D2) — countable only once the ADR-049 D7 registration-time
  catalog exists; nothing to count today.
- Structural unbounded-enqueue detection (ADR-048 countable gate 1) — needs its own detection
  design; the allow-list-minimum variant is deferred with it.
- Lane/role coverage (ADR-050 D1, ADR-051 D6) — blocked on Waves 3/4 (#2278/#2279) creating the
  registries to count; those issues already carry the static-check handoff.
- Any behaviour change; retrofitting checks for pre-048 ADRs (explicitly out of scope in #2169).

## 2. Research findings (verified in worktree at `627b567e8`)

- **Gate formats in the wild**: ADR-050/051 use the inline lexical form
  `*Reversal gate (countable):*` / `*Reversal gate (prose-only):*` (written for this script).
  ADR-048 uses a **block** form: a `**Reversal gates** (marked for #2169):` section with
  `- *Countable*:` / `- *Prose-only*:` bullets — already classified, different lexeme.
  ADR-049 has **10 inline `*Reversal gate:*` occurrences, none marked** (lines 45, 51, 57, 62,
  67, 73, 79, 88, 95, 151).
- **Config-knob helpers** (the issue's first countable gate): four knobs today —
  `parseTriggerModel` (`libs/core/src/invoicing/domain/types/invoice-trigger.types.ts`),
  `parseIsPrimaryInvoicing` (`.../invoicing-primary.types.ts`),
  `readStockSafetyBuffer` (`libs/core/src/identifier-mapping/domain/types/stock-safety-buffer.types.ts`),
  `readPricingRule` (`.../pricing-rule.types.ts`). All four files carry the literal
  `Connection.config` in their header/docs — a usable discovery breadcrumb — and export
  `read*`/`parse*` functions. The issue's own framing sets the threshold: *"someone adds a **fifth**
  per-connection config knob without knowing they crossed the threshold"* → fail at ≥ 5.
  The decision the message names: the **#1032 rules/automation-engine cut** (epic #2162
  Out-of-scope: "Rules/automation engine (cut by #1032 with a named gate)").
- **Ladder rungs** (ADR-048 countable gate 2): `libs/core/src/products/domain/ports/capabilities/`
  holds exactly one rung today (`ModifiedProductLister`); "a third rung appearing" is the ADR's
  stated revisit signal — trivially countable as files in that directory, with a classify-list so
  a future non-rung capability there doesn't false-positive.
- **Script house style** (`check-stream-writes.mjs` as the exemplar): header explaining why the
  type/prose rule alone is insufficient, `--self-check` mode with synthetic cases, allow-lists as
  deliberate reviewed edits, failure output = file + rule + exact fix, chained into
  `package.json` `check:invariants` as `--self-check && run` (the precedent
  `check-migration-timestamps.mjs` prints the exact fix — the issue names it as the message bar).

## 3. Design

### `scripts/check-architecture-gates.mjs` — three rules

1. **`gate-markers`** — every inline `*Reversal gate…:*` occurrence in
   `docs/architecture/adrs/NNN-*.md` with `NNN >= 048` must match
   `\*Reversal gate \((countable|prose-only)\):\*`. ADR-048's block form passes by construction
   (its bullets are `- *Countable*:` / `- *Prose-only*:`, not inline `*Reversal gate:*` lines) —
   both formats are documented in the script header as accepted. Failure names the ADR file, the
   line, and the exact two accepted spellings. This is what closes the #2169 acceptance criterion
   "every gate marked countable or prose-only" *going forward*, not just for today's four files.
2. **`config-knobs`** — the countable gate from the issue. Two halves:
   - **Registry** (`KNOWN_CONFIG_KNOBS`: file path + exported helper names, seeded with the four
     above). A registry entry whose file/exports no longer exist → stale-registry failure.
   - **Discovery**: scan `libs/core/src/**/domain/types/*.types.ts` for files that contain the
     literal `Connection.config` **and** export a `read[A-Z]…`/`parse[A-Z]…` function; a hit not in
     the registry (or in `NON_KNOBS`, the deliberate-exclusion list for e.g.
     `connection.types.ts` if it matches) fails with "register or exclude — deliberately".
   - **Threshold**: registry size ≥ 5 fails:
     `5 per-connection config knobs — the #1032 rules-engine cut said to reconsider a shared`
     `per-connection rules model at this point (see #2169 / epic #2162). Either consolidate, or`
     `raise KNOB_THRESHOLD in the same reviewed change with a rationale.`
3. **`ladder-rungs`** — count files in `libs/core/src/products/domain/ports/capabilities/`
   classified as rungs (`KNOWN_RUNGS`, seeded with `modified-product-lister.capability.ts`) or
   deliberately excluded (`NON_RUNGS`, seeded empty — the same two-list shape as rule 2, so a
   legitimate non-rung capability has somewhere to be recorded); an unclassified file fails with
   "classify: add to KNOWN_RUNGS or NON_RUNGS"; rung count ≥ 3 fails naming ADR-048's gate
   ("a third rung is the signal to revisit a single negotiated capability").

`--self-check`: pure functions (`checkGateMarkers(text)`, `countKnobs(entries)`, …) exercised
against synthetic in-memory fixtures — a marked gate passes, an unmarked gate fails, a fifth knob
trips the threshold, an unclassified capability file fails — satisfying the AC "fails the build on
a synthetic violation".

### ADR-049 gate markers (docs edit)

Add `(countable)` / `(prose-only)` to the 10 inline gates. ADR-049 is `Proposed`, and the marking
is the classification #2169's own dependency line demands ("each must mark every gate") — a
metadata annotation, not a decision change; the append-only rule guards *accepted* ADR bodies.
Classification:

| Gate (line) | Marker | Why |
|---|---|---|
| D1 write amplification (45) | prose-only | p99-latency judgment, needs metrics that don't exist |
| D2 second independent consumer (51) | countable | countable from the D7 registration catalog once it exists — named follow-up in the script header |
| D3 not-applicable (57) | prose-only | explicitly n/a while D2 holds |
| D4 unstable natural key (62) | prose-only | discovered at design time, not scannable |
| D5 none (67) | prose-only | follows from an existing decision |
| D6 inexpressible field (73) | prose-only | a consumer request, not a code shape |
| D7 events gains compile-time producer deps (79) | countable | countable by grepping `libs/core/src/events/**` for `@openlinker/core/{orders,products,listings,invoicing,…}` imports (note: `check-cross-context-imports.mjs` constrains *how* such an import looks, not *whether* it exists — it would pass an `I*Service` import cleanly); named in the script header as a cheap future rule, not implemented now |
| D8 Valkey closed + newer primitive (88) | prose-only | issue-state plus judgment |
| D9 Redis sole record of a fact (95) | prose-only | "sole record" is semantic; `check-stream-writes.mjs` guards the adjacent mechanical half |
| Known-gap poison entry (151) | prose-only | production observation or Wave 5 (#2280) |

### `package.json`

Append `&& node scripts/check-architecture-gates.mjs --self-check && node scripts/check-architecture-gates.mjs`
to `check:invariants`.

## 4. Steps

1. `docs/architecture/adrs/049-durability-spine-and-domain-event-contract.md` — add the 10 markers
   per the table (no other text changes).
2. `scripts/check-architecture-gates.mjs` — new script per §3. The header MUST document
   (acceptance-level, per the pre-implement analysis): the two accepted gate formats; the three
   implemented rules; the named deferred gates and what unblocks each (D2 subscriber count →
   ADR-049 D7 catalog; D7 events-imports grep; ADR-048 enqueue-ceiling detection; lane/role
   coverage → #2278/#2279); that knob discovery is the **conjunction** of the `Connection.config`
   breadcrumb AND an exported `read*`/`parse*` function (breadcrumb alone matches two non-knobs
   today); and the `config.rateLimit` **near-miss** — a typed `ConnectionRateLimit` field consumed
   with a `??` fallback, not an untrusted-JSONB coercion knob, so it must never be "corrected"
   into the count. Rule 1's ≥048 floor is a named constant
   (`MARKER_CONVENTION_STARTS_AT = 48`) with a comment citing #2169's no-retrofit scope.
3. `package.json` — chain into `check:invariants`.
4. Quality gate: `pnpm lint` (now includes the new script — proves rule 1 passes on the real
   ADRs), `pnpm type-check`, `pnpm test`; plus a manual synthetic-violation run documented in the
   PR (temporarily unmark one gate → script fails → revert), on top of `--self-check`.

## 5. Validation

- **Architecture**: scripts-only + docs markers; no runtime, no boundary risk. Script follows the
  documented `check:invariants` mechanism (issue lists the six precedents).
- **Naming**: `check-architecture-gates.mjs` — the exact name the issue specifies.
- **Testing**: `--self-check` synthetic cases (the established pattern for these scripts — they are
  not covered by Jest; `check-stream-writes` etc. do the same).
- **AC mapping**: gates marked (ADR-048 block ✓ pre-existing, 049 this PR, 050/051 ✓ merged) →
  AC 1; config-knob gate enforced → AC 2; messages name ADR + threshold + decision → AC 3;
  synthetic violation covered by self-check → AC 4.
- **Risk**: discovery-heuristic false positives/negatives — mitigated by the registry +
  `NON_KNOBS` deliberate-edit design (a miss surfaces at the next reviewed knob PR rather than
  silently, which is the same posture `check-stream-writes` takes); threshold hard-fails rather
  than warns because `check:invariants` has no warn tier and the issue's premise is that unchecked
  gates rot.
