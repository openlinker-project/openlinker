#!/usr/bin/env node
/**
 * check-architecture-gates
 *
 * The async-work-layer ADRs (048-051, epic #2162) are mostly decisions NOT to
 * build something, each carrying a named reversal gate: "build it when X is
 * observed". A gate that lives only in prose is never checked — the standard
 * failure mode of an architecture document. This script (#2169) makes the
 * mechanically-countable gates executable, so crossing one fails `pnpm lint`
 * with a message naming the ADR, the threshold, and the decision to revisit.
 *
 * Three rules:
 *
 *   - `gate-markers`  — every inline reversal gate in ADR-048+ must be
 *     classified `(countable)` or `(prose-only)`. Two formats are accepted:
 *       inline:  `*Reversal gate (countable):* …`   (ADR-049/050/051)
 *       block:   a `**Reversal gates**` section whose bullets are
 *                `- *Countable*:` / `- *Prose-only*:` (ADR-048) — the block
 *                heading is recognised and skipped; its bullets are already
 *                classified by construction.
 *     ADRs below 048 predate the convention and are deliberately NOT
 *     retrofitted (#2169 scope) — see MARKER_CONVENTION_STARTS_AT.
 *
 *   - `config-knobs`  — the per-connection config-coercion helper count
 *     (the `parseTriggerModel` pattern: an untrusted `Connection.config`
 *     value coerced by a pure `read*`/`parse*` helper in a domain
 *     `*.types.ts`). Four exist today. At the FIFTH, the #1032
 *     rules/automation-engine cut said to reconsider a shared per-connection
 *     rules model (epic #2162 § Out of scope) — so the threshold fails the
 *     build with that message. Discovery is the CONJUNCTION of the
 *     `Connection.config` breadcrumb AND an exported `read*`/`parse*`
 *     helper (function or arrow const): the breadcrumb alone matches two non-knobs
 *     (`connection.types.ts` defines the config type; `resolve-concurrency.types.ts`
 *     mentions a key in a doc comment). Do NOT "correct" the count with
 *     `config.rateLimit`: it is a typed `ConnectionRateLimit` field consumed
 *     as `connection.config.rateLimit ?? metadata.defaultRateLimit` — a
 *     structured schema field, not an untrusted-JSONB coercion knob. The gate
 *     counts the PATTERN, not every config key.
 *
 *   - `ladder-rungs`  — the master capability ladder (ADR-048): rung
 *     sub-capabilities under `libs/core/src/products/domain/ports/capabilities/`.
 *     One exists today (`ModifiedProductLister`). ADR-048's countable gate:
 *     "a third rung appearing is the signal to revisit whether the ladder
 *     should be a single negotiated capability instead."
 *
 * Deferred gates, named so they are found here first (each `(countable)`
 * marker without a rule below is one of these):
 *   - ADR-049 D2 (second independent consumer per stream) — countable only
 *     once the ADR-049 D7 registration-time event catalog exists; there is no
 *     subscriber registry to count today.
 *   - ADR-049 D7 (`events` gains compile-time producer deps) — countable by
 *     grepping `libs/core/src/events/**` for `@openlinker/core/{orders,products,
 *     listings,invoicing,…}` imports. Note `check-cross-context-imports.mjs`
 *     does NOT cover this: it constrains how a cross-context import looks,
 *     not whether events imports a producing context at all.
 *   - ADR-048 (enqueue site without a declared budget/ceiling) — needs its
 *     own structural-detection design.
 *   - ADR-050 D1 (lane assignment) — still blocked on Wave 3 (#2278) creating
 *     the registry to count.
 *   - ADR-051 D6 (role coverage) — the RUNTIME half already ships as
 *     `SyncJobHandlerRegistry.assertFullLaneCoverage()` (#2278), which #2279's
 *     role vocabulary (`apps/worker/src/roles/worker-role.types.ts`) reuses
 *     rather than duplicating. What is missing HERE is the STATIC half —
 *     mapping every registered jobType to a role without booting — which a
 *     single process cannot assert about a fleet. Owned by #2169.
 *
 * Run from `pnpm lint` via `pnpm check:invariants`.
 *
 * Usage:
 *   node scripts/check-architecture-gates.mjs
 *   node scripts/check-architecture-gates.mjs --self-check
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const ADR_DIR = 'docs/architecture/adrs';
const CORE_SRC = 'libs/core/src';
const RUNG_DIR = 'libs/core/src/products/domain/ports/capabilities';

/**
 * ADRs numbered below this do not carry gate markers — the convention starts
 * with the #2162 epic's ADRs, and #2169 explicitly scopes out retrofitting
 * checks for pre-existing ADRs.
 */
