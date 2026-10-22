#!/usr/bin/env node
/**
 * check-spec-owned-copy.mjs
 *
 * Lint-time invariant holding operator-facing copy in code AGAINST the spec that
 * declares itself that copy's canonical owner (#2795).
 *
 * WHY THIS EXISTS. A spec can say "where any other document disagrees with the
 * strings below, this section wins" (returns spec § 5.4 / § 5.5), and nothing
 * enforced it. The `check-*-mirror.mjs` family holds CODE against CODE, which can
 * only ever prove two halves are equally wrong: two feature folders carried
 * `This return is not matched to an order` WITHOUT the period the spec has, agreed
 * with each other, and kept every gate green (#2673).
 *
 * WHAT IT CHECKS. A declared table (`SPEC_OWNED_COPY`) lists pairs of
 *   (spec file + section heading, kind of emphasis, code file + declaration + path).
 * For each pair the string in code must equal, BYTE FOR BYTE, one emphasised run of
 * that kind inside that spec section:
 *
 *   bold    `**Stock was not added.**`
 *   code    `` `Restock blocked` ``
 *   button  `` `[Mark stock handled manually]` ``   (the text inside the brackets)
 *
 * There is deliberately NO third copy of the string in this table. The spec and the
 * code are the only two sides, so the table itself cannot drift.
 *
 * SECTION-WIDE BY DEFAULT, NARROWED ON PURPOSE. A pair matches ANY run of its kind in
 * the section. That is only evidence about the canonical rendering when exactly one
 * run could match, so a pair where two or more runs equal the code value FAILS as
 * AMBIGUOUS: the spec could edit one rendering and the check would still pass on
 * another. Narrow such a pair with `lineContains` (a phrase on the canonical line;
 * it is an anchor, not an owned string) and, if that line carries the string more
 * than once, `occurrence` (1-based among that kind's runs on the matching lines).
 * A pair whose anchor or occurrence cannot be found is a FAILURE like any other.
 *
 * FAILURES, NEVER SKIPS (#2673). A pair whose spec file, section, run, code file,
 * declaration, key or value cannot be read is a FAILURE naming the pair - never a
 * note. So is a table with zero pairs (a gate that can pass by discovering nothing
 * is not a gate, #2792). The code value is read TEXTUALLY and must be a plain
 * string literal: a template literal, a concatenation or a computed key is refused,
 * not guessed at.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE DOES **NOT** CATCH. Read this before trusting it.
 *
 *   1. SENTENCES WITH PLACEHOLDERS. The spec's line-row body is
 *      "...but **{connection name}** does not accept stock adjustments...", and
 *      code holds it as FRAGMENTS (`bodyPrefix` / `bodySuffix`) interpolated at
 *      render time, so the spec's sentence does not exist in code as one value.
 *      Comparing fragments needs a prose matcher and a normalisation policy; that
 *      is a separate decision. Only placeholder-free strings are held here.
 *   2. ONLY EMPHASISED RUNS. A string a spec writes as plain prose is invisible to
 *      this check until someone marks it up. That is the cost of byte-for-byte
 *      extraction without a third copy.
 *   3. IT PROVES CODE EQUALS SPEC, not that a component renders the constant, and
 *      it says nothing about whether a sentence is good (`check-ui-vocabulary`).
 *   4. A narrowed pair is as precise as its anchor. `lineContains` / `occurrence`
 *      pick a LINE and a POSITION, so a spec that reflows the canonical sentence
 *      onto another line makes the pair fail loudly (never pass), and the fix is to
 *      update the anchor in the same change.
 *   5. APOSTROPHES ARE NOT NORMALISED. A curly quote in code against a straight one
 *      in the spec is reported as drift. That is the point of "byte for byte".
 *
 * Adding a pair: add an entry to `SPEC_OWNED_COPY`. If the spec run does not exist
 * the check fails immediately, so a stale entry cannot hide.
 *
 * Every file is parsed TEXTUALLY (no TypeScript import, no transpile) so this stays
 * a zero-dependency `check:invariants` step like its siblings.
 *
 * Usage:
 *   node scripts/check-spec-owned-copy.mjs
 *   node scripts/check-spec-owned-copy.mjs --self-check
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const RETURNS_SPEC = join('docs', 'specs', 'product-spec-oms-returns-operator-ux.md');
const RESTOCK_COPY = join('apps', 'web', 'src', 'features', 'returns', 'lib', 'restock-blocked.copy.ts');
const DETAIL_COPY = join('apps', 'web', 'src', 'features', 'returns', 'lib', 'return-detail.copy.ts');
const ATTENTION_COPY = join(
  'apps', 'web', 'src', 'features', 'fulfillment-authority', 'lib', 'attention-reason.copy.ts',
);

/**
 * The strings a spec explicitly claims ownership of. EVERY pair is live and compared;
 * there is no pending mode (#2673).
 *
 * `section` is the exact heading line prefix. `kind` is the emphasis the spec renders
 * the string in. `path` walks nested object literals inside `declaration`.
 */
