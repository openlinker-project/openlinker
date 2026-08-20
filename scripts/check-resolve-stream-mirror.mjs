#!/usr/bin/env node
/**
 * check-resolve-stream-mirror.mjs
 *
 * Lint-time invariant for the three hand-maintained mirrors of the streamed
 * category-resolution contract (`POST /listings/connections/:id/categories/
 * resolve-stream`, #2209/#2211, epic #2205).
 *
 * The browser bundle cannot import `@openlinker/core` (#591) and the two
 * transport constants are deliberately API-app-local rather than core, so each
 * value exists twice. A copy drifts silently in BOTH directions, and each side
 * stays green because each is tested against its own copy - which is exactly
 * the class of defect `docs/lessons.md` ("A hand-copied FE/BE literal union
 * needs a `check:invariants` guard, not a 'keep in sync' comment") says must be
 * machine-checked. `check-sales-document-reason-mirror.mjs` is the precedent
 * this script follows.
 *
 * Three mirrors are enforced:
 *
 *  1. KEEP-ALIVE INTERVAL. `RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS`
 *     in the API stream DTO vs the same-named constant in the FE api module.
 *     The client derives its idle ceiling as `interval * 6`, so raising only
 *     the server's interval past that ceiling kills every healthy long run
 *     with "the resolver stopped sending data".
 *
 *  2. ITEMS CAP. `RESOLVE_CATEGORY_ITEMS_MAX` (the route's own
 *     `@ArrayMaxSize`) vs the FE's `RESOLVE_CATEGORY_STREAM_CHUNK_SIZE`, the
 *     size the client splits its requests at. Differently named on purpose -
 *     one is a limit, the other a chunk size - but they must hold the same
 *     number: a server-side reduction that is not mirrored makes every large
 *     batch 400 at the validation pipe.
 *
 *  3. STREAM EVENT UNION. The FE mirror of `EanCategoryMatchStreamEvent` vs
 *     the core source of truth. Compared structurally, never as a text diff:
 *       - the `completion` value union (`EanCategoryMatchStreamCompletionValues`),
 *         membership AND order;
 *       - the set of event `kind` discriminants, derived from the members of
 *         the `EanCategoryMatchStreamEvent` union on each side (the FE has no
 *         `EanCategoryMatchStreamEventKindValues` array of its own);
 *       - core's own `EanCategoryMatchStreamEventKindValues` array against the
 *         kinds its union actually declares, so the runtime array cannot rot;
 *       - the property NAMES (with optionality) of each mirrored event
 *         interface, so a field added on one side only fails the build.
 *
 * SCOPE, so the wrong guard is not trusted. This script compares numbers,
 * value unions, and property name sets. It does NOT compare property TYPES:
 * the two sides reference their own `EanMatchResult` declarations, so a type
 * comparison would be a name comparison of unrelated symbols. `EanMatchResult`
 * itself, the transport-only `keep-alive` line (FE-side it is deliberately not
 * modelled - the decoder drops it), the Swagger schema in the stream DTO, and
 * the `* 6` idle-ceiling factor are all out of scope. Nested object literals
 * inside an interface are skipped rather than descended into.
 *
 * Every file is parsed TEXTUALLY (no TypeScript import, no transpile, no
 * parser dependency) so this stays a zero-dependency `check:invariants` step
 * like its siblings. Comments are blanked before parsing - preserving offsets
 * and line numbers - so a `{@link}` in a JSDoc block cannot confuse the
 * brace matching and an annotated value cannot be read as a value.
 *
 * Run with `--self-check` to exercise the pure parsers + differs against
 * synthetic inputs (no filesystem).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

const BE_STREAM_DTO = join(
  'apps',
  'api',
  'src',
  'listings',
  'http',
  'dto',
  'resolve-category-stream.dto.ts'
);
const BE_BATCH_DTO = join(
  'apps',
  'api',
  'src',
  'listings',
  'http',
  'dto',
  'resolve-category-batch.dto.ts'
);
const CORE_STREAM_TYPES = join(
  'libs',
  'core',
  'src',
  'listings',
  'domain',
  'types',
  'ean-category-match-stream.types.ts'
);
const FE_API = join('apps', 'web', 'src', 'features', 'listings', 'api', 'listings.api.ts');
const FE_TYPES = join('apps', 'web', 'src', 'features', 'listings', 'api', 'listings.types.ts');

const EVENT_UNION = 'EanCategoryMatchStreamEvent';
const COMPLETION_VALUES = 'EanCategoryMatchStreamCompletionValues';
const EVENT_KIND_VALUES = 'EanCategoryMatchStreamEventKindValues';

const DOCS_REF = 'docs/architecture/adrs/047-streamed-per-variant-progress.md';

// --------------------------------------------------------------------------
// Pure parsers. All exported so `--self-check` can exercise them directly.
// --------------------------------------------------------------------------

/** 1-based line number of a character offset. */
function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