const MARKER_CONVENTION_STARTS_AT = 48;

/**
 * The registered config-coercion knobs (the `parseTriggerModel` pattern).
 * Adding an entry is a deliberate, reviewed decision — and the fifth entry
 * trips KNOB_THRESHOLD below, which is the point.
 */
const KNOWN_CONFIG_KNOBS = new Map([
  [
    'libs/core/src/invoicing/domain/types/invoice-trigger.types.ts',
    { helper: 'parseTriggerModel', key: 'config.invoicing.triggerModel' },
  ],
  [
    'libs/core/src/identifier-mapping/domain/types/stock-safety-buffer.types.ts',
    { helper: 'readStockSafetyBuffer', key: 'config.stockSafetyBuffer' },
  ],
  [
    'libs/core/src/identifier-mapping/domain/types/pricing-rule.types.ts',
    { helper: 'readPricingRule', key: 'config.pricingRule' },
  ],
  [
    'libs/core/src/sales-documents/domain/types/sales-document-kind.types.ts',
    {
      helper: 'readSalesDocumentRouting',
      key: 'config.invoicing.isPrimary + config.salesDocument.documentKind',
    },
  ],
]);

/**
 * Files that match the discovery conjunction but are deliberately NOT knobs.
 * An entry here must say why it is not a knob.
 */
const NON_KNOBS = new Map([
  [
    'libs/core/src/invoicing/domain/types/invoicing-primary.types.ts',
    // SUPERSEDED, not a second knob. #2161 (ADR-041 decision 4) moved the live
    // read of `config.invoicing.isPrimary` into `readSalesDocumentRouting`,
    // registered above — its own docblock says it reads "the EXACT shape #2047
    // already writes (decision 4 fixes that shape, it does not introduce a
    // second one)". `parseIsPrimaryInvoicing` has no production caller left
    // (only its definition and the `@openlinker/core/invoicing` barrel
    // re-export), so counting it would report five knobs where four keys are
    // actually coerced, and would trip KNOB_THRESHOLD on a helper nothing
    // calls. Deleting it — and `selectPrimaryInvoicingConnection` beside it,
    // likewise superseded by `resolveSalesDocumentRouting` — is a public-barrel
    // change that belongs in its own reviewed PR, tracked separately.
    'superseded by readSalesDocumentRouting (#2161); dead export pending removal',
  ],
]);

/**
 * At the fifth knob, the shared-rules-model conversation the #1032 cut named
 * is due. Raising this constant is allowed — in the same reviewed change,
 * with a rationale, which is exactly the deliberate revisit the gate exists
 * to force.
 */
const KNOB_THRESHOLD = 5;

/** Ladder rungs (ADR-048): sub-capabilities that declare master freshness. */
const KNOWN_RUNGS = new Set(['modified-product-lister.capability.ts']);

/**
 * Capability files under RUNG_DIR that are deliberately NOT ladder rungs.
 * A products sub-capability that is not a freshness rung is recorded here so
 * the rung count stays honest.
 *
 * `product-tax-rate-reader.capability.ts` (#2054, ADR-063) reports the tax rate
 * a product carries, not when the master last changed it, so it says nothing
 * about freshness and must not count toward ADR-048's third-rung gate.
 */
const NON_RUNGS = new Set(['product-tax-rate-reader.capability.ts']);

/** ADR-048: "a third rung appearing is the signal to revisit the ladder." */
const RUNG_THRESHOLD = 3;

/* ------------------------------------------------------------------ */
/* Rule 1 — gate markers                                               */
/* ------------------------------------------------------------------ */