const SPEC_OWNED_COPY = [
  // --- returns spec § 5.4: restock_blocked ---------------------------------
  { id: 'restock-blocked / title', spec: RETURNS_SPEC, section: '### 5.4 ', kind: 'bold',
    code: { file: RESTOCK_COPY, declaration: 'RETURN_RESTOCK_BLOCKED_COPY', path: ['title'] } },
  // `Restock blocked` appears as a code run five times in § 5.4 (list row, segment,
  // table cells). Only the FIRST run on the "error badge" line is the badge itself.
  { id: 'restock-blocked / list badge', spec: RETURNS_SPEC, section: '### 5.4 ', kind: 'code',
    lineContains: 'error badge', occurrence: 1,
    code: { file: RESTOCK_COPY, declaration: 'RETURN_RESTOCK_BLOCKED_COPY', path: ['badge'] } },
  { id: 'restock-blocked / attest action', spec: RETURNS_SPEC, section: '### 5.4 ', kind: 'button',
    code: { file: RESTOCK_COPY, declaration: 'RETURN_RESTOCK_BLOCKED_COPY', path: ['attest'] } },
  // `[Why did this happen?]` is also named in the explainer's own heading line; the
  // action row is the one carrying the three buttons.
  { id: 'restock-blocked / why action', spec: RETURNS_SPEC, section: '### 5.4 ', kind: 'button',
    lineContains: 'Mark stock handled manually',
    code: { file: RESTOCK_COPY, declaration: 'RETURN_RESTOCK_BLOCKED_COPY', path: ['why'] } },
  { id: 'restock-blocked / explainer heading', spec: RETURNS_SPEC, section: '### 5.4 ', kind: 'bold',
    code: { file: RESTOCK_COPY, declaration: 'RETURN_RESTOCK_BLOCKED_EXPLAINER', path: ['heading'] } },
  // The RB-L attention state restates the title (it cannot import it: a
  // barrel-to-barrel edge would close a cycle). Held to the SPEC, not only to its
  // code twin, which is what M6 of check-attention-reason-mirror already does.
  { id: 'attention RB-L / title', spec: RETURNS_SPEC, section: '### 5.4 ', kind: 'bold',
    code: { file: ATTENTION_COPY, declaration: 'ATTENTION_REASON_COPY', path: ['restock-blocked', 'title'] } },
  { id: 'attention RB-L / titleFallback', spec: RETURNS_SPEC, section: '### 5.4 ', kind: 'bold',
    code: { file: ATTENTION_COPY, declaration: 'ATTENTION_REASON_COPY', path: ['restock-blocked', 'titleFallback'] } },

  // --- returns spec § 5.5: orphan returns ----------------------------------
  { id: 'orphan / banner title', spec: RETURNS_SPEC, section: '### 5.5 ', kind: 'bold',
    code: { file: DETAIL_COPY, declaration: 'RETURN_ORPHAN_BANNER_COPY', path: ['title'] } },
  { id: 'orphan / match action', spec: RETURNS_SPEC, section: '### 5.5 ', kind: 'button',
    code: { file: DETAIL_COPY, declaration: 'RETURN_ORPHAN_BANNER_COPY', path: ['matchAction'] } },
  { id: 'attention OR-P / title', spec: RETURNS_SPEC, section: '### 5.5 ', kind: 'bold',
    code: { file: ATTENTION_COPY, declaration: 'ATTENTION_REASON_COPY', path: ['return-unmatched', 'title'] } },
  { id: 'attention OR-P / titleFallback', spec: RETURNS_SPEC, section: '### 5.5 ', kind: 'bold',
    code: { file: ATTENTION_COPY, declaration: 'ATTENTION_REASON_COPY', path: ['return-unmatched', 'titleFallback'] } },
];

// ---------------------------------------------------------------------------
// Spec side (pure)
// ---------------------------------------------------------------------------

/** Which lines sit inside a ``` fence: a `# comment` in a shell block is not a heading. */
function fencedLineFlags(lines) {
  let inside = false;
  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inside = !inside;
      return true;
    }
    return inside;
  });
}

/**
 * The body of the ONE section whose heading line starts with `headingPrefix`, up to
 * the next heading of the same or a higher level. Zero or several matches is an
 * error: an ambiguous anchor would compare against the wrong section.
 *
 * @returns {{ ok: true, text: string } | { ok: false, reason: string }}
 */