/**
 * Replace every comment with spaces, preserving total length, every newline and
 * therefore every line number. String literals are stepped over untouched so a
 * `//` inside one is not mistaken for a comment.
 *
 * Blanking rather than deleting is what lets the brace matcher below run over
 * raw offsets while still reporting the real line numbers.
 */
export function blankComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        if (source[i] === '\\' && i + 1 < n) {
          out += source[i] + source[i + 1];
          i += 2;
          continue;
        }
        out += source[i];
        const done = source[i] === quote;
        i++;
        if (done) break;
      }
      continue;
    }

    if (ch === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Extract `export const <name> = <numeric literal>;`. Underscore separators
 * (`10_000`) are the house style, so they are stripped before parsing. Returns
 * `{ line, raw, value }`, or `null` when the declaration is absent or its
 * initializer is not a plain number (a derived expression is not a mirror).
 */
export function parseNumericConstant(content, name) {
  const re = new RegExp(`export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*([0-9][0-9_]*)\\s*;`);
  const m = re.exec(content);
  if (!m) return null;
  return { line: lineOf(content, m.index), raw: m[1], value: Number(m[1].replace(/_/g, '')) };
}

/**
 * Extract the string literals of `export const <name> = [...] as const;`.
 * Returns `{ line, values }`, or `null` when the declaration is absent.
 */
export function parseConstArrayValues(content, name) {
  const declRe = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const openBracket = declMatch.index + declMatch[0].length - 1;
  const closeBracket = content.indexOf(']', openBracket);
  if (closeBracket === -1) return null;

  const body = content.slice(openBracket + 1, closeBracket);
  const values = [];
  const literalRe = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = literalRe.exec(body)) !== null) {
    values.push(m[1] ?? m[2]);
  }

  return { line: lineOf(content, declMatch.index), values };
}

/**
 * Extract the member names of `export type <name> = A | B | C;`. Returns
 * `{ line, members }`, or `null` when the declaration is absent.
 */