/**
 * Find unmarked inline reversal gates in one ADR's text.
 *
 * Inline gates may wrap across a line break between "gate" and the marker
 * (ADR-050 decision 5 does), so each occurrence is checked against a
 * whitespace-normalised window rather than a single line. The ADR-048 block
 * heading (`**Reversal gates**`) is recognised by its plural + `**` suffix
 * and skipped — its bullets are pre-classified `- *Countable*:` /
 * `- *Prose-only*:` by construction.
 *
 * Returns the character offsets of violating occurrences.
 */
export function findUnmarkedInlineGates(text) {
  const violations = [];
  const occurrence = /\*Reversal gate/g;
  let match;
  while ((match = occurrence.exec(text)) !== null) {
    const rest = text.slice(match.index);
    if (rest.startsWith('*Reversal gates**')) {
      continue; // ADR-048 block-form heading — bullets are pre-classified.
    }
    const window = rest.slice(0, 160).replace(/\s+/g, ' ');
    if (!/^\*Reversal gate \((countable|prose-only)\)/.test(window)) {
      violations.push(match.index);
    }
  }
  return violations;
}

function lineOfOffset(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function checkGateMarkers() {
  const failures = [];
  const adrDirAbs = join(REPO_ROOT, ADR_DIR);
  for (const name of readdirSync(adrDirAbs)) {
    const numberMatch = /^(\d{3})-.*\.md$/.exec(name);
    if (!numberMatch) continue;
    if (Number(numberMatch[1]) < MARKER_CONVENTION_STARTS_AT) continue;
    const rel = `${ADR_DIR}/${name}`;
    const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
    for (const offset of findUnmarkedInlineGates(text)) {
      failures.push(
        `${rel}:${lineOfOffset(text, offset)} — unmarked reversal gate. Every gate in ADR-048+ ` +
          `must be classified for #2169: write it as \`*Reversal gate (countable):*\` or ` +
          `\`*Reversal gate (prose-only):*\`.`
      );
    }
  }
  return failures;
}

/* ------------------------------------------------------------------ */
/* Rule 2 — config knobs                                               */
/* ------------------------------------------------------------------ */

/**
 * A domain `*.types.ts` file is a knob CANDIDATE iff it carries the
 * `Connection.config` breadcrumb AND exports a `read*`/`parse*` coercion
 * function. Both halves are required: the breadcrumb alone also matches the
 * file that merely defines `ConnectionConfig` and a file that mentions a
 * config key in a doc comment.
 */
export function isKnobCandidate(text) {
  return (
    text.includes('Connection.config') &&
    /export (?:function|const) (?:read|parse)[A-Z]\w*/.test(text)
  );
}

function* walkTypesFiles(dirAbs) {
  for (const entry of readdirSync(dirAbs)) {
    const abs = join(dirAbs, entry);
    if (statSync(abs).isDirectory()) {
      yield* walkTypesFiles(abs);
    } else if (abs.includes('/domain/types/') && entry.endsWith('.types.ts')) {
      yield abs;
    }
  }
}

export function evaluateKnobs({ knownCount, threshold }) {
  if (knownCount >= threshold) {
    return (
      `${knownCount} per-connection config-coercion knobs are registered — at ${threshold}, the ` +
      `#1032 rules/automation-engine cut (epic #2162 § Out of scope) said to reconsider a shared ` +
      `per-connection rules model instead of accreting knob-by-knob in JSONB. Either consolidate, ` +
      `or raise KNOB_THRESHOLD in scripts/check-architecture-gates.mjs in the same reviewed ` +
      `change, with a rationale. See #2169.`
    );
  }
  return null;
}

function checkConfigKnobs() {
  const failures = [];
  for (const [rel, { helper, key }] of KNOWN_CONFIG_KNOBS) {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      failures.push(
        `stale registry entry: ${rel} (${helper} — ${key}) no longer exists — remove it from ` +
          `KNOWN_CONFIG_KNOBS in scripts/check-architecture-gates.mjs.`
      );
      continue;
    }
    const text = readFileSync(abs, 'utf8');
    if (!isKnobCandidate(text)) {
      failures.push(
        `stale registry entry: ${rel} no longer matches the knob pattern (Connection.config ` +
          `breadcrumb + exported read*/parse* helper) — update KNOWN_CONFIG_KNOBS.`
      );
      continue;
    }
    if (!new RegExp(`export (?:function|const) ${helper}\\b`).test(text)) {
      failures.push(
        `stale registry entry: ${rel} no longer exports ${helper} — update the entry's helper ` +
          `name in KNOWN_CONFIG_KNOBS so the registry stays self-verifying.`
      );
    }
  }

  // NON_KNOBS gets the same staleness treatment as KNOWN_CONFIG_KNOBS above.
  // A suppression that outlives the thing it suppresses is invisible — nothing
  // else in this rule would ever mention the entry again — and this matters
  // most for exactly the case that motivated the first entry: a superseded
  // helper suppressed here, then deleted, leaves a dead exemption that the
  // next reader has to disprove by hand.
  for (const [rel, reason] of NON_KNOBS) {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      failures.push(
        `stale NON_KNOBS entry: ${rel} ("${reason}") no longer exists — remove it from ` +
          `NON_KNOBS in scripts/check-architecture-gates.mjs.`
      );
      continue;
    }
    if (!isKnobCandidate(readFileSync(abs, 'utf8'))) {
      failures.push(
        `stale NON_KNOBS entry: ${rel} ("${reason}") no longer matches the knob pattern, so the ` +
          `exemption is doing nothing — remove it from NON_KNOBS.`
      );
    }
  }

  for (const abs of walkTypesFiles(join(REPO_ROOT, CORE_SRC))) {
    const rel = abs.slice(REPO_ROOT.length + 1);
    if (KNOWN_CONFIG_KNOBS.has(rel) || NON_KNOBS.has(rel)) continue;
    if (isKnobCandidate(readFileSync(abs, 'utf8'))) {
      failures.push(
        `${rel} — looks like a new per-connection config-coercion knob (Connection.config ` +
          `breadcrumb + exported read*/parse* helper). Register it deliberately: add it to ` +
          `KNOWN_CONFIG_KNOBS (it counts toward the #1032 threshold) or to NON_KNOBS with a ` +
          `reason, in scripts/check-architecture-gates.mjs.`
      );
    }
  }

  const thresholdFailure = evaluateKnobs({
    knownCount: KNOWN_CONFIG_KNOBS.size,
    threshold: KNOB_THRESHOLD,
  });
  if (thresholdFailure) failures.push(thresholdFailure);
  return failures;
}