function findSection(specText, headingPrefix) {
  const level = headingPrefix.match(/^#+/)?.[0].length ?? 0;
  if (level === 0) {
    return { ok: false, reason: `section anchor ${JSON.stringify(headingPrefix)} is not a markdown heading prefix` };
  }
  const lines = specText.split('\n');
  const fenced = fencedLineFlags(lines);
  const starts = [];
  lines.forEach((line, index) => {
    if (!fenced[index] && line.startsWith(headingPrefix)) starts.push(index);
  });
  if (starts.length === 0) {
    return { ok: false, reason: `no heading starts with ${JSON.stringify(headingPrefix)}` };
  }
  if (starts.length > 1) {
    return { ok: false, reason: `${String(starts.length)} headings start with ${JSON.stringify(headingPrefix)}; the anchor must be unique` };
  }
  const endPattern = new RegExp(`^#{1,${String(level)}} `);
  let end = lines.length;
  for (let index = starts[0] + 1; index < lines.length; index += 1) {
    if (!fenced[index] && endPattern.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { ok: true, text: lines.slice(starts[0] + 1, end).join('\n') };
}

/**
 * Emphasised runs of one kind, per line. Per line on purpose: an owned string is one
 * line in the spec, and a run spanning lines is prose, not a declared string.
 *
 * @param {string} sectionText
 * @param {'bold' | 'code' | 'button'} kind
 * @param {string} [lineContains] only runs on lines containing this anchor phrase
 * @returns {string[]}
 */
function extractRuns(sectionText, kind, lineContains) {
  const runs = [];
  for (const line of sectionText.split('\n')) {
    if (lineContains !== undefined && !line.includes(lineContains)) continue;
    if (kind === 'bold') {
      for (const match of line.matchAll(/\*\*(.+?)\*\*/g)) runs.push(match[1]);
    } else {
      for (const match of line.matchAll(/`([^`]+)`/g)) {
        const text = match[1];
        if (kind === 'code') {
          runs.push(text);
        } else {
          const button = text.match(/^\[(.+)\]$/);
          if (button) runs.push(button[1]);
        }
      }
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Code side (pure, textual)
// ---------------------------------------------------------------------------

function isIdentifierStart(char) {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/.test(char);
}

/** Index just past the string literal opening at `index`, or -1 if unterminated. */
function skipString(text, index) {
  const quote = text[index];
  let cursor = index + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\') {
      cursor += 2;
    } else if (char === quote) {
      return cursor + 1;
    } else {
      cursor += 1;
    }
  }
  return -1;
}

/** Index just past a comment starting at `index`, or `index` if there is none. */
function skipComment(text, index) {
  if (text[index] === '/' && text[index + 1] === '/') {
    const newline = text.indexOf('\n', index);
    return newline === -1 ? text.length : newline + 1;
  }
  if (text[index] === '/' && text[index + 1] === '*') {
    const close = text.indexOf('*/', index + 2);
    return close === -1 ? text.length : close + 2;
  }
  return index;
}

function skipTrivia(text, index) {
  let cursor = index;
  for (;;) {
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    const after = skipComment(text, cursor);
    if (after === cursor) return cursor;
    cursor = after;
  }
}

/**
 * The text strictly between the `{` at `openIndex` and its matching `}`, skipping
 * strings and comments.
 */
function balancedBlock(text, openIndex) {
  let depth = 0;
  let cursor = openIndex;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\'' || char === '"' || char === '`') {
      const end = skipString(text, cursor);
      if (end === -1) return null;
      cursor = end;
      continue;
    }
    const afterComment = skipComment(text, cursor);
    if (afterComment !== cursor) {
      cursor = afterComment;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, cursor);
    }
    cursor += 1;
  }
  return null;
}

/** Decode a quoted string literal body (simple escapes only). */
function decodeString(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_all, escape) => {
    if (escape.length === 5 && escape[0] === 'u') return String.fromCharCode(parseInt(escape.slice(1), 16));
    if (escape === 'n') return '\n';
    if (escape === 't') return '\t';
    return escape;
  });
}

/**
 * Every depth-0 occurrence of `key:` in an object-literal body (skipping strings and
 * comments), returning the index just past the colon.
 */