export function parseUnionMembers(content, name) {
  const declRe = new RegExp(`export\\s+type\\s+${name}\\s*=`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const start = declMatch.index + declMatch[0].length;
  const end = content.indexOf(';', start);
  if (end === -1) return null;

  const members = content
    .slice(start, end)
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return { line: lineOf(content, declMatch.index), members };
}

/**
 * Extract the body of `export interface <name> { ... }` by brace matching.
 * Returns `{ line, body }`, or `null` when the declaration is absent.
 */
export function parseInterfaceBody(content, name) {
  const declRe = new RegExp(`export\\s+interface\\s+${name}\\s*(?:extends[^{]+)?\\{`);
  const declMatch = declRe.exec(content);
  if (!declMatch) return null;

  const open = declMatch.index + declMatch[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return null;

  return { line: lineOf(content, declMatch.index), body: content.slice(open + 1, close) };
}

/**
 * Property names of an interface body, with the optionality marker kept
 * (`ean?` differs from `ean` and that difference is a real drift). Only depth-0
 * properties are collected: a nested object literal is skipped rather than
 * descended into, which is stated in the header's SCOPE note.
 */
export function parseInterfaceFieldNames(body) {
  const fields = [];
  let depth = 0;
  let i = 0;
  let atStatementStart = true;

  while (i < body.length) {
    const ch = body[i];

    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']' || ch === '>') {
      depth--;
      i++;
      atStatementStart = depth === 0;
      continue;
    }
    if (ch === ';' || ch === ',' || ch === '\n') {
      i++;
      if (depth === 0) atStatementStart = true;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (depth === 0 && atStatementStart) {
      const m = /^(readonly\s+)?([A-Za-z_$][\w$]*)(\??)\s*:/.exec(body.slice(i));
      if (m) {
        fields.push(`${m[2]}${m[3]}`);
        i += m[0].length;
        atStatementStart = false;
        continue;
      }
    }

    atStatementStart = false;
    i++;
  }

  return fields;
}

/**
 * The `kind` discriminant a single event interface declares, e.g. `'result'`.
 * Returns `null` when the interface has no literal `kind` property - which is
 * itself a drift worth reporting, since the discriminant is what a consumer
 * switches on.
 */
export function parseKindLiteral(body) {
  const m = /(?:^|[\s;,{])kind\s*:\s*'([^']*)'/.exec(body);
  return m ? m[1] : null;
}

/**
 * Resolve one side's event vocabulary: for every member of the
 * `EanCategoryMatchStreamEvent` union, its `kind` literal and its property
 * names. Returns `{ line, events, problems }` where `events` is a map from
 * kind -> `{ interfaceName, fields }`.
 */
export function parseStreamEvents(content, unionName) {
  const union = parseUnionMembers(content, unionName);
  if (!union) return null;

  const events = new Map();
  const problems = [];

  for (const member of union.members) {
    const iface = parseInterfaceBody(content, member);
    if (!iface) {
      problems.push(`union member '${member}' has no 'export interface ${member} { ... }'`);
      continue;
    }
    const kind = parseKindLiteral(iface.body);
    if (kind === null) {
      problems.push(`interface '${member}' declares no literal 'kind:' discriminant`);
      continue;
    }
    events.set(kind, {
      interfaceName: member,
      line: iface.line,
      fields: parseInterfaceFieldNames(iface.body),
    });
  }

  return { line: union.line, events, problems };
}

// --------------------------------------------------------------------------
// Pure differs.
// --------------------------------------------------------------------------

/** Compare two `as const` value arrays: membership first, then order. */
export function diffValueArrays(left, right, leftLabel, rightLabel) {
  const issues = [];
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  const missingRight = left.filter((v) => !rightSet.has(v));
  const missingLeft = right.filter((v) => !leftSet.has(v));

  if (missingRight.length > 0) {
    issues.push(
      `present in ${leftLabel} but MISSING from ${rightLabel}: ${missingRight
        .map((v) => `'${v}'`)
        .join(', ')}`
    );
  }
  if (missingLeft.length > 0) {
    issues.push(
      `present in ${rightLabel} but MISSING from ${leftLabel}: ${missingLeft
        .map((v) => `'${v}'`)
        .join(', ')}`
    );
  }
  if (issues.length === 0 && left.join('|') !== right.join('|')) {
    // Same membership, different order. Not a functional break today, but the
    // files are read side-by-side when adding a value - keep them aligned.
    issues.push(
      `same values but different order (${leftLabel}: ${left.join(', ')} / ${rightLabel}: ${right.join(', ')})`
    );
  }

  return { ok: issues.length === 0, issues };
}

/** Compare two property-name sets. Order is not meaningful for fields. */
export function diffFieldNames(left, right, leftLabel, rightLabel) {
  const issues = [];
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  const missingRight = left.filter((f) => !rightSet.has(f));
  const missingLeft = right.filter((f) => !leftSet.has(f));

  if (missingRight.length > 0) {
    issues.push(`field(s) in ${leftLabel} but not ${rightLabel}: ${missingRight.join(', ')}`);
  }
  if (missingLeft.length > 0) {
    issues.push(`field(s) in ${rightLabel} but not ${leftLabel}: ${missingLeft.join(', ')}`);
  }

  return { ok: issues.length === 0, issues };
}

// --------------------------------------------------------------------------
// Checks.
// --------------------------------------------------------------------------

/**
 * Numeric mirror between two files. `left`/`right` are
 * `{ file, content, name }`; the names may differ (the items cap is a limit on
 * one side and a chunk size on the other), the numbers may not.
 */
function checkNumericMirror(label, left, right, why) {
  const fatal = [];
  const drifts = [];

  const l = parseNumericConstant(left.content, left.name);
  const r = parseNumericConstant(right.content, right.name);

  if (!l) fatal.push(`${left.file}: no 'export const ${left.name} = <number>;' found`);
  if (!r) fatal.push(`${right.file}: no 'export const ${right.name} = <number>;' found`);
  if (fatal.length > 0) return { fatal, drifts, compared: 0 };

  if (l.value !== r.value) {
    drifts.push({
      label,
      locations: [
        `${left.file}:${l.line}  ${left.name} = ${l.raw}`,
        `${right.file}:${r.line}  ${right.name} = ${r.raw}`,
      ],
      issues: [`the two constants must hold the same number - ${why}`],
    });
  }

  return { fatal, drifts, compared: 1 };
}

/** Structural mirror of the stream-event vocabulary. */
function checkStreamEventUnion(core, fe) {
  const fatal = [];
  const drifts = [];
  let compared = 0;

  // (a) The completion value union.
  const coreCompletion = parseConstArrayValues(core.content, COMPLETION_VALUES);
  const feCompletion = parseConstArrayValues(fe.content, COMPLETION_VALUES);
  if (!coreCompletion) {
    fatal.push(`${core.file}: no 'export const ${COMPLETION_VALUES} = [...]' found`);
  }
  if (!feCompletion) {
    fatal.push(`${fe.file}: no 'export const ${COMPLETION_VALUES} = [...]' found`);
  }
  if (coreCompletion && feCompletion) {
    compared += coreCompletion.values.length;
    const { ok, issues } = diffValueArrays(
      coreCompletion.values,
      feCompletion.values,
      'core',
      'the frontend mirror'
    );
    if (!ok) {
      drifts.push({
        label: `${COMPLETION_VALUES} (how a stream ended)`,
        locations: [
          `${core.file}:${coreCompletion.line}  (authoritative)`,
          `${fe.file}:${feCompletion.line}  (hand-maintained mirror)`,
        ],
        issues,
      });
    }
  }

  // (b) + (c) The event kinds and their fields, derived from each side's union.
  const coreEvents = parseStreamEvents(core.content, EVENT_UNION);
  const feEvents = parseStreamEvents(fe.content, EVENT_UNION);
  if (!coreEvents) fatal.push(`${core.file}: no 'export type ${EVENT_UNION} = ...' found`);
  if (!feEvents) fatal.push(`${fe.file}: no 'export type ${EVENT_UNION} = ...' found`);

  if (coreEvents && feEvents) {
    for (const problem of coreEvents.problems) fatal.push(`${core.file}: ${problem}`);
    for (const problem of feEvents.problems) fatal.push(`${fe.file}: ${problem}`);

    const coreKinds = [...coreEvents.events.keys()];
    const feKinds = [...feEvents.events.keys()];
    compared += coreKinds.length;

    const kindDiff = diffValueArrays(coreKinds, feKinds, 'core', 'the frontend mirror');
    if (!kindDiff.ok) {
      drifts.push({
        label: `${EVENT_UNION} 'kind' discriminants`,
        locations: [
          `${core.file}:${coreEvents.line}  (authoritative)`,
          `${fe.file}:${feEvents.line}  (hand-maintained mirror)`,
        ],
        issues: kindDiff.issues,
      });
    }

    // (b2) Core's runtime kind array must match the union it describes. The FE
    // has no such array, so this half is a core self-consistency check: the
    // array is what the transport validates an inbound line against, so it must
    // not rot behind the union.
    const coreKindValues = parseConstArrayValues(core.content, EVENT_KIND_VALUES);
    if (!coreKindValues) {
      fatal.push(`${core.file}: no 'export const ${EVENT_KIND_VALUES} = [...]' found`);
    } else {
      const selfDiff = diffValueArrays(
        coreKindValues.values,
        coreKinds,
        `${EVENT_KIND_VALUES}`,
        `the ${EVENT_UNION} members`
      );
      if (!selfDiff.ok) {
        drifts.push({
          label: `${EVENT_KIND_VALUES} vs the union it describes`,
          locations: [
            `${core.file}:${coreKindValues.line}  (runtime array)`,
            `${core.file}:${coreEvents.line}  (${EVENT_UNION})`,
          ],
          issues: selfDiff.issues,
        });
      }
    }

    // (c) Per-kind field names, for the kinds both sides declare.
    for (const kind of coreKinds) {
      const coreEvent = coreEvents.events.get(kind);
      const feEvent = feEvents.events.get(kind);
      if (!feEvent) continue; // already reported by the kind diff above
      compared += coreEvent.fields.length;
      const { ok, issues } = diffFieldNames(
        coreEvent.fields,
        feEvent.fields,
        'core',
        'the frontend mirror'
      );
      if (!ok) {
        drifts.push({
          label: `event kind '${kind}' properties`,
          locations: [
            `${core.file}:${coreEvent.line}  ${coreEvent.interfaceName} (authoritative)`,
            `${fe.file}:${feEvent.line}  ${feEvent.interfaceName} (hand-maintained mirror)`,
          ],
          issues,
        });
      }
    }
  }

  return { fatal, drifts, compared };
}

async function main() {
  const [beStream, beBatch, coreTypes, feApi, feTypes] = await Promise.all(
    [BE_STREAM_DTO, BE_BATCH_DTO, CORE_STREAM_TYPES, FE_API, FE_TYPES].map(async (file) =>
      blankComments(await readFile(join(repoRoot, file), 'utf8'))
    )
  );

  const results = [
    checkNumericMirror(
      'RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS (keep-alive cadence)',
      {
        file: BE_STREAM_DTO,
        content: beStream,
        name: 'RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS',
      },
      { file: FE_API, content: feApi, name: 'RESOLVE_CATEGORY_STREAM_KEEP_ALIVE_INTERVAL_MS' },
      'the client derives its idle ceiling from its copy (interval * 6), so a server ' +
        'interval raised past that ceiling aborts every healthy long run as "stopped sending data"'
    ),
    checkNumericMirror(
      'RESOLVE_CATEGORY_ITEMS_MAX / RESOLVE_CATEGORY_STREAM_CHUNK_SIZE (items per request)',
      { file: BE_BATCH_DTO, content: beBatch, name: 'RESOLVE_CATEGORY_ITEMS_MAX' },
      { file: FE_API, content: feApi, name: 'RESOLVE_CATEGORY_STREAM_CHUNK_SIZE' },
      "the frontend splits its requests at the route's own @ArrayMaxSize cap, so a " +
        'server-side reduction that is not mirrored makes every large batch 400 at the validation pipe'
    ),
    checkStreamEventUnion(
      { file: CORE_STREAM_TYPES, content: coreTypes },
      { file: FE_TYPES, content: feTypes }
    ),
  ];

  const fatal = results.flatMap((r) => r.fatal);
  const drifts = results.flatMap((r) => r.drifts);
  const compared = results.reduce((sum, r) => sum + r.compared, 0);

  if (fatal.length > 0) {
    console.error('✗ check-resolve-stream-mirror: could not locate every declaration.\n');
    for (const f of fatal) console.error(`  ${f}`);
    console.error('');
    process.exit(1);
  }

  if (drifts.length === 0) {
    console.log(
      `✓ check-resolve-stream-mirror: 3 mirror(s), ${compared} compared value(s)/field(s) - ` +
        'transport constants and stream-event vocabulary aligned across ' +
        `${BE_STREAM_DTO}, ${BE_BATCH_DTO}, ${CORE_STREAM_TYPES}, ${FE_API} and ${FE_TYPES}.`
    );
    process.exit(0);
  }

  console.error(`✗ check-resolve-stream-mirror: ${drifts.length} drifted mirror(s).\n`);
  for (const { label, locations, issues } of drifts) {
    console.error(`  ${label}`);
    for (const location of locations) console.error(`    ${location}`);
    for (const issue of issues) console.error(`      rule: ${issue}`);
  }
  console.error(`    docs: ${DOCS_REF}`);
  console.error('');
  process.exit(1);
}

/** Self-test the pure parsers + differs against synthetic inputs (no filesystem). */
function selfCheck() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`  ✗ ${label}: expected ${wanted}, got ${actual}`);
  };

  // blankComments
  const blanked = blankComments("const a = 1; // 'ghost'\nconst b = 2;");
  expect('blankComments preserves length', blanked.length, 36);
  expect('blankComments drops line comments', /ghost/.test(blanked), false);
  expect('blankComments keeps newlines', blanked.split('\n').length, 2);
  expect(
    'blankComments leaves strings alone',
    /x-ndjson/.test(blankComments("const t = 'application/x-ndjson';")),
    true
  );
  expect(
    'blankComments drops block comments with braces',
    /link/.test(blankComments('/** {@link X} */\nexport interface A { kind: 1 }')),
    false
  );

  // parseNumericConstant
  const num = parseNumericConstant('export const KEEP = 10_000;\n', 'KEEP');
  expect('parses an underscored number', num?.value, 10000);
  expect('reports its raw form', num?.raw, '10_000');
  expect('reports the declaration line', num?.line, 1);
  expect(
    'a derived initializer is not a numeric mirror',
    parseNumericConstant('export const X = KEEP * 6;', 'X'),
    null
  );
  expect('absent constant → null', parseNumericConstant('const KEEP = 1;', 'KEEP'), null);

  // parseConstArrayValues
  const arr = parseConstArrayValues("export const V = ['a', 'b'] as const;", 'V');
  expect('parses array literals', arr?.values.join(','), 'a,b');
  expect(
    'keys on the requested name, not the first array',
    parseConstArrayValues(
      "export const A = ['x'] as const;\nexport const B = ['y'] as const;",
      'B'
    )?.values.join(','),
    'y'
  );

  // parseUnionMembers
  const union = parseUnionMembers('export type E =\n  | Result\n  | Done;\n', 'E');
  expect('parses union members', union?.members.join(','), 'Result,Done');

  // parseInterfaceBody + fields + kind
  const iface = `export interface Done {\n  kind: 'done';\n  resolvedCount: number;\n  nested: { a: string };\n  maybe?: boolean;\n}\n`;
  const body = parseInterfaceBody(iface, 'Done');
  expect('finds the interface body', body === null, false);
  expect('reads the kind discriminant', parseKindLiteral(body.body), 'done');
  expect(
    'collects depth-0 fields only, keeping optionality',
    parseInterfaceFieldNames(body.body).join(','),
    'kind,resolvedCount,nested,maybe?'
  );

  // parseStreamEvents end to end
  const file =
    `export interface R { kind: 'result'; variantId: string; }\n` +
    `export interface D { kind: 'done'; completion: string; }\n` +
    `export type E = R | D;\n`;
  const events = parseStreamEvents(file, 'E');
  expect('derives both kinds from the union', [...events.events.keys()].join(','), 'result,done');
  expect('no structural problems on a well-formed file', events.problems.length, 0);
  const broken = parseStreamEvents(
    `export interface R { variantId: string; }\nexport type E = R;`,
    'E'
  );
  expect('a kind-less member is a problem', broken.problems.length, 1);

  // differs
  expect('identical arrays → ok', diffValueArrays(['a', 'b'], ['a', 'b'], 'l', 'r').ok, true);
  expect('missing on the right → not ok', diffValueArrays(['a', 'b'], ['a'], 'l', 'r').ok, false);
  expect('missing on the left → not ok', diffValueArrays(['a'], ['a', 'b'], 'l', 'r').ok, false);
  expect('reordered → not ok', diffValueArrays(['a', 'b'], ['b', 'a'], 'l', 'r').ok, false);
  expect('identical fields → ok', diffFieldNames(['a', 'b'], ['b', 'a'], 'l', 'r').ok, true);
  expect('extra field → not ok', diffFieldNames(['a'], ['a', 'b'], 'l', 'r').ok, false);
  expect('optionality difference → not ok', diffFieldNames(['a'], ['a?'], 'l', 'r').ok, false);

  if (failures.length > 0) {
    console.error('✗ check-resolve-stream-mirror --self-check failed:\n');
    for (const f of failures) console.error(f);
    console.error('');
    process.exit(1);
  }
  console.log('✓ check-resolve-stream-mirror --self-check: parsers + differs behave.');
  process.exit(0);
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  // Explicit fatal handler, matching `check-sales-document-reason-mirror.mjs`.
  // A bare top-level `await main()` surfaces a rename of any mirrored file as a
  // raw unhandled-rejection stack instead of one actionable line.
  Promise.resolve(main()).catch((err) => {
    console.error('✗ check-resolve-stream-mirror: fatal error:', err);
    process.exit(1);
  });
}