/* ------------------------------------------------------------------ */
/* Rule 3 — ladder rungs                                               */
/* ------------------------------------------------------------------ */

export function evaluateRungs({ rungCount, threshold }) {
  if (rungCount >= threshold) {
    return (
      `${rungCount} master-capability ladder rungs exist — ADR-048's countable gate says a third ` +
      `rung is the signal to revisit whether the ladder should be a single negotiated capability ` +
      `instead. Reconsider before adding it, or raise RUNG_THRESHOLD in the same reviewed change ` +
      `with a rationale. See #2169.`
    );
  }
  return null;
}

function checkLadderRungs() {
  const failures = [];
  const dirAbs = join(REPO_ROOT, RUNG_DIR);
  // No early return on a missing directory: the KNOWN_RUNGS stale check below
  // must still run, or a deleted/moved capabilities dir passes silently with a
  // registry pointing at nothing.
  if (existsSync(dirAbs)) {
    for (const entry of readdirSync(dirAbs)) {
      if (!entry.endsWith('.capability.ts')) continue;
      if (KNOWN_RUNGS.has(entry) || NON_RUNGS.has(entry)) continue;
      failures.push(
        `${RUNG_DIR}/${entry} — unclassified products sub-capability. If it declares master ` +
          `freshness (a ladder rung, ADR-048), add it to KNOWN_RUNGS (it counts toward the ` +
          `third-rung gate); otherwise add it to NON_RUNGS, in scripts/check-architecture-gates.mjs.`
      );
    }
  }
  for (const rung of KNOWN_RUNGS) {
    if (!existsSync(join(dirAbs, rung))) {
      failures.push(
        `stale registry entry: ${RUNG_DIR}/${rung} no longer exists — remove it from KNOWN_RUNGS.`
      );
    }
  }
  // Symmetric with the NON_KNOBS staleness check in rule 2: an exemption that
  // outlives its file is a silent one.
  for (const rung of NON_RUNGS) {
    if (!existsSync(join(dirAbs, rung))) {
      failures.push(
        `stale NON_RUNGS entry: ${RUNG_DIR}/${rung} no longer exists — remove it from NON_RUNGS.`
      );
    }
  }
  const thresholdFailure = evaluateRungs({
    rungCount: KNOWN_RUNGS.size,
    threshold: RUNG_THRESHOLD,
  });
  if (thresholdFailure) failures.push(thresholdFailure);
  return failures;
}