function findDirectKeys(block, key) {
  const found = [];
  let depth = 0;
  let cursor = 0;
  while (cursor < block.length) {
    const char = block[cursor];
    const afterComment = skipComment(block, cursor);
    if (afterComment !== cursor) {
      cursor = afterComment;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      const end = skipString(block, cursor);
      if (end === -1) return found;
      if (depth === 0 && char !== '`') {
        const name = decodeString(block.slice(cursor + 1, end - 1));
        const next = skipTrivia(block, end);
        if (name === key && block[next] === ':') found.push(next + 1);
      }
      cursor = end;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') depth += 1;
    if (char === '}' || char === ']' || char === ')') depth -= 1;
    if (depth === 0 && isIdentifierStart(char)) {
      let end = cursor + 1;
      while (end < block.length && isIdentifierPart(block[end])) end += 1;
      const name = block.slice(cursor, end);
      const next = skipTrivia(block, end);
      if (name === key && block[next] === ':') found.push(next + 1);
      cursor = end;
      continue;
    }
    cursor += 1;
  }
  return found;
}

/**
 * The plain string literal at `index` (after trivia). A template literal, a
 * concatenation or anything that is not one quoted literal is refused: reading it
 * "best effort" is how a pair ends up comparing nothing.
 */
function readLiteralAt(text, index) {
  const start = skipTrivia(text, index);
  const quote = text[start];
  if (quote === '`') {
    return { ok: false, reason: 'value is a template literal; it must be a plain quoted string' };
  }
  if (quote !== '\'' && quote !== '"') {
    return { ok: false, reason: 'value is not a quoted string literal' };
  }
  const end = skipString(text, start);
  if (end === -1) return { ok: false, reason: 'unterminated string literal' };
  const next = skipTrivia(text, end);
  if (next < text.length && text[next] !== ',' && text[next] !== '}') {
    return { ok: false, reason: `string literal continues with ${JSON.stringify(text[next])} (a concatenation or expression); it must be one plain literal` };
  }
  return { ok: true, value: decodeString(text.slice(start + 1, end - 1)) };
}

/**
 * Read the plain string at `path` inside the object literal bound to `declaration`.
 *
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
function readCodeString(source, declaration, path) {
  const declarationPattern = new RegExp(
    `(?:^|\\n)[ \\t]*(?:export[ \\t]+)?const[ \\t]+${declaration}\\b[^=]*=\\s*`,
    'g',
  );
  const declared = [...source.matchAll(declarationPattern)];
  if (declared.length === 0) return { ok: false, reason: `declaration ${declaration} not found` };
  if (declared.length > 1) return { ok: false, reason: `declaration ${declaration} appears ${String(declared.length)} times` };

  let openIndex = declared[0].index + declared[0][0].length;
  if (source[openIndex] !== '{') return { ok: false, reason: `${declaration} is not initialised with an object literal` };

  let block = balancedBlock(source, openIndex);
  if (block === null) return { ok: false, reason: `could not read the object literal of ${declaration}` };

  for (let step = 0; step < path.length; step += 1) {
    const key = path[step];
    const keys = findDirectKeys(block, key);
    if (keys.length === 0) return { ok: false, reason: `key ${JSON.stringify(key)} not found at ${[declaration, ...path.slice(0, step)].join('.')}` };
    if (keys.length > 1) return { ok: false, reason: `key ${JSON.stringify(key)} appears ${String(keys.length)} times at ${[declaration, ...path.slice(0, step)].join('.')}` };

    const isLast = step === path.length - 1;
    if (isLast) return readLiteralAt(block, keys[0]);

    openIndex = skipTrivia(block, keys[0]);
    if (block[openIndex] !== '{') return { ok: false, reason: `${JSON.stringify(key)} is not an object literal, so ${JSON.stringify(path[step + 1])} cannot be read from it` };
    const inner = balancedBlock(block, openIndex);
    if (inner === null) return { ok: false, reason: `could not read the object literal at ${JSON.stringify(key)}` };
    block = inner;
  }
  return { ok: false, reason: 'empty path' };
}

// ---------------------------------------------------------------------------
// Decision (pure)
// ---------------------------------------------------------------------------

function squash(text) {
  return text.trim().replace(/\s+/g, ' ');
}

/** Why two strings that are NOT byte-equal still look like the same sentence. */
function describeNearMiss(codeValue, run) {
  if (codeValue === `${run}.` || run === `${codeValue}.`) {
    return 'they differ only by a trailing period';
  }
  if (squash(codeValue) === squash(run)) return 'they differ only by whitespace';
  if (codeValue.toLowerCase() === run.toLowerCase()) return 'they differ only by letter case';
  if (codeValue.replace(/[’‘]/g, '\'') === run.replace(/[’‘]/g, '\'')) {
    return 'they differ only by a curly versus a straight apostrophe';
  }
  return null;
}

/**
 * Decide one pair. The code value must equal ONE run byte for byte.
 *
 * @returns {{ status: 'ok' } | { status: 'no-runs' } | { status: 'drift', hint: string | null, nearest: string | null }}
 */
function classifyPair(codeValue, runs) {
  if (runs.length === 0) return { status: 'no-runs' };
  if (runs.includes(codeValue)) return { status: 'ok' };
  for (const run of runs) {
    const hint = describeNearMiss(codeValue, run);
    if (hint !== null) return { status: 'drift', hint, nearest: run };
  }
  // Reworded on one side: show the spec run that shares most words, so the reader
  // sees what the spec says NOW instead of hunting through every run in the section.
  const closest = closestByWords(codeValue, runs);
  if (closest !== null) {
    return { status: 'drift', hint: 'the wording differs; this is the spec run sharing the most words', nearest: closest };
  }
  return { status: 'drift', hint: null, nearest: null };
}

function wordSet(text) {
  return new Set(text.toLowerCase().split(/[^a-z0-9{}']+/).filter(Boolean));
}

/** The run with the highest word overlap (Jaccard), or null below one half. */
function closestByWords(codeValue, runs) {
  const target = wordSet(codeValue);
  let best = null;
  let bestScore = 0;
  for (const run of runs) {
    const words = wordSet(run);
    let shared = 0;
    for (const word of words) if (target.has(word)) shared += 1;
    const union = new Set([...target, ...words]).size;
    const score = union === 0 ? 0 : shared / union;
    if (score > bestScore) {
      bestScore = score;
      best = run;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

/** How a pair was narrowed, for messages ('' when it was not). */
function narrowingNote(pair) {
  const parts = [];
  if (pair.lineContains !== undefined) parts.push(`lines containing ${JSON.stringify(pair.lineContains)}`);
  if (pair.occurrence !== undefined) parts.push(`occurrence ${String(pair.occurrence)}`);
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

/**
 * Evaluate the whole table against already-loaded sources. Pure: the caller does
 * the I/O, so `--self-check` can feed it fixtures.
 *
 * @param {Array} pairs
 * @param {(path: string) => string | undefined} readFileText
 * @returns {{ failures: string[], checked: number }}
 */
function evaluatePairs(pairs, readFileText) {
  const failures = [];
  if (pairs.length === 0) {
    failures.push('SPEC_OWNED_COPY declares zero pairs - a gate that passes by checking nothing is not a gate (#2792)');
    return { failures, checked: 0 };
  }
  let checked = 0;
  for (const pair of pairs) {
    const label = `[${pair.id}]`;
    const specText = readFileText(pair.spec);
    if (specText === undefined) {
      failures.push(`${label} cannot read spec file ${pair.spec}`);
      continue;
    }
    const codeText = readFileText(pair.code.file);
    if (codeText === undefined) {
      failures.push(`${label} cannot read code file ${pair.code.file}`);
      continue;
    }
    const section = findSection(specText, pair.section);
    if (!section.ok) {
      failures.push(`${label} spec ${pair.spec}: ${section.reason}`);
      continue;
    }
    const code = readCodeString(codeText, pair.code.declaration, pair.code.path);
    if (!code.ok) {
      failures.push(`${label} code ${pair.code.file}: ${code.reason}`);
      continue;
    }
    if (pair.occurrence !== undefined && (!Number.isInteger(pair.occurrence) || pair.occurrence < 1)) {
      failures.push(`${label} occurrence must be a positive integer, got ${JSON.stringify(pair.occurrence)}`);
      continue;
    }
    let runs = extractRuns(section.text, pair.kind, pair.lineContains);
    if (pair.occurrence !== undefined) {
      if (pair.occurrence > runs.length) {
        failures.push(
          `${label} spec ${pair.spec} section ${JSON.stringify(pair.section.trim())}${narrowingNote(pair)} has ` +
            `${String(runs.length)} ${pair.kind} run(s), so occurrence ${String(pair.occurrence)} does not exist`,
        );
        continue;
      }
      runs = [runs[pair.occurrence - 1]];
    }
    const verdict = classifyPair(code.value, runs);
    checked += 1;
    if (verdict.status === 'ok') {
      // An exact match is only evidence about the CANONICAL rendering when exactly
      // one run could have produced it. Two equal runs mean the spec could change
      // one of them and this pair would still pass on the other.
      const equal = runs.filter((run) => run === code.value).length;
      if (equal > 1) {
        failures.push(
          `${label} AMBIGUOUS: ${String(equal)} ${pair.kind} runs in spec ${pair.spec} section ` +
            `${JSON.stringify(pair.section.trim())}${narrowingNote(pair)} equal ` +
            `${pair.code.declaration}.${pair.code.path.join('.')} = ${JSON.stringify(code.value)}.\n` +
            '      Narrow the pair with `lineContains` (a phrase on the canonical line) and, if that line holds\n' +
            '      the string more than once, `occurrence`; otherwise the spec could edit one rendering and the\n' +
            '      check would still pass on another.',
        );
      }
      continue;
    }

    const where = `${pair.code.declaration}.${pair.code.path.join('.')}`;
    if (verdict.status === 'no-runs') {
      failures.push(
        `${label} spec ${pair.spec} section ${JSON.stringify(pair.section.trim())}${narrowingNote(pair)} has no ${pair.kind} run at all, ` +
          `so ${where} = ${JSON.stringify(code.value)} cannot be compared`,
      );
      continue;
    }
    const near = verdict.nearest === null ? '' : `\n      closest spec run: ${JSON.stringify(verdict.nearest)} (${verdict.hint})`;
    failures.push(
      `${label} DRIFT between spec and code\n` +
        `      spec: ${pair.spec} section ${JSON.stringify(pair.section.trim())}${narrowingNote(pair)} (${pair.kind} runs: ${String(runs.length)})\n` +
        `      code: ${pair.code.file} ${where} = ${JSON.stringify(code.value)}${near}`,
    );
  }
  return { failures, checked };
}

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------

function selfCheck() {
  const problems = [];
  const expect = (condition, message) => {
    if (!condition) problems.push(message);
  };

  const spec = [
    '# Title',
    '### 5.4 Heading',
    '> **Stock was not added.** body **{connection}** more',
    '1. **List row** - `Restock blocked` badge',
    '   `[Mark stock handled manually]`  `[Open {connection}]`',
    '### 5.5 Next',
    '> **Other.**',
    '## 6 Out',
    '**Outside.**',
  ].join('\n');

  // findSection
  const section = findSection(spec, '### 5.4 ');
  expect(section.ok && section.text.includes('Stock was not added.'), 'findSection should return the section body');
  expect(section.ok && !section.text.includes('Other.'), 'findSection should stop at the next heading');
  expect(!findSection(spec, '### 9.9 ').ok, 'findSection should fail on a missing heading');
  expect(!findSection(`${spec}\n### 5.4 again`, '### 5.4 ').ok, 'findSection should fail on an ambiguous heading');
  expect(!findSection(spec, '5.4 ').ok, 'findSection should fail on a non-heading anchor');
  const last = findSection(spec, '## 6 ');
  expect(last.ok && last.text.includes('Outside.'), 'findSection should run to the end of the file');

  // extractRuns
  expect(
    JSON.stringify(extractRuns(section.text, 'bold')) ===
      JSON.stringify(['Stock was not added.', '{connection}', 'List row']),
    'extractRuns bold should return every bold run of the section, in order',
  );
  expect(extractRuns(section.text, 'code').includes('Restock blocked'), 'extractRuns code');
  expect(JSON.stringify(extractRuns(section.text, 'button')) === JSON.stringify(['Mark stock handled manually', 'Open {connection}']), 'extractRuns button');

  // readCodeString
  const code = [
    'export const COPY = {',
    '  // a comment with title: \'ignored\'',
    '  title: \'Stock was not added.\',',
    '  titleFallback: "Quoted \\"x\\"",',
    '  nested: { title: \'inner\' },',
    '  \'restock-blocked\': {',
    '    title: \'Stock was not added.\',',
    '    body:',
    '      \'long value\',',
    '  },',
    '  joined: \'a\' + \'b\',',
    '  tpl: `template`,',
    '  dup: \'one\',',
    '  dup: \'two\',',
    '} as const;',
  ].join('\n');
  expect(readCodeString(code, 'COPY', ['title']).value === 'Stock was not added.', 'readCodeString should read a top-level key');
  expect(readCodeString(code, 'COPY', ['titleFallback']).value === 'Quoted "x"', 'readCodeString should decode escapes');
  expect(readCodeString(code, 'COPY', ['restock-blocked', 'title']).value === 'Stock was not added.', 'readCodeString should walk a quoted nested key');
  expect(readCodeString(code, 'COPY', ['restock-blocked', 'body']).value === 'long value', 'readCodeString should read a value on the next line');
  expect(readCodeString(code, 'COPY', ['nested', 'title']).value === 'inner', 'readCodeString should not confuse a nested title with the top-level one');
  expect(!readCodeString(code, 'COPY', ['joined']).ok, 'readCodeString should refuse a concatenation');
  expect(!readCodeString(code, 'COPY', ['tpl']).ok, 'readCodeString should refuse a template literal');
  expect(!readCodeString(code, 'COPY', ['dup']).ok, 'readCodeString should refuse a duplicate key');
  expect(!readCodeString(code, 'COPY', ['missing']).ok, 'readCodeString should refuse a missing key');
  expect(!readCodeString(code, 'NOPE', ['title']).ok, 'readCodeString should refuse a missing declaration');
  expect(!readCodeString(code, 'COPY', ['title', 'deeper']).ok, 'readCodeString should refuse descending into a string');
  expect(!readCodeString(`${code}\n${code}`, 'COPY', ['title']).ok, 'readCodeString should refuse a duplicated declaration');

  // classifyPair
  const runs = ['Stock was not added.', 'Other'];
  expect(classifyPair('Stock was not added.', runs).status === 'ok', 'classifyPair should accept an exact match');
  expect(classifyPair('x', []).status === 'no-runs', 'classifyPair should report no runs');
  const period = classifyPair('Stock was not added', runs);
  expect(period.status === 'drift' && period.hint === 'they differ only by a trailing period', 'classifyPair should name a missing trailing period (the #2673 symptom)');
  const periodOther = classifyPair('Other.', runs);
  expect(periodOther.status === 'drift' && periodOther.hint === 'they differ only by a trailing period', 'classifyPair should name an EXTRA trailing period too');
  expect(classifyPair('stock was not added.', runs).hint === 'they differ only by letter case', 'classifyPair should name a case difference');
  expect(classifyPair('Stock  was not added.', runs).hint === 'they differ only by whitespace', 'classifyPair should name a whitespace difference');
  expect(classifyPair('it hadn’t', ['it hadn\'t']).hint === 'they differ only by a curly versus a straight apostrophe', 'classifyPair should name an apostrophe difference and not normalise it away');
  const far = classifyPair('Completely different', runs);
  expect(far.status === 'drift' && far.hint === null && far.nearest === null, 'classifyPair should report drift with no hint when nothing is close');
  const reworded = classifyPair('Stock was never added.', runs);
  expect(reworded.status === 'drift' && reworded.nearest === 'Stock was not added.', 'classifyPair should offer the spec run sharing the most words when the wording changed');

  // evaluatePairs
  const files = new Map([
    ['spec.md', spec],
    ['code.ts', code],
  ]);
  const reader = (path) => files.get(path);
  const good = { id: 'good', spec: 'spec.md', section: '### 5.4 ', kind: 'bold', code: { file: 'code.ts', declaration: 'COPY', path: ['title'] } };
  expect(evaluatePairs([good], reader).failures.length === 0, 'evaluatePairs should pass a matching pair');
  expect(evaluatePairs([], reader).failures.length === 1, 'evaluatePairs should FAIL on zero pairs');
  const drifted = { ...good, id: 'drifted', code: { ...good.code, path: ['titleFallback'] } };
  const driftResult = evaluatePairs([drifted], reader);
  expect(driftResult.failures.length === 1 && /DRIFT/.test(driftResult.failures[0]) && /spec\.md/.test(driftResult.failures[0]) && /code\.ts/.test(driftResult.failures[0]), 'evaluatePairs should name BOTH sides on drift');
  expect(evaluatePairs([{ ...good, spec: 'gone.md' }], reader).failures.length === 1, 'evaluatePairs should FAIL on an unreadable spec');
  expect(evaluatePairs([{ ...good, code: { ...good.code, file: 'gone.ts' } }], reader).failures.length === 1, 'evaluatePairs should FAIL on an unreadable code file');
  expect(evaluatePairs([{ ...good, section: '### 9.9 ' }], reader).failures.length === 1, 'evaluatePairs should FAIL on a missing section');
  expect(evaluatePairs([{ ...good, code: { ...good.code, path: ['missing'] } }], reader).failures.length === 1, 'evaluatePairs should FAIL on a missing key');
  const noRuns = evaluatePairs([{ ...good, section: '### 5.5 ', kind: 'code' }], reader);
  expect(noRuns.failures.length === 1 && /no code run/.test(noRuns.failures[0]), 'evaluatePairs should FAIL when the section has no run of the kind');
  const mixed = evaluatePairs([good, drifted, { ...good, id: 'broken', section: '### 9.9 ' }], reader);
  expect(mixed.failures.length === 2 && mixed.checked === 2, 'evaluatePairs should report every failing pair, not stop at the first');

  // Ambiguity, narrowing and occurrence (#2795 review): a string that appears in
  // several runs must not pass on whichever one happens to be left unedited.
  const multiSpec = [
    '### 7.1 Multi',
    '1. **Row** - `Restock blocked` error badge, and the `Restock blocked` segment counts it',
    '2. A table cell `Restock blocked`',
    '3. **Actions** `[Mark it]` `[Why?]`',
    '4. **Heading** `[Why?]`',
    '```sh',
    '# a shell comment is not a heading',
    '```',
    '### 7.2 Next',
  ].join('\n');
  const multiCode = "export const M = {\n  badge: 'Restock blocked',\n  why: 'Why?',\n  mark: 'Mark it',\n} as const;\n";
  const multiFiles = new Map([['multi.md', multiSpec], ['multi.ts', multiCode]]);
  const multiReader = (path) => multiFiles.get(path);
  const multiPair = (id, key, kind, extra = {}) => ({
    id, spec: 'multi.md', section: '### 7.1 ', kind,
    code: { file: 'multi.ts', declaration: 'M', path: [key] },
    ...extra,
  });

  const ambiguous = evaluatePairs([multiPair('amb', 'badge', 'code')], multiReader);
  expect(ambiguous.failures.length === 1 && /AMBIGUOUS/.test(ambiguous.failures[0]) && /lineContains/.test(ambiguous.failures[0]), 'evaluatePairs should FAIL a pair where several runs equal the value, and say how to narrow it');
  expect(evaluatePairs([multiPair('amb2', 'why', 'button')], multiReader).failures.some((entry) => /AMBIGUOUS/.test(entry)), 'evaluatePairs should call two equal button runs on different lines ambiguous');
  expect(evaluatePairs([multiPair('line', 'why', 'button', { lineContains: 'Actions' })], multiReader).failures.length === 0, 'lineContains should narrow an ambiguous pair to the canonical line');
  expect(evaluatePairs([multiPair('occ', 'badge', 'code', { lineContains: 'error badge', occurrence: 1 })], multiReader).failures.length === 0, 'occurrence should pick the canonical run on a line that names the string twice');
  expect(evaluatePairs([multiPair('occ-amb', 'badge', 'code', { lineContains: 'error badge' })], multiReader).failures.some((entry) => /AMBIGUOUS/.test(entry)), 'a line naming the string twice is still ambiguous without occurrence');
  expect(evaluatePairs([multiPair('occ-far', 'badge', 'code', { lineContains: 'error badge', occurrence: 3 })], multiReader).failures.length === 1, 'an occurrence beyond the runs must FAIL');
  expect(evaluatePairs([multiPair('occ-bad', 'badge', 'code', { lineContains: 'error badge', occurrence: 0 })], multiReader).failures.length === 1, 'a non-positive occurrence must FAIL');
  const noLine = evaluatePairs([multiPair('no-line', 'badge', 'code', { lineContains: 'no such line' })], multiReader);
  expect(noLine.failures.length === 1 && /no code run at all/.test(noLine.failures[0]), 'a lineContains that matches no line must FAIL, not skip');

  // The point of occurrence: editing ONLY the canonical rendering must be caught
  // even though a later run on the same line still equals the code value.
  const editedSpec = multiSpec.replace('`Restock blocked` error badge', '`Restocking blocked` error badge');
  const editedReader = (path) => (path === 'multi.md' ? editedSpec : multiFiles.get(path));
  const editedCaught = evaluatePairs([multiPair('edited', 'badge', 'code', { lineContains: 'error badge', occurrence: 1 })], editedReader);
  expect(editedCaught.failures.length === 1 && /DRIFT/.test(editedCaught.failures[0]), 'editing only the canonical run must be caught by a narrowed pair');
  // An un-narrowed pair cannot hide the same edit: it was ambiguous before the edit and
  // is still flagged after it, so the weakness is a failure, never a silent pass.
  const editedWide = evaluatePairs([multiPair('edited-wide', 'badge', 'code')], editedReader);
  expect(editedWide.failures.length === 1 && /AMBIGUOUS/.test(editedWide.failures[0]), 'an un-narrowed pair over several equal runs stays flagged after one of them is edited');

  // A heading-looking line inside a code fence does not end the section.
  const fencedSection = findSection(multiSpec, '### 7.1 ');
  expect(fencedSection.ok && fencedSection.text.includes('a shell comment is not a heading') && !fencedSection.text.includes('7.2'), 'findSection should ignore headings inside code fences and still stop at the real next heading');

  // The live table must be well-formed.
  expect(SPEC_OWNED_COPY.length > 0, 'the declared table must not be empty');
  const ids = SPEC_OWNED_COPY.map((pair) => pair.id);
  expect(new Set(ids).size === ids.length, 'every declared pair id must be unique');

  if (problems.length > 0) {
    console.error('check-spec-owned-copy --self-check FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-spec-owned-copy --self-check passed');
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  if (process.argv.includes('--self-check')) {
    selfCheck();
    return;
  }

  const paths = new Set(SPEC_OWNED_COPY.flatMap((pair) => [pair.spec, pair.code.file]));
  const loaded = new Map();
  for (const path of paths) {
    try {
      loaded.set(path, await readFile(join(repoRoot, path), 'utf8'));
    } catch {
      // Left absent on purpose: evaluatePairs turns it into a named FAILURE.
    }
  }

  const { failures, checked } = evaluatePairs(SPEC_OWNED_COPY, (path) => loaded.get(path));
  if (failures.length > 0) {
    console.error('check-spec-owned-copy FAILED (#2795): operator copy differs from the spec that owns it.\n');
    for (const failure of failures) console.error(`  ${failure}\n`);
    console.error('The spec section is the canonical owner. Fix the code string, or - if the spec is');
    console.error('what is wrong - fix the spec in the same change. Never edit only one side to match.');
    process.exit(1);
  }
  console.log(`check-spec-owned-copy: OK (${String(checked)} spec-owned strings match their spec byte for byte)`);
}

await main();