/* ------------------------------------------------------------------ */
/* Self-check                                                          */
/* ------------------------------------------------------------------ */

function selfCheck() {
  const cases = [];
  const expect = (name, actual, expected) => {
    cases.push({ name, pass: actual === expected, actual, expected });
  };

  // gate-markers: marked inline forms pass.
  expect(
    'marked (countable) gate passes',
    findUnmarkedInlineGates('x. *Reversal gate (countable):* a thing.').length,
    0
  );
  expect(
    'marked (prose-only) gate passes',
    findUnmarkedInlineGates('x. *Reversal gate (prose-only):* a thing.').length,
    0
  );
  // The ADR-050 decision-5 shape: marker wraps across a line break.
  expect(
    'line-wrapped marker passes',
    findUnmarkedInlineGates('today. *Reversal gate\n(prose-only), owned by this ADR:* a lane.').length,
    0
  );
  expect(
    'unmarked inline gate fails',
    findUnmarkedInlineGates('payload. *Reversal gate:* a fact is found.').length,
    1
  );
  // The ADR-048 block heading must not trip the inline rule.
  expect(
    'block-form heading is skipped',
    findUnmarkedInlineGates(
      '**Reversal gates** (marked for #2169):\n- *Countable*: an enqueue site.\n- *Prose-only*: pain.'
    ).length,
    0
  );

  // config-knobs: the conjunction is load-bearing.
  expect(
    'breadcrumb + exported read* is a candidate',
    isKnobCandidate('/** on `Connection.config` */\nexport function readFooBar(config) {}'),
    true
  );
  expect(
    'breadcrumb + exported const arrow read* is a candidate',
    isKnobCandidate('/** on `Connection.config` */\nexport const readFooBar = (config) => 0;'),
    true
  );
  expect(
    'breadcrumb-only doc mention is NOT a candidate (resolve-concurrency shape)',
    isKnobCandidate('/** operator `Connection.config.rateLimit.maxConcurrent` bound */\nexport type X = 1;'),
    false
  );
  expect(
    'exported read* without breadcrumb is NOT a candidate',
    isKnobCandidate('export function readSomethingElse(value) {}'),
    false
  );

  // thresholds fire exactly at the boundary.
  expect('knob count below threshold passes', evaluateKnobs({ knownCount: 4, threshold: 5 }), null);
  expect(
    'fifth knob trips the #1032 threshold',
    evaluateKnobs({ knownCount: 5, threshold: 5 }) !== null,
    true
  );
  expect('rung count below threshold passes', evaluateRungs({ rungCount: 1, threshold: 3 }), null);
  expect(
    'third rung trips the ADR-048 gate',
    evaluateRungs({ rungCount: 3, threshold: 3 }) !== null,
    true
  );

  const failed = cases.filter((c) => !c.pass);
  if (failed.length > 0) {
    for (const c of failed) {
      console.error(`✖ check-architecture-gates --self-check: ${c.name} (got ${c.actual}, want ${c.expected})`);
    }
    process.exit(1);
  }
  console.log(`✓ check-architecture-gates --self-check: ${cases.length} case(s) passed.`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const failures = [
    ...checkGateMarkers().map((f) => `[gate-markers] ${f}`),
    ...checkConfigKnobs().map((f) => `[config-knobs] ${f}`),
    ...checkLadderRungs().map((f) => `[ladder-rungs] ${f}`),
  ];

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`✖ check-architecture-gates ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `✓ check-architecture-gates: gates marked in ADR-${String(MARKER_CONVENTION_STARTS_AT).padStart(3, '0')}+, ` +
      `${KNOWN_CONFIG_KNOBS.size}/${KNOB_THRESHOLD} config knobs, ` +
      `${KNOWN_RUNGS.size}/${RUNG_THRESHOLD} ladder rungs.`
  );
}

main();
